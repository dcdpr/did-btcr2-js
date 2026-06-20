import type { SchnorrKeyPair } from '@did-btcr2/keypair';
import { bytesToHex, hexToBytes } from '@noble/hashes/utils';
import type { BaseMessage } from '../messages/base.js';
import type { MessageHandler, Transport } from './transport.js';

/** Internal registration for a single actor sharing an {@link InMemoryTransport}. */
interface ActorEntry {
  keys: SchnorrKeyPair;
  handlers: Map<string, MessageHandler>;
}

/**
 * In-process message bus connecting one or more {@link InMemoryTransport}
 * instances. Routes broadcasts to every registered actor and directed messages
 * to the actor that owns the recipient DID — with no relay, server, or network.
 *
 * Each delivery does a JSON round-trip (Uint8Array preserved as `__bytes` hex)
 * so handlers receive an isolated, serialization-faithful copy, exactly as a
 * real transport would. The message `body` is merged to the top level to match
 * the shape the {@link NostrTransport} dispatch produces.
 *
 * @class InMemoryBus
 */
export class InMemoryBus {
  #transports: Set<InMemoryTransport> = new Set();

  /** Attach a transport to this bus. Called by the transport's constructor. */
  register(transport: InMemoryTransport): void {
    this.#transports.add(transport);
  }

  /** Detach a transport from this bus. */
  unregister(transport: InMemoryTransport): void {
    this.#transports.delete(transport);
  }

  /**
   * Deliver a message. With no `recipient` the message is broadcast to every
   * actor on the bus; otherwise it is routed to the single transport that owns
   * the recipient DID.
   */
  async deliver(message: BaseMessage, _sender: string, recipient?: string): Promise<void> {
    const type = (message as { type?: string }).type;
    if(!type) return;

    // JSON round-trip to mimic transport serialization, preserving Uint8Array.
    const replacer = (_k: string, v: unknown): unknown => v instanceof Uint8Array ? { __bytes: bytesToHex(v) } : v;
    const reviver = (_k: string, v: unknown): unknown =>
      v && typeof v === 'object' && '__bytes' in (v as Record<string, unknown>)
        ? hexToBytes((v as { __bytes: string }).__bytes)
        : v;
    const raw = JSON.parse(JSON.stringify(message, replacer), reviver) as Record<string, unknown>;
    const serialized = { ...raw, ...((raw.body as Record<string, unknown> | undefined) ?? {}) };

    if(!recipient) {
      for(const t of this.#transports) {
        await t.dispatchBroadcast(type, serialized);
      }
      return;
    }
    for(const t of this.#transports) {
      if(t.hasActor(recipient)) {
        await t.dispatchDirected(recipient, type, serialized);
        return;
      }
    }
  }
}

/**
 * In-process {@link Transport} that routes aggregation messages through an
 * {@link InMemoryBus} instead of a relay or HTTP server. Supports multiple
 * actors per instance, so a single transport can host both a service and its
 * participants (e.g. a cohort-of-one via {@link AggregationRunner.solo}).
 *
 * Encryption is a no-op (in-process, same trust domain); `registerPeer` /
 * `getPeerPk` keep a registry so the contract matches the wire transports.
 *
 * @class InMemoryTransport
 * @implements {Transport}
 */
export class InMemoryTransport implements Transport {
  name: string = 'in-memory';
  readonly bus: InMemoryBus;

  #actors: Map<string, ActorEntry> = new Map();
  #peers: Map<string, Uint8Array> = new Map();

  /** @param bus Shared bus. Pass the same bus to connect multiple transports. */
  constructor(bus: InMemoryBus = new InMemoryBus()) {
    this.bus = bus;
    this.bus.register(this);
  }

  start(): void {
    // No-op: there is no underlying connection to open.
  }

  registerActor(did: string, keys: SchnorrKeyPair): void {
    this.#actors.set(did, { keys, handlers: new Map() });
  }

  getActorPk(did: string): Uint8Array | undefined {
    return this.#actors.get(did)?.keys.publicKey.compressed;
  }

  /** True if `did` is registered on this transport. Used by the bus for routing. */
  hasActor(did: string): boolean {
    return this.#actors.has(did);
  }

  registerPeer(did: string, communicationPk: Uint8Array): void {
    this.#peers.set(did, communicationPk);
  }

  getPeerPk(did: string): Uint8Array | undefined {
    return this.#peers.get(did);
  }

  registerMessageHandler(actorDid: string, messageType: string, handler: MessageHandler): void {
    const actor = this.#actors.get(actorDid);
    if(actor) actor.handlers.set(messageType, handler);
  }

  unregisterMessageHandler(actorDid: string, messageType: string): void {
    const actor = this.#actors.get(actorDid);
    if(actor) actor.handlers.delete(messageType);
  }

  unregisterActor(did: string): void {
    const actor = this.#actors.get(did);
    if(!actor) return;
    actor.handlers.clear();
    this.#actors.delete(did);
    this.#peers.delete(did);
  }

  async sendMessage(message: BaseMessage, sender: string, recipient?: string): Promise<void> {
    await this.bus.deliver(message, sender, recipient);
  }

  publishRepeating(
    message: BaseMessage,
    sender: string,
    intervalMs: number,
    recipient?: string,
  ): () => void {
    let stopped = false;
    void this.sendMessage(message, sender, recipient).catch(() => { /* in-process: no relay to reject */ });
    const timer = setInterval(() => {
      if(stopped) return;
      void this.sendMessage(message, sender, recipient).catch(() => { /* ignore */ });
    }, intervalMs);
    return () => {
      if(stopped) return;
      stopped = true;
      clearInterval(timer);
    };
  }

  /** Deliver a broadcast message to every actor on this transport that handles `type`. */
  async dispatchBroadcast(type: string, message: unknown): Promise<void> {
    for(const actor of this.#actors.values()) {
      const handler = actor.handlers.get(type);
      if(handler) await handler(message);
    }
  }

  /** Deliver a directed message to the recipient actor's handler for `type`. */
  async dispatchDirected(recipientDid: string, type: string, message: unknown): Promise<void> {
    const handler = this.#actors.get(recipientDid)?.handlers.get(type);
    if(handler) await handler(message);
  }
}

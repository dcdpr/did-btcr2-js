import type { SchnorrKeyPair } from '@did-btcr2/keypair';
import { bytesToHex, hexToBytes } from '@noble/hashes/utils';
import type {
  BaseMessage,
  MessageHandler,
  Transport,
} from '../../src/index.js';

/** Internal registration for a single actor sharing this transport. */
interface ActorEntry {
  keys: SchnorrKeyPair;
  handlers: Map<string, MessageHandler>;
}

/**
 * Central message bus for in-process testing.
 * Routes messages between MockTransport instances.
 */
export class MessageBus {
  #services: Set<MockTransport> = new Set();

  register(service: MockTransport): void {
    this.#services.add(service);
  }

  async deliver(message: BaseMessage, _sender: string, recipient?: string): Promise<void> {
    const type = (message as { type?: string }).type;
    if(!type) return;

    // JSON round-trip to simulate transport serialization with Uint8Array preservation
    const replacer = (_k: string, v: unknown) => v instanceof Uint8Array ? { __bytes: bytesToHex(v) } : v;
    const reviver = (_k: string, v: unknown) =>
      v && typeof v === 'object' && '__bytes' in (v as Record<string, unknown>)
        ? hexToBytes((v as { __bytes: string }).__bytes)
        : v;
    const raw = JSON.parse(JSON.stringify(message, replacer), reviver);
    const serialized = { ...raw, ...(raw.body ?? {}) };

    if(!recipient) {
      // Broadcast to all actors across all services
      for(const svc of this.#services) {
        await svc.dispatchBroadcast(type, serialized);
      }
    } else {
      // Route to specific recipient
      for(const svc of this.#services) {
        if(svc.hasActor(recipient)) {
          await svc.dispatchDirected(recipient, type, serialized);
          return;
        }
      }
    }
  }
}

/**
 * Mock Transport for in-process testing.
 * Implements the Transport interface but routes messages through a MessageBus
 * instead of any real network. Supports multiple actors per instance.
 */
export class MockTransport implements Transport {
  name: string = 'mock';
  bus: MessageBus;

  #actors: Map<string, ActorEntry> = new Map();
  #peers: Map<string, Uint8Array> = new Map();

  constructor(bus: MessageBus) {
    this.bus = bus;
    this.bus.register(this);
  }

  registerActor(did: string, keys: SchnorrKeyPair): void {
    this.#actors.set(did, { keys, handlers: new Map() });
  }

  getActorPk(did: string): Uint8Array | undefined {
    return this.#actors.get(did)?.keys.publicKey.compressed;
  }

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

  start(): void {
    // No-op for mock
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
    void this.sendMessage(message, sender, recipient).catch(() => {});
    const timer = setInterval(() => {
      if(stopped) return;
      void this.sendMessage(message, sender, recipient).catch(() => {});
    }, intervalMs);
    return () => {
      if(stopped) return;
      stopped = true;
      clearInterval(timer);
    };
  }

  async dispatchBroadcast(type: string, message: unknown): Promise<void> {
    for(const actor of this.#actors.values()) {
      const handler = actor.handlers.get(type);
      if(handler) await handler(message);
    }
  }

  async dispatchDirected(recipientDid: string, type: string, message: unknown): Promise<void> {
    const actor = this.#actors.get(recipientDid);
    if(!actor) return;
    const handler = actor.handlers.get(type);
    if(handler) await handler(message);
  }
}

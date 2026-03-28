import type { Did } from '@did-btcr2/common';
import type { SchnorrKeyPair } from '@did-btcr2/keypair';
import { CompressedSecp256k1PublicKey } from '@did-btcr2/keypair';
import { bytesToHex, hexToBytes } from '@noble/hashes/utils';
import type { Event, EventTemplate} from 'nostr-tools';
import { finalizeEvent, nip44 } from 'nostr-tools';
import { SimplePool } from 'nostr-tools/pool';
import type { BaseMessage } from '../messages/base.js';
import { COHORT_ADVERT } from '../messages/constants.js';
import { isAggregationMessageType, isKeygenMessageType, isSignMessageType, isUpdateMessageType } from '../messages/guards.js';
import { TransportAdapterError } from './error.js';
import type { MessageHandler, Transport } from './transport.js';

/**
 * Default Nostr relay URLs.
 * @constant {Array<string>} DEFAULT_NOSTR_RELAYS
 */
export const DEFAULT_NOSTR_RELAYS = [
  'wss://relay.damus.io',
  'wss://nos.lol',
  'wss://relay.snort.social',
  'wss://nostr-pub.wellorder.net',
];

export interface NostrTransportConfig {
  relays?: string[];
}

/** Internal registration for a single actor sharing this transport. */
interface ActorEntry {
  keys: SchnorrKeyPair;
  handlers: Map<string, MessageHandler>;
}

/**
 * Nostr Transport for did:btcr2 aggregation messages.
 *
 * A single NostrTransport manages one relay pool and supports multiple
 * registered actors. Each actor registers its own DID and keys via
 * {@link registerActor}; the transport resolves the correct identity when
 * sending or receiving.
 *
 * Message routing:
 * - Keygen messages (COHORT_ADVERT, COHORT_OPT_IN, COHORT_OPT_IN_ACCEPT, COHORT_READY) → kind 1 (plaintext)
 * - Update messages (SUBMIT_UPDATE, DISTRIBUTE_AGGREGATED_DATA, VALIDATION_ACK) → kind 1059 (NIP-44 encrypted)
 * - Sign messages → kind 1059 (NIP-44 encrypted)
 *
 * @class NostrTransport
 * @implements {Transport}
 */
export class NostrTransport implements Transport {
  name: string = 'nostr';

  pool?: SimplePool;
  #relays: string[];
  #actors: Map<string, ActorEntry> = new Map();
  #peerRegistry: Map<string, Uint8Array> = new Map();
  #started = false;

  constructor(config?: NostrTransportConfig) {
    this.#relays = config?.relays ?? DEFAULT_NOSTR_RELAYS;
  }

  /**
   * Registers an actor (DID + keys) to send/receive messages with.
   * Must be called before start() to ensure subscriptions are created for the actor.
   * @param {string} did - The DID of the actor.
   * @param {SchnorrKeyPair} keys - The Schnorr key pair for the actor.
   * @throws {TransportAdapterError} If the actor is already registered or if the transport has already started.
   * @example
   * const transport = new NostrTransport();
   * const keys = SchnorrKeyPair.generate();
   * transport.registerActor('did:btcr2:...', keys);
   * transport.start();
   */
  public registerActor(did: string, keys: SchnorrKeyPair): void {
    const entry: ActorEntry = { keys, handlers: new Map() };
    this.#actors.set(did, entry);

    // If already started, create a directed subscription for this actor
    if(this.#started && this.pool) {
      this.#subscribeDirected(did, entry);
    }
  }

  public getActorPk(did: string): Uint8Array | undefined {
    return this.#actors.get(did)?.keys.publicKey.compressed;
  }

  public registerPeer(did: string, communicationPk: Uint8Array): void {
    try {
      new CompressedSecp256k1PublicKey(communicationPk);
    } catch {
      throw new TransportAdapterError(
        `Invalid communication public key for peer ${did}: expected a 33-byte compressed secp256k1 key.`,
        'INVALID_PEER_KEY', { adapter: this.name, did, keyLength: communicationPk.length }
      );
    }
    this.#peerRegistry.set(did, communicationPk);
  }

  public getPeerPk(did: string): Uint8Array | undefined {
    return this.#peerRegistry.get(did);
  }

  public registerMessageHandler(actorDid: string, messageType: string, handler: MessageHandler): void {
    const actor = this.#actors.get(actorDid);
    if(!actor) {
      throw new TransportAdapterError(
        `Cannot register handler: actor ${actorDid} not registered. Call registerActor() first.`,
        'UNKNOWN_ACTOR_ERROR', { adapter: this.name, did: actorDid }
      );
    }
    actor.handlers.set(messageType, handler);
  }

  public start(): NostrTransport {
    if(this.#started) return this;
    this.#started = true;

    this.pool = new SimplePool();
    const since = Math.floor(Date.now() / 1000);

    // Broadcast subscription: kind 1 COHORT_ADVERT events (all actors receive these)
    this.pool.subscribeMany(this.#relays, { kinds: [1], '#t': [COHORT_ADVERT], since }, {
      onclose : (reasons: string[]) => console.debug('Nostr broadcast subscription closed', reasons),
      onevent : this.#handleBroadcastEvent.bind(this),
    });

    // Directed subscriptions for any actors already registered
    for(const [did, entry] of this.#actors) {
      this.#subscribeDirected(did, entry);
    }

    console.info(`NostrTransport started, listening on ${this.#relays.length} relay(s)`);
    return this;
  }

  public async sendMessage(message: BaseMessage, sender: Did, to?: Did): Promise<void> {
    const type = message.type;

    if(!type) {
      throw new TransportAdapterError(
        'Message type is undefined',
        'SEND_MESSAGE_ERROR', { adapter: this.name, type }
      );
    }

    const actor = this.#actors.get(sender);
    if(!actor) {
      throw new TransportAdapterError(
        `Unknown sender: ${sender}. Call registerActor() before sending messages.`,
        'UNKNOWN_ACTOR_ERROR', { adapter: this.name, did: sender }
      );
    }

    const senderKeys = actor.keys;

    // Sender p-tag matches the event signing key
    const tags: string[][] = [
      ['p', bytesToHex(senderKeys.publicKey.x)],
      ['t', type],
    ];

    if(to) {
      const recipientPkBytes = this.#peerRegistry.get(to);
      if(recipientPkBytes) {
        const recipientPk = new CompressedSecp256k1PublicKey(recipientPkBytes);
        tags.push(['p', bytesToHex(recipientPk.x)]);
      }
    }

    // Keygen messages: plaintext, kind 1
    if(isKeygenMessageType(type)) {
      const event = finalizeEvent({
        kind       : 1,
        created_at : Math.floor(Date.now() / 1000),
        tags,
        content    : JSON.stringify(message, NostrTransport.#jsonReplacer),
      } as EventTemplate, senderKeys.secretKey.bytes);
      console.debug(`Publishing kind 1 [${type}]`);
      await this.#publishToRelays(event);
      return;
    }

    // Update and sign messages: NIP-44 encrypted, kind 1059
    if(isUpdateMessageType(type) || isSignMessageType(type)) {
      if(!to) {
        throw new TransportAdapterError(
          `Encrypted messages require a recipient DID, got undefined for type: ${type}`,
          'SEND_MESSAGE_ERROR', { adapter: this.name }
        );
      }
      const recipientPkBytes = this.#peerRegistry.get(to);
      if(!recipientPkBytes) {
        throw new TransportAdapterError(
          `Unknown peer DID: ${to}. Register peer via registerPeer() before sending encrypted messages.`,
          'UNKNOWN_PEER_ERROR', { adapter: this.name, did: to }
        );
      }
      const recipientPk = new CompressedSecp256k1PublicKey(recipientPkBytes);
      const conversationKey = nip44.v2.utils.getConversationKey(
        senderKeys.secretKey.bytes,
        bytesToHex(recipientPk.x)
      );
      const content = nip44.v2.encrypt(JSON.stringify(message, NostrTransport.#jsonReplacer), conversationKey);

      const event = finalizeEvent({
        kind       : 1059,
        created_at : Math.floor(Date.now() / 1000),
        tags,
        content,
      } as EventTemplate, senderKeys.secretKey.bytes);
      console.debug(`Publishing kind 1059 [${type}]`);
      await this.#publishToRelays(event);
      return;
    }

    console.warn(`Unsupported message type: ${type}`);
  }

  #subscribeDirected(did: string, entry: ActorEntry): void {
    if(!this.pool) return;

    const pkHex = bytesToHex(entry.keys.publicKey.x);
    const since = Math.floor(Date.now() / 1000);

    this.pool.subscribeMany(this.#relays, { kinds: [1, 1059], '#p': [pkHex], since }, {
      onclose : (reasons: string[]) => console.debug(`Nostr directed subscription closed for ${did}`, reasons),
      onevent : this.#makeActorEventHandler(did),
    });
  }

  #makeActorEventHandler(actorDid: string): (event: Event) => Promise<void> {
    return async (event: Event) => {
      const actor = this.#actors.get(actorDid);
      if(!actor) return;

      let message: Record<string, unknown>;

      try {
        if(event.kind === 1) {
          message = JSON.parse(event.content, NostrTransport.#jsonReviver);
        } else if(event.kind === 1059) {
          const conversationKey = nip44.v2.utils.getConversationKey(
            actor.keys.secretKey.bytes,
            event.pubkey
          );
          const plaintext = nip44.v2.decrypt(event.content, conversationKey);
          message = JSON.parse(plaintext, NostrTransport.#jsonReviver);
        } else {
          return;
        }
      } catch(err) {
        console.debug(`Failed to parse event ${event.id} for ${actorDid}:`, err);
        return;
      }

      this.#dispatchMessage(message, actor);
    };
  }

  async #handleBroadcastEvent(event: Event): Promise<void> {
    if(event.kind !== 1) return;

    let message: Record<string, unknown>;
    try {
      message = JSON.parse(event.content, NostrTransport.#jsonReviver);
    } catch(err) {
      console.debug(`Failed to parse broadcast event ${event.id}:`, err);
      return;
    }

    if(message.body && typeof message.body === 'object') {
      message = { ...message, ...(message.body as Record<string, unknown>) };
    }

    const messageType = message.type as string;
    if(!messageType || !isAggregationMessageType(messageType)) return;

    // Dispatch to ALL actors that have a handler for this message type
    for(const actor of this.#actors.values()) {
      const handler = actor.handlers.get(messageType);
      if(handler) await handler(message);
    }
  }

  #dispatchMessage(message: Record<string, unknown>, actor: ActorEntry): void {
    if(message.body && typeof message.body === 'object') {
      message = { ...message, ...(message.body as Record<string, unknown>) };
    }

    const messageType = message.type as string;
    if(!messageType || !isAggregationMessageType(messageType)) return;

    const handler = actor.handlers.get(messageType);
    if(handler) handler(message);
  }

  async #publishToRelays(event: Event): Promise<void> {
    const relayPromises = this.pool?.publish(this.#relays, event);
    if(!relayPromises?.length) return;

    const results = await Promise.allSettled(relayPromises);
    const accepted = results.filter(r => r.status === 'fulfilled').length;
    const rejected = results.filter(r => r.status === 'rejected');

    for(const r of rejected) {
      console.debug(`Relay rejected event ${event.id}: ${(r as PromiseRejectedResult).reason}`);
    }

    if(accepted === 0) {
      throw new TransportAdapterError(
        `All ${results.length} relay(s) rejected event ${event.id}`,
        'PUBLISH_ERROR', { adapter: this.name, reasons: rejected.map(r => String((r as PromiseRejectedResult).reason)) }
      );
    }
  }

  static #jsonReplacer(_key: string, value: unknown): unknown {
    if(value instanceof Uint8Array) {
      return { __bytes: bytesToHex(value) };
    }
    return value;
  }

  static #jsonReviver(_key: string, value: unknown): unknown {
    if(value && typeof value === 'object' && '__bytes' in (value as Record<string, unknown>)) {
      return hexToBytes((value as { __bytes: string }).__bytes);
    }
    return value;
  }
}

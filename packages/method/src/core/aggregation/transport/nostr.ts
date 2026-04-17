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
   * const did = DidBtcr2.create(keys.publicKey.compressed, { idType: 'KEY', network: 'mutinynet' });
   * transport.registerActor(did, keys);
   * transport.start();
   */
  registerActor(did: string, keys: SchnorrKeyPair): void {
    const entry: ActorEntry = { keys, handlers: new Map() };
    this.#actors.set(did, entry);

    // If already started, create a directed subscription for this actor
    if(this.#started && this.pool) {
      this.#subscribeDirected(did, entry);
    }
  }

  /**
   * Gets the public key for a registered actor by their DID.
   * @param {string} did - The DID of the registered actor to get the public key for.
   * @returns {Uint8Array | undefined} The compressed public key bytes for the actor's DID, or
   * undefined if the DID is not registered.
   */
  getActorPk(did: string): Uint8Array | undefined {
    return this.#actors.get(did)?.keys.publicKey.compressed;
  }

  /**
   * Registers a peer's communication public key for encrypted messages.
   * @param {string} did - The DID of the peer to register.
   * @param {Uint8Array} communicationPk - The compressed secp256k1 public key bytes for the peer.
   */
  registerPeer(did: string, communicationPk: Uint8Array): void {
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

  /**
   * Gets the registered communication public key for a peer by their DID.
   * @param {string} did - The DID of the peer to get the communication public key for.
   * @returns {Uint8Array | undefined} The compressed secp256k1 public key bytes for the peer, or
   * undefined if the peer is not registered.
   */
  getPeerPk(did: string): Uint8Array | undefined {
    return this.#peerRegistry.get(did);
  }

  /**
   * Registers a message handler function for a specific actor and message type. The handler will be called
   * when a message of the specified type is received for the actor's DID. The transport must have been
   * started for handlers to be invoked. If the transport is already started, the handler will be registered
   * immediately; otherwise, it will be registered when the transport starts and the actor's subscription is created.
   * @param {string} actorDid - The DID of the actor to register the message handler for.
   * @param {string} messageType - The type of message to handle.
   * @param {MessageHandler} handler - The function to handle incoming messages of the specified type.
   * @throws {TransportAdapterError} If the actor DID is not registered or if the handler is invalid.
   */
  registerMessageHandler(actorDid: string, messageType: string, handler: MessageHandler): void {
    const actor = this.#actors.get(actorDid);
    if(!actor) {
      throw new TransportAdapterError(
        `Cannot register handler: actor ${actorDid} not registered. Call registerActor() first.`,
        'UNKNOWN_ACTOR_ERROR', { adapter: this.name, did: actorDid }
      );
    }
    actor.handlers.set(messageType, handler);
  }

  /**
   * Starts the transport by connecting to the configured Nostr relays and setting up subscriptions
   * for all registered actors. This method must be called after registering actors via registerActor()
   * and before sending or receiving messages. The transport will subscribe to broadcast events (kind 1)
   * for cohort adverts and directed events (kinds 1 and 1059) for each registered actor based on their
   * public keys. Incoming events are processed and dispatched to the appropriate handlers based on
   * message type. If the transport is already started, this method has no effect.
   * @returns {NostrTransport}
   */
  start(): NostrTransport {
    if(this.#started) return this;
    this.#started = true;

    this.pool = new SimplePool();

    // Broadcast subscription: kind 1 COHORT_ADVERT events (all actors receive these).
    // No `since` filter — the whole point of Nostr-as-advertisement-relay is that
    // a participant joining later can discover cohort adverts posted earlier by any
    // service. Duplicate adverts are idempotent: AggregationParticipant stores
    // discovered cohorts in a Map keyed by cohortId.
    this.pool.subscribeMany(this.#relays, { kinds: [1], '#t': [COHORT_ADVERT] }, {
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

  /**
   * Sends a message by publishing a Nostr event to the configured relays. The message is serialized
   * as JSON and included in the event content.
   * @param {BaseMessage} message - The aggregation message to send. Must include a valid `type` property.
   * @param {Did} sender - The DID of the registered actor sending the message. Must have been
   * registered via registerActor().
   * @param {Did} [to] - Optional recipient DID for directed messages. Required for encrypted message
   * types. If provided, must have been registered via registerPeer().
   * @returns {Promise<void>} Resolves when the message has been published to the relays. Note that
   * publication is best-effort: the method will resolve as long as at least one relay accepts the
   * event, even if others reject it.
   */
  async sendMessage(message: BaseMessage, sender: Did, to?: Did): Promise<void> {
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

  /**
   * Creates a directed subscription for the given actor, filtering for messages that match the
   * actor's public key. Messages received on this subscription are dispatched to the actor's
   * registered handlers based on message type.
   * @param {string} did - The DID of the actor to create the subscription for.
   * @param {ActorEntry} entry - The actor's registration entry containing keys and handlers.
   * @returns {void}
   * @throws {TransportAdapterError} If the transport is not started or if the pool is unavailable.
   */
  #subscribeDirected(did: string, entry: ActorEntry): void {
    if(!this.pool) return;

    const pkHex = bytesToHex(entry.keys.publicKey.x);

    // No `since` filter: directed messages must be retrievable on reconnect /
    // crash-recovery. Out-of-phase messages are silently dropped by the state
    // machines (AggregationService, AggregationParticipant), so replayed stale
    // messages are harmless.
    this.pool.subscribeMany(this.#relays, { kinds: [1, 1059], '#p': [pkHex] }, {
      onclose : (reasons: string[]) => console.debug(`Nostr directed subscription closed for ${did}`, reasons),
      onevent : this.#makeActorEventHandler(did),
    });
  }

  /**
   * Creates an event handler function for a specific actor that processes incoming events, decrypts
   * if necessary, and dispatches messages to the actor's registered handlers based on message type.
   * @param {string} actorDid - The DID of the actor to create the event handler for.
   * @returns {(event: Event) => Promise<void>} An asynchronous event handler function that
   * processes incoming events for the specified actor.
   */
  #makeActorEventHandler(actorDid: string): (event: Event) => Promise<void> {
    return async (event: Event) => {
      const actor = this.#actors.get(actorDid);
      if(!actor) return;

      // Relay self-echo: sendMessage() adds the sender's own pubkey to the
      // event's `p` tags (so recipients can reply). The directed subscription
      // filter `{'#p': [actor_pk]}` therefore matches every event this actor
      // publishes. Skip — we don't need to process our own outgoing events,
      // and attempting to NIP-44-decrypt them fails with "invalid MAC" because
      // the content was encrypted for the recipient, not self.
      if(event.pubkey === bytesToHex(actor.keys.publicKey.x)) return;

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

  /**
   * Handles incoming broadcast events (kind 1) by parsing the event content, validating it as an
   * aggregation message, and dispatching it to all registered actors that have handlers for the
   * message type. This is used for COHORT_ADVERT messages that need to be received by all actors
   * regardless of DID.
   * @param {Event} event - The Nostr event to handle, expected to be a kind 1 broadcast containing
   * a COHORT_ADVERT message. The event content is parsed and dispatched to all registered actors
   * that have handlers for the
   * @returns
   */
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

  /**
   * Dispatches a parsed message to the appropriate handler of a registered actor based on message type.
   * The message is expected to have already been parsed from the Nostr event content and validated as
   * an aggregation message. If the message has a body, its properties are merged into the top-level
   * message object for easier handler access. The message is then dispatched to the handler registered
   * for its type, if one exists.
   * @param {Record<string, unknown>} message - The message object parsed from a Nostr event, expected to
   * @param {ActorEntry} actor - The registered actor entry containing keys and handlers to dispatch the message to.
   * @returns {void}
   * @throws {TransportAdapterError} If the message type is unsupported or if no handler is registered
   * for the message type.
   */
  #dispatchMessage(message: Record<string, unknown>, actor: ActorEntry): void {
    if(message.body && typeof message.body === 'object') {
      message = { ...message, ...(message.body as Record<string, unknown>) };
    }

    const messageType = message.type as string;
    if(!messageType || !isAggregationMessageType(messageType)) return;

    const handler = actor.handlers.get(messageType);
    if(handler) handler(message);
  }

  /**
   * Publishes a Nostr event to the configured relays and handles the results. The method waits for all
   * relay promises to settle and checks how many accepted or rejected the event. If all relays reject the event,
   * an error is thrown. Otherwise, the method completes successfully even if some relays rejected the event,
   * as long as at least one relay accepted it. Relay rejections are logged for debugging purposes.
   * @param {Event} event - The Nostr event to publish to the configured relays. The event should already
   * @returns {Promise<void>} A promise that resolves if the event was accepted by at least one relay, or rejects
   * with a TransportAdapterError if all relays rejected the event.
   * @throws {TransportAdapterError} If the pool is not initialized or if all relays reject the event.
   */
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

  /**
   * Custom JSON replacer to handle serialization of Uint8Array values as hex strings in message
   * content. This allows messages containing binary data (e.g. public keys, signatures) to be correctly
   * serialized to JSON for Nostr event content. The replacer checks if a value is a Uint8Array and, if so,
   * converts it to a hex string wrapped in an object with a __bytes property. The corresponding reviver
   * can then convert this back to a Uint8Array when parsing the message content from the event.
   * @param {string} _key - The key of the property being processed.
   * @param {unknown} value - The value to check if the message type is valid.
   * @returns {unknown} The transformed value for JSON serialization. If the value is a Uint8Array,
   * it returns an object with a __bytes property containing the hex string. Otherwise, it returns
   * the value unchanged.
   */
  static #jsonReplacer(_key: string, value: unknown): unknown {
    if(value instanceof Uint8Array) {
      return { __bytes: bytesToHex(value) };
    }
    return value;
  }

  /**
   * Custom JSON reviver to handle deserialization of hex strings back into Uint8Array values in message
   * content. This complements the custom replacer used during serialization, allowing messages that contain
   * binary data (e.g. public keys, signatures) to be correctly reconstructed when parsing JSON from
   * Nostr event content. The reviver checks if a value is an object with a __bytes property and,
   * if so, converts the hex string back into a Uint8Array. Otherwise, it returns the value unchanged.
   * @param {string} _key - The key of the property being processed.
   * @param {unknown} value - The value to check if it is an object containing a __bytes property for
   * hex string conversion.
   * @returns {unknown} The transformed value for JSON deserialization. If the value is an object
   * with a __bytes property, it returns a Uint8Array. Otherwise, it returns the value unchanged.
   */
  static #jsonReviver(_key: string, value: unknown): unknown {
    if(value && typeof value === 'object' && '__bytes' in (value as Record<string, unknown>)) {
      return hexToBytes((value as { __bytes: string }).__bytes);
    }
    return value;
  }
}

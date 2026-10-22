import type { Did } from '@did-btcr2/common';
import type { SchnorrKeyPair } from '@did-btcr2/keypair';
import { CompressedSecp256k1PublicKey } from '@did-btcr2/keypair';
import { equalBytes } from '@noble/curves/utils.js';
import { bytesToHex, hexToBytes } from '@noble/hashes/utils';
import type { SubCloser } from 'nostr-tools/abstract-pool';
import type { Event, EventTemplate} from 'nostr-tools';
import { finalizeEvent, nip44 } from 'nostr-tools';
import { SimplePool } from 'nostr-tools/pool';
import type { Logger } from '../logger.js';
import { CONSOLE_LOGGER } from '../logger.js';
import type { BaseMessage } from '../messages/base.js';
import { COHORT_ADVERT } from '../messages/constants.js';
import { isAggregationMessageType } from '../messages/guards.js';
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
  /**
   * Optional logger for transport-level diagnostics (publish/subscribe events,
   * relay rejections, parse failures). Defaults to {@link CONSOLE_LOGGER}.
   */
  logger?: Logger;
  /**
   * How far back (in milliseconds) to set the `since` filter on the broadcast
   * (COHORT_ADVERT) subscription. Some public relays do NOT replay historical
   * events to late subscribers when the filter has no `since`, so the advert
   * gets lost if the subscription lands after the publish. A short lookback
   * window nudges those relays into delivering recent adverts. Set to 0 to
   * disable the filter entirely (unbounded history). Defaults to
   * {@link DEFAULT_BROADCAST_LOOKBACK_MS} (5 minutes).
   */
  broadcastLookbackMs?: number;
  /**
   * Resolve a sender's communication public key from its DID when the sender is not a
   * registered peer. Lets the transport stay DID-method-agnostic: the caller supplies
   * the decode (for example, a did:btcr2 KEY identifier yields its genesis key). The
   * optional `genesisDocument` lets an EXTERNAL (`x1`) sender be authenticated from the
   * self-verifying genesis it carries on a bootstrap opt-in, and is the same signature
   * the HTTP transports take, so one injected resolver serves all three.
   *
   * Inbound authentication depends on it: a message whose `from` resolves to no key is
   * dropped (see {@link NostrTransport}), so a transport constructed without it receives
   * only messages from already-registered peers.
   */
  resolveSenderPk?: (
    did: string,
    opts?: { genesisDocument?: object },
  ) => CompressedSecp256k1PublicKey | undefined;
}

/** Default `since` lookback for broadcast (COHORT_ADVERT) subscriptions: 5 minutes. */
export const DEFAULT_BROADCAST_LOOKBACK_MS = 5 * 60 * 1000;

/**
 * The largest plaintext of this transport, in UTF-8 bytes: the largest plaintext of the
 * 2-byte NIP-44 v2 length prefix. A receiver on nostr-tools 2.23.3 or earlier refuses a
 * payload with a longer prefix.
 */
const MAX_NIP44_PLAINTEXT_BYTES = 65_535;

/** Counts the UTF-8 bytes of a plaintext, as nostr-tools does before it encrypts. */
const UTF8_ENCODER = new TextEncoder();

/** Returns `true` for a parsed JSON object: not null, not an array, and not a primitive value. */
function isJsonObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Internal registration for a single actor sharing this transport. */
interface ActorEntry {
  keys: SchnorrKeyPair;
  handlers: Map<string, MessageHandler>;
  /** Relay-pool subscriptions opened for this actor. Closed on unregisterActor(). */
  subscriptions: SubCloser[];
}

/**
 * Nostr Transport for did:btcr2 aggregation messages.
 *
 * A single NostrTransport manages one relay pool and supports multiple
 * registered actors. Each actor registers its own DID and keys via
 * {@link registerActor}; the transport resolves the correct identity when
 * sending or receiving.
 *
 * Message routing (see {@link sendMessage}):
 * - A message with a recipient goes as a kind 1059 event. The content is NIP-44 v2
 *   ciphertext for the recipient key. The tags are two `p` tags: the sender, then the recipient.
 * - A COHORT_ADVERT with no recipient goes as a kind 1 event. The content is the plaintext
 *   JSON. The tags are a `p` tag for the sender and a `t` tag for COHORT_ADVERT.
 * - The transport refuses each other message that has no recipient.
 *
 * Receive paths:
 * - The directed subscription of an actor filters on kind 1059 and a `p` tag for the
 *   actor key. The handler drops each event of a different kind.
 * - The broadcast subscription filters on kind 1 and the COHORT_ADVERT `t` tag.
 * - A handler that throws or rejects gives a warn line. A logger that throws does not
 *   stop a receive path.
 *
 * Inbound authentication: every event delivered by the relay pool carries a BIP-340
 * signature over its content, verified by `nostr-tools` before it reaches a handler here,
 * so `event.pubkey` is an authenticated identity. The aggregation message inside it
 * declares its own `from` DID, which the protocol acts on. The transport binds the two
 * ({@link #authenticateSender}) and drops any event where they disagree or where the
 * claimed DID cannot be resolved to a key at all.
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
  #logger: Logger;
  #broadcastLookbackMs: number;
  readonly #resolveSenderPkFn?: (
    did: string,
    opts?: { genesisDocument?: object },
  ) => CompressedSecp256k1PublicKey | undefined;

  constructor(config?: NostrTransportConfig) {
    this.#relays = config?.relays ?? DEFAULT_NOSTR_RELAYS;
    this.#logger = config?.logger ?? CONSOLE_LOGGER;
    this.#broadcastLookbackMs = config?.broadcastLookbackMs ?? DEFAULT_BROADCAST_LOOKBACK_MS;
    this.#resolveSenderPkFn = config?.resolveSenderPk;
  }

  /**
   * Registers an actor (DID + keys) to send/receive messages with.
   * Must be called before start() to ensure subscriptions are created for the actor.
   * @param {string} did - The DID of the actor.
   * @param {SchnorrKeyPair} keys - The Schnorr key pair for the actor.
   * @example
   * const transport = new NostrTransport();
   * const keys = SchnorrKeyPair.generate();
   * const did = DidBtcr2.create(keys.publicKey.compressed, { idType: 'KEY', network: 'mutinynet' });
   * transport.registerActor(did, keys);
   * transport.start();
   */
  registerActor(did: string, keys: SchnorrKeyPair): void {
    const entry: ActorEntry = { keys, handlers: new Map(), subscriptions: [] };
    this.#actors.set(did, entry);

    // If already started, create a directed subscription for this actor
    if(this.#started && this.pool) {
      this.#subscribeDirected(did, entry);
    }
  }

  /**
   * Detach an actor: drop its handlers, close its relay subscriptions, and remove its keys + peer
   * mapping. Idempotent.
   * @param {string} did - The DID of the actor to unregister.
   * @returns {void}
   * @example
   * transport.unregisterActor(did);
   */
  unregisterActor(did: string): void {
    const entry = this.#actors.get(did);
    if(!entry) return;
    for(const sub of entry.subscriptions) {
      try { sub.close(); } catch(err) { this.#logger.debug(`Error closing subscription for ${did}:`, err); }
    }
    entry.subscriptions.length = 0;
    entry.handlers.clear();
    this.#actors.delete(did);
    this.#peerRegistry.delete(did);
  }

  /**
   * Remove a single (actor, messageType) handler. Idempotent.
   * @param {string} actorDid - The DID of the actor.
   * @param {string} messageType - The type of message to unregister the handler for.
   * @returns {void}
   * @example
   * transport.unregisterMessageHandler(actorDid, messageType);
   */
  unregisterMessageHandler(actorDid: string, messageType: string): void {
    const actor = this.#actors.get(actorDid);
    if(!actor) return;
    actor.handlers.delete(messageType);
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
   * for all registered actors. Call this method after registerActor() and before the first send.
   * The transport subscribes to broadcast events (kind 1) for cohort adverts. It also subscribes to
   * directed events (kind 1059 only) for the public key of each registered actor. It dispatches
   * each incoming event to the handler for its message type. If the transport is already started,
   * this method has no effect.
   * @returns {NostrTransport}
   */
  start(): NostrTransport {
    if(this.#started) return this;
    this.#started = true;

    this.pool = new SimplePool();

    // Broadcast subscription: kind 1 COHORT_ADVERT events (all actors receive
    // these). Duplicate adverts are idempotent: AggregationParticipant stores
    // discovered cohorts in a Map keyed by cohortId.
    //
    // The `since` filter is a workaround for relays that don't backfill
    // historical events to late subscribers (observed on nos.lol and
    // relay.snort.social). Without it, an advert published before a
    // participant's subscription lands is lost on those relays. The default
    // 5-minute window is generous enough to cover network + subscription
    // setup delays while still excluding ancient traffic. Set
    // broadcastLookbackMs to 0 to disable.
    const broadcastFilter: { kinds: number[]; '#t': string[]; since?: number } = {
      kinds : [1],
      '#t'  : [COHORT_ADVERT],
    };
    if(this.#broadcastLookbackMs > 0) {
      broadcastFilter.since = Math.floor((Date.now() - this.#broadcastLookbackMs) / 1000);
    }
    this.pool.subscribeMany(this.#relays, broadcastFilter, {
      onclose : (reasons: string[]) => this.#logDebug('Nostr broadcast subscription closed', reasons),
      onevent : this.#guardEventHandler(this.#handleBroadcastEvent.bind(this), 'Broadcast event'),
    });

    // Directed subscriptions for any actors already registered
    for(const [did, entry] of this.#actors) {
      this.#subscribeDirected(did, entry);
    }

    this.#logger.info(`NostrTransport started, listening on ${this.#relays.length} relay(s)`);
    return this;
  }

  /**
   * Sends a message as a Nostr event to the configured relays.
   *
   * The recipient rule:
   * - If `to` is set, the recipient DID must be a registered peer (see {@link registerPeer}).
   *   The event is kind 1059, and its content is NIP-44 v2 ciphertext for the recipient key.
   *   The tags are exactly `['p', <sender x-only key>]` and `['p', <recipient x-only key>]`.
   * - If `to` is not set, only a COHORT_ADVERT is allowed. The event is kind 1, and its
   *   content is the plaintext JSON. The tags are `['p', <sender x-only key>]` and
   *   `['t', COHORT_ADVERT]`.
   *
   * A message type that is not an aggregation message type gives a warn line, and the
   * method publishes nothing.
   * @param {BaseMessage} message - The aggregation message to send. Must include a valid `type` property.
   * @param {Did} sender - The DID of the registered actor sending the message. Must have been
   * registered via registerActor().
   * @param {Did} [to] - The recipient DID. Each message type except COHORT_ADVERT needs it.
   * If set, the recipient DID must be a registered peer (see registerPeer()).
   * @returns {Promise<void>} Resolves when at least one relay accepts the event. Publication
   * is best effort: the other relays can refuse the event. If the transport is not started
   * or has no relay, the method resolves and publishes nothing.
   * @throws {TransportAdapterError} With one of these error types:
   * - `SEND_MESSAGE_ERROR`: the message has no type, or a message other than a
   *   COHORT_ADVERT has no recipient.
   * - `UNKNOWN_ACTOR_ERROR`: the sender is not a registered actor.
   * - `UNKNOWN_PEER_ERROR`: the recipient is not a registered peer.
   * - `MESSAGE_TOO_LARGE`: the plaintext JSON of a message with a recipient is larger
   *   than 65,535 UTF-8 bytes, the limit of this transport (the 2-byte NIP-44 v2 length
   *   prefix). The method publishes nothing.
   * - `PUBLISH_ERROR`: all relays refuse the event.
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

    if(!isAggregationMessageType(type)) {
      this.#logger.warn(`Unsupported message type: ${type}`);
      return;
    }

    const senderKeys = actor.keys;
    // Sender p-tag matches the event signing key
    const senderPkHex = bytesToHex(senderKeys.publicKey.x);

    // No recipient: only a cohort advert goes out, as a public kind 1 event. A relay
    // subscriber receives it through the broadcast filter (kind 1 and the advert t tag).
    if(!to) {
      if(type !== COHORT_ADVERT) {
        throw new TransportAdapterError(
          `A ${type} message needs a recipient DID. Only a ${COHORT_ADVERT} message can go with no recipient.`,
          'SEND_MESSAGE_ERROR', { adapter: this.name, type }
        );
      }
      const event = finalizeEvent({
        kind       : 1,
        created_at : Math.floor(Date.now() / 1000),
        tags       : [ [ 'p', senderPkHex ], [ 't', COHORT_ADVERT ] ],
        content    : JSON.stringify(message, NostrTransport.#jsonReplacer),
      } as EventTemplate, senderKeys.secretKey.bytes);
      this.#logger.debug(`Publishing kind 1 [${type}]`);
      await this.#publishToRelays(event);
      return;
    }

    // A recipient: each message type goes as NIP-44 v2 ciphertext, kind 1059. The tags
    // name no message type, so a relay sees only the two keys.
    const recipientPkBytes = this.#peerRegistry.get(to);
    if(!recipientPkBytes) {
      throw new TransportAdapterError(
        `Unknown peer DID: ${to}. Register the peer with registerPeer() before you send a message to it.`,
        'UNKNOWN_PEER_ERROR', { adapter: this.name, did: to }
      );
    }
    const recipientPkHex = bytesToHex(new CompressedSecp256k1PublicKey(recipientPkBytes).x);

    const plaintext = JSON.stringify(message, NostrTransport.#jsonReplacer);
    const plaintextBytes = UTF8_ENCODER.encode(plaintext).byteLength;
    if(plaintextBytes > MAX_NIP44_PLAINTEXT_BYTES) {
      throw new TransportAdapterError(
        `The plaintext of the ${type} message is ${plaintextBytes} bytes. The limit of this transport `
        + `(the 2-byte NIP-44 v2 length prefix) is ${MAX_NIP44_PLAINTEXT_BYTES} bytes.`,
        'MESSAGE_TOO_LARGE',
        { adapter: this.name, type, plaintextBytes, maxPlaintextBytes: MAX_NIP44_PLAINTEXT_BYTES }
      );
    }

    const conversationKey = nip44.v2.utils.getConversationKey(senderKeys.secretKey.bytes, recipientPkHex);
    const event = finalizeEvent({
      kind       : 1059,
      created_at : Math.floor(Date.now() / 1000),
      tags       : [ [ 'p', senderPkHex ], [ 'p', recipientPkHex ] ],
      content    : nip44.v2.encrypt(plaintext, conversationKey),
    } as EventTemplate, senderKeys.secretKey.bytes);
    this.#logger.debug(`Publishing kind 1059 [${type}]`);
    await this.#publishToRelays(event);
  }

  /**
   * Publish the message once immediately and then re-publish on an interval
   * until the returned stop function is invoked.
   *
   * Useful for broadcast messages (COHORT_ADVERT) on relays that don't
   * backfill historical events to late subscribers: republishing gives late
   * joiners a window to discover the message without requiring protocol
   * changes. Relay rate-limit / publish failures inside the interval are
   * caught and logged rather than propagated - the caller should stop the
   * repeater once the protocol condition is satisfied.
   */
  publishRepeating(message: BaseMessage, sender: Did, intervalMs: number, recipient?: Did): () => void {
    let stopped = false;
    // Fire the first publish eagerly; any error surfaces as a rejected
    // promise that we swallow to avoid unhandled rejections - the caller can
    // observe delivery via receive-side handlers.
    void this.sendMessage(message, sender, recipient).catch((err) => {
      this.#logDebug('publishRepeating first send failed:', err);
    });
    const timer = setInterval(() => {
      if(stopped) return;
      void this.sendMessage(message, sender, recipient).catch((err) => {
        this.#logDebug('publishRepeating retry failed:', err);
      });
    }, intervalMs);
    return () => {
      if(stopped) return;
      stopped = true;
      clearInterval(timer);
    };
  }

  /**
   * Creates a directed subscription for the given actor, filtering for messages that match the
   * actor's public key. Messages received on this subscription are dispatched to the actor's
   * registered handlers based on message type.
   * @param {string} did - The DID of the actor to create the subscription for.
   * @param {ActorEntry} entry - The actor's registration entry containing keys and handlers.
   * @returns {void}
   */
  #subscribeDirected(did: string, entry: ActorEntry): void {
    if(!this.pool) return;

    const pkHex = bytesToHex(entry.keys.publicKey.x);

    // No `since` filter: directed messages must be retrievable on reconnect /
    // crash-recovery. Thus a relay can send an old message again to a new
    // subscription. The state machines (AggregationService,
    // AggregationParticipant) drop a message that is not for the current phase
    // of its cohort. The service runner requests the tx data of a cohort one
    // time only. But a replayed message is not always harmless, because a runner
    // can act on it again. For example, a replayed COHORT_READY of an accepted
    // cohort makes AggregationParticipantRunner call onProvideUpdate again and
    // emit an `error` event (error type INVALID_PHASE).
    const sub = this.pool.subscribeMany(this.#relays, { kinds: [1059], '#p': [pkHex] }, {
      onclose : (reasons: string[]) => this.#logDebug(`Nostr directed subscription closed for ${did}`, reasons),
      onevent : this.#guardEventHandler(this.#makeActorEventHandler(did), `Directed event for ${did}`),
    });
    entry.subscriptions.push(sub);
  }

  /**
   * Creates the directed event handler of one actor. The handler accepts only a kind 1059
   * event, and it drops each event of a different kind. It decrypts the NIP-44 v2 content
   * with the actor key and the event signer key, and it parses the plaintext JSON. It drops
   * a plaintext that is not a JSON object. It then binds the sender (see
   * {@link #authenticateSender}) and dispatches the message to the handler of the actor.
   * @param {string} actorDid - The DID of the actor to create the event handler for.
   * @returns {(event: Event) => Promise<void>} An asynchronous event handler function that
   * processes incoming events for the specified actor. {@link #guardEventHandler} wraps it.
   */
  #makeActorEventHandler(actorDid: string): (event: Event) => Promise<void> {
    return async (event: Event) => {
      const actor = this.#actors.get(actorDid);
      if(!actor) return;

      // The directed path accepts only NIP-44 v2 ciphertext. The relay filter asks for kind
      // 1059 only, but the handler does not trust the filter: it checks the kind again.
      if(event.kind !== 1059) {
        this.#logDebug(`Dropping event ${event.id} for ${actorDid}: kind ${event.kind} is not 1059`);
        return;
      }

      // Relay self-echo: sendMessage() adds a `p` tag for the sender key. Thus the
      // directed filter `{ kinds: [1059], '#p': [actor_pk] }` matches each event that
      // this actor sends. The transport skips each event that it signed. The sender
      // encrypted the content for the recipient, so a NIP-44 decrypt with the actor key
      // fails with "invalid MAC".
      if(event.pubkey === bytesToHex(actor.keys.publicKey.x)) return;

      let parsed: unknown;
      try {
        const conversationKey = nip44.v2.utils.getConversationKey(
          actor.keys.secretKey.bytes,
          event.pubkey
        );
        const plaintext = nip44.v2.decrypt(event.content, conversationKey);
        parsed = JSON.parse(plaintext, NostrTransport.#jsonReviver);
      } catch(err) {
        this.#logDebug(`Failed to parse event ${event.id} for ${actorDid}:`, err);
        return;
      }
      if(!isJsonObject(parsed)) {
        this.#logDebug(`Dropping event ${event.id} for ${actorDid}: the plaintext is not a JSON object`);
        return;
      }

      const flat = this.#flattenAndAuthenticate(parsed, event);
      if(!flat) return;

      this.#dispatchMessage(flat, actor);
    };
  }

  /**
   * Handles incoming broadcast events (kind 1) by parsing the event content, validating it as an
   * aggregation message, and dispatching it to all registered actors that have handlers for the
   * message type. This is used for COHORT_ADVERT messages that need to be received by all actors
   * regardless of DID. The handler drops a content that is not a JSON object.
   * @param {Event} event - The Nostr event to handle, expected to be a kind 1 broadcast containing
   * a COHORT_ADVERT message.
   * @returns {Promise<void>} Resolves when the handler of each actor settles. The promise does
   * not reject for a handler failure. {@link #guardEventHandler} wraps this method.
   */
  async #handleBroadcastEvent(event: Event): Promise<void> {
    if(event.kind !== 1) return;

    let parsed: unknown;
    try {
      parsed = JSON.parse(event.content, NostrTransport.#jsonReviver);
    } catch(err) {
      this.#logDebug(`Failed to parse broadcast event ${event.id}:`, err);
      return;
    }
    if(!isJsonObject(parsed)) {
      this.#logDebug(`Dropping broadcast event ${event.id}: the content is not a JSON object`);
      return;
    }

    const message = this.#flattenAndAuthenticate(parsed, event);
    if(!message) return;

    const messageType = message.type;
    if(typeof messageType !== 'string' || !isAggregationMessageType(messageType)) return;
    // #authenticateSender accepts only a non-empty string `from`.
    const sender = message.from as string;

    // Dispatch to ALL actors that have a handler for this message type, one after the
    // other. A handler that throws or rejects gives a warn line, and the handlers of the
    // later actors still run.
    for(const actor of this.#actors.values()) {
      const handler = actor.handlers.get(messageType);
      if(!handler) continue;
      try {
        await handler(message);
      } catch(err) {
        this.#logHandlerFailure('Broadcast', messageType, sender, err);
      }
    }
  }

  /**
   * Flatten a parsed event payload and bind its self-declared sender to the event's
   * signing key. Returns the flattened message when it authenticates, `undefined` when
   * the caller must drop it.
   *
   * Flattening happens first because the fields the binding consults (`communicationPk`,
   * `genesisDocument`) ride in `body`, and the handlers downstream read the flat shape.
   * The flat message keeps the outer `body` as its `body` member. Thus a `body` member
   * inside `body` cannot replace it, and the binding and the state machines read the
   * same `communicationPk`.
   * @param {Record<string, unknown>} message The parsed (unflattened) event payload.
   * @param {Event} event The Nostr event that carried it.
   * @returns {Record<string, unknown> | undefined} The authenticated flat message, or undefined.
   */
  #flattenAndAuthenticate(message: Record<string, unknown>, event: Event): Record<string, unknown> | undefined {
    const body = message.body;
    const flat = (body && typeof body === 'object')
      ? { ...message, ...(body as Record<string, unknown>), body }
      : message;
    return this.#authenticateSender(flat, event) ? flat : undefined;
  }

  /**
   * Bind a message's self-declared `from` DID to the key that signed the Nostr event
   * carrying it.
   *
   * `nostr-tools` verifies the event signature before delivery, so `event.pubkey` is an
   * authenticated key; `message.from` is an unauthenticated claim that the protocol acts
   * on (the participant records the service DID an advert names and encrypts to the key
   * it declares; the service seats the DID an opt-in names). Without this bind anyone can
   * publish an event claiming to be any DID.
   *
   * Fails closed: a DID this transport cannot resolve to a key is dropped rather than
   * dispatched, matching {@link HttpClientTransport}'s existing posture for a broadcast
   * from an unresolvable DID. Registered peers resolve from the peer registry; everyone
   * else needs the injected {@link NostrTransportConfig.resolveSenderPk}.
   *
   * When the message advertises a `communicationPk` (a cohort advert or an opt-in), it
   * must be the key that just authenticated. Otherwise a sender could authenticate as
   * itself and have the cohort encrypt to, and attribute keys to, a different key
   * (the same cross-check the HTTP server applies when bootstrapping an `x1` opt-in).
   * @param {Record<string, unknown>} message The flattened message claiming a sender.
   * @param {Event} event The Nostr event that carried it.
   * @returns {boolean} True when the claim is bound to the event's signing key.
   */
  #authenticateSender(message: Record<string, unknown>, event: Event): boolean {
    const from = message.from;
    if(typeof from !== 'string' || from.length === 0) {
      this.#logDebug(`Dropping event ${event.id}: message declares no sender DID`);
      return false;
    }

    const genesisDocument = message.genesisDocument;
    const senderPk = this.#resolveSenderPk(
      from,
      genesisDocument && typeof genesisDocument === 'object'
        ? { genesisDocument: genesisDocument as object }
        : undefined,
    );
    if(!senderPk) {
      this.#logDebug(`Dropping event ${event.id}: cannot resolve a key for sender ${from}`);
      return false;
    }

    if(bytesToHex(senderPk.x) !== event.pubkey.toLowerCase()) {
      this.#logDebug(`Dropping event ${event.id}: ${from} did not sign it`);
      return false;
    }

    const communicationPk = message.communicationPk;
    if(communicationPk !== undefined) {
      if(!(communicationPk instanceof Uint8Array) || !equalBytes(communicationPk, senderPk.compressed)) {
        this.#logDebug(`Dropping event ${event.id}: ${from} advertises a key it did not authenticate with`);
        return false;
      }
    }

    return true;
  }

  /**
   * Resolve a sender's communication public key: a registered peer's key first, then the
   * injected DID resolver. Mirrors the HTTP transports' resolution order. If the injected
   * resolver throws, the method writes a debug line and returns `undefined`.
   * @param {string} did The sender's DID.
   * @param {object} [opts] Optional resolution inputs (an `x1` sender's genesis document).
   * @returns {CompressedSecp256k1PublicKey | undefined} The key, or undefined if unresolvable.
   */
  #resolveSenderPk(
    did: string,
    opts?: { genesisDocument?: object },
  ): CompressedSecp256k1PublicKey | undefined {
    const peerBytes = this.#peerRegistry.get(did);
    if(peerBytes) {
      try { return new CompressedSecp256k1PublicKey(peerBytes); }
      catch { /* fall through to the injected resolver */ }
    }
    try {
      return this.#resolveSenderPkFn?.(did, opts);
    } catch(err) {
      this.#logDebug(`Sender key resolution failed for ${did}:`, err);
      return undefined;
    }
  }

  /**
   * Dispatches a message to the appropriate handler of a registered actor based on message type.
   * The message is expected to have already been parsed from the Nostr event content, flattened,
   * and authenticated against the event's signing key by {@link #flattenAndAuthenticate}. The
   * message is then dispatched to the handler registered for its type, if one exists.
   *
   * The call is fire and forget. A handler that throws or rejects gives a warn line with
   * the message type and the sender DID.
   * @param {Record<string, unknown>} message - The flattened, authenticated message.
   * @param {ActorEntry} actor - The registered actor entry containing keys and handlers to dispatch the message to.
   * @returns {void}
   */
  #dispatchMessage(message: Record<string, unknown>, actor: ActorEntry): void {
    const messageType = message.type;
    if(typeof messageType !== 'string' || !isAggregationMessageType(messageType)) return;

    const handler = actor.handlers.get(messageType);
    if(!handler) return;
    // #authenticateSender accepts only a non-empty string `from`.
    const sender = message.from as string;
    try {
      void Promise.resolve(handler(message)).catch((err: unknown) => {
        this.#logHandlerFailure('Directed', messageType, sender, err);
      });
    } catch(err) {
      this.#logHandlerFailure('Directed', messageType, sender, err);
    }
  }

  /**
   * Wrap an event handler for the `onevent` callback of a relay subscription. The relay
   * pool calls `onevent` and does not catch a rejection. The wrapper catches a synchronous
   * throw and a rejection of `handler`, and writes an error line. The wrapper returns nothing.
   * @param {(event: Event) => Promise<void>} handler - The event handler to wrap.
   * @param {string} label - The start of the error line, for example `Broadcast event`.
   * @returns {(event: Event) => void} The `onevent` callback.
   */
  #guardEventHandler(handler: (event: Event) => Promise<void>, label: string): (event: Event) => void {
    return (event: Event): void => {
      try {
        void Promise.resolve(handler(event)).catch((err: unknown) => {
          this.#logUnexpected(`${label} dropped after an unexpected error:`, err);
        });
      } catch(err) {
        this.#logUnexpected(`${label} dropped after an unexpected error:`, err);
      }
    };
  }

  /** Write a debug line. A logger throw does not leave this method. */
  #logDebug(message: string, ...args: unknown[]): void {
    try { this.#logger.debug(message, ...args); } catch { /* the logger failed */ }
  }

  /** Write a warn line for a handler that throws or rejects. A logger throw does not leave this method. */
  #logHandlerFailure(stream: 'Broadcast' | 'Directed', messageType: string, sender: string, err: unknown): void {
    try {
      this.#logger.warn(`${stream} handler for ${messageType} from ${sender} failed:`, err);
    } catch { /* the logger failed */ }
  }

  /** Write an error line for an unexpected throw. A logger throw does not leave this method. */
  #logUnexpected(message: string, err: unknown): void {
    try { this.#logger.error(message, err); } catch { /* the logger failed */ }
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
      this.#logger.debug(`Relay rejected event ${event.id}: ${(r as PromiseRejectedResult).reason}`);
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

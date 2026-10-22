import type { SchnorrKeyPair } from '@did-btcr2/keypair';
import { CompressedSecp256k1PublicKey } from '@did-btcr2/keypair';
import { equalBytes } from '@noble/curves/utils.js';

import type { Logger } from '../core/logger.js';
import { CONSOLE_LOGGER } from '../core/logger.js';
import type { BaseMessage } from '../core/messages/base.js';
import { COHORT_OPT_IN } from '../core/messages/constants.js';
import type { MessageHandler, Transport } from '../core/transport/transport.js';
import { reviveFromWire, signEnvelope, verifyEnvelope } from '../core/transport/http/envelope.js';
import { HttpTransportError } from '../core/transport/http/errors.js';
import { InboxBuffer } from './inbox-buffer.js';
import { NonceCache } from './nonce-cache.js';
import {
  DEFAULT_CLOCK_SKEW_SEC,
  HTTP_ENVELOPE_VERSION,
  HTTP_ROUTE,
  SSE_EVENT,
  type SignedEnvelope,
} from '../core/transport/http/protocol.js';
import { RateLimiter } from './rate-limiter.js';
import { type ParsedRequestAuth, verifyRequestAuth } from '../core/transport/http/request-auth.js';
import { isEnvelopeShape } from '../core/transport/http/wire-checks.js';

/** Framework-agnostic incoming-request shape. */
export interface HttpRequestLike {
  method: string;
  /** Either a full URL or path+query; path extraction works with both. */
  url: string;
  /** Header names MUST be lowercased. */
  headers: Record<string, string>;
  /** Request body (already read). Undefined for GETs. */
  body?: string;
  /** Optional remote-address hint for per-IP policies (advert rate limits etc). */
  remoteAddr?: string;
}

/** Framework-agnostic outgoing-response shape. */
export interface HttpResponseLike {
  status: number;
  headers: Record<string, string>;
  body: string;
}

/**
 * Framework-agnostic SSE stream handle. Callers (Express/Hono/Fastify/Workers)
 * adapt this to their response-writing primitives. All methods are synchronous
 * from the transport's perspective; the adapter is free to buffer/batch.
 */
export interface SseStream {
  /** Write a named event with data and optional id. */
  writeEvent(event: string, data: string, id?: string): void;
  /** Write a comment frame (keepalive; ignored by parsers). */
  writeComment(comment: string): void;
  /** Close the stream from the server side. */
  close(): void;
  /** Register a callback fired when the client disconnects (or we close). */
  onClose(cb: () => void): void;
}

export type CorsPolicy =
  | { mode: 'permissive' }
  | { mode: 'allowlist'; origins: string[] }
  | { mode: 'same-origin' };

export interface HttpServerTransportConfig {
  logger?: Logger;
  /** CORS policy. Defaults to `{ mode: 'permissive' }`. */
  cors?: CorsPolicy;
  /**
   * Envelope / request-auth clock-skew tolerance, seconds. Default 60. A replay cache
   * entry lives for 2 x this value. The server signs a buffered inbox event or a local
   * advert again at delivery if its envelope is older than half of this value.
   */
  clockSkewSec?: number;
  /** Per-recipient inbox buffer size. Default 100. */
  inboxBufferSize?: number;
  /** Advert cache TTL, milliseconds. Default 5 minutes. */
  advertTtlMs?: number;
  /** Custom rate limiter (pre-configured). If absent, uses defaults. */
  rateLimiter?: RateLimiter;
  /** Custom nonce cache (pre-configured). If absent, uses defaults. */
  nonceCache?: NonceCache;
  /** SSE heartbeat interval, milliseconds. Default 20000. Set 0 to disable. */
  heartbeatIntervalMs?: number;
  /**
   * Clock injection point for tests. Returns unix milliseconds. Default `Date.now`.
   *
   * This clock drives:
   * - the envelope and request-auth skew checks
   * - the replay cache expiry
   * - the rate limiter
   * - the advert TTL
   * - the timestamp of each envelope that the server signs.
   */
  now?: () => number;
  /**
   * Maximum accepted request-body size for the authenticated POST routes, measured as the
   * body string length. Bounds the work an unauthenticated party can force before the
   * genesis-bootstrap hash check runs, so a large fake genesis cannot be parsed and hashed.
   * A request larger than this receives 413 before its body is parsed. Default 65536 (64
   * KiB), well above a real genesis document.
   */
  maxBodyBytes?: number;
  /**
   * Resolve a sender's communication public key from its DID when the sender is not a
   * registered peer. Lets the transport stay DID-method-agnostic: the caller supplies
   * the decode (for example, a did:btcr2 KEY identifier yields its genesis key). The
   * optional `genesisDocument` is passed through on a bootstrap opt-in from an as-yet
   * unregistered sender (for example a did:btcr2 EXTERNAL identifier, whose key is not in
   * the DID string but is derivable from its self-verifying genesis document). When
   * omitted, sender resolution is limited to registered peers.
   */
  resolveSenderPk?: (
    did: string,
    opts?: { genesisDocument?: object },
  ) => CompressedSecp256k1PublicKey | undefined;
}

interface ActorEntry {
  keys: SchnorrKeyPair;
  handlers: Map<string, MessageHandler>;
}

interface InboxSubscriber {
  stream: SseStream;
  heartbeatTimer?: ReturnType<typeof setInterval>;
}

interface BroadcastSubscriber {
  stream: SseStream;
  heartbeatTimer?: ReturnType<typeof setInterval>;
}

/**
 * A buffered inbox event. The server signs the envelope again at delivery if it is
 * older than `clockSkewSec / 2`, and keeps the new envelope for later subscribers.
 */
interface PendingDelivery {
  /** The signed envelope that the server delivers. */
  envelope: SignedEnvelope;
  /** The JSON form of {@link PendingDelivery.envelope}: the SSE data. */
  dataJson: string;
}

interface InboxState {
  buffer: InboxBuffer<PendingDelivery>;
  subscribers: Set<InboxSubscriber>;
}

interface CurrentAdvert {
  /** The signed advert envelope that the server delivers. */
  envelope: SignedEnvelope;
  /** The JSON form of {@link CurrentAdvert.envelope}: the SSE data. */
  dataJson: string;
  id: string;
  expiresAtMs: number;
  /**
   * `true` for an advert of {@link HttpServerTransport.publishRepeating}: the server
   * signs it again at delivery if it is older than `clockSkewSec / 2`. `false` for an
   * advert of `POST /v1/adverts`: the server relays it verbatim, and its poster
   * publishes it again on its own interval. A local advert within its TTL stays: a
   * `POST /v1/adverts` does not replace it.
   */
  local: boolean;
}

/** Result of the replay and rate-limit gates of an authenticated route. */
type Admission = 'admitted' | 'replay' | 'rate_limited';

const INBOX_PATH_PREFIX = '/v1/actors/';
const INBOX_PATH_SUFFIX = '/inbox';

const DEFAULT_ADVERT_TTL_MS = 5 * 60 * 1000;
const DEFAULT_HEARTBEAT_MS  = 20_000;
const DEFAULT_MAX_BODY_BYTES = 64 * 1024;

/**
 * Server-side HTTP transport. Sans-I/O - the caller mounts
 * {@link handleRequest} and {@link handleSse} under their HTTP framework of
 * choice; the transport owns only in-memory state (actors, inboxes, advert
 * cache, replay / rate-limit policies).
 *
 * Implements the generic {@link Transport} interface so the aggregation
 * runners can drive it exactly the same way they drive {@link NostrTransport}
 * or {@link HttpClientTransport}.
 */
export class HttpServerTransport implements Transport {
  readonly name = 'http';

  readonly #logger:             Logger;
  readonly #cors:               CorsPolicy;
  readonly #clockSkewSec:       number;
  readonly #inboxBufferSize:    number;
  readonly #advertTtlMs:        number;
  readonly #heartbeatMs:        number;
  readonly #rateLimiter:        RateLimiter;
  readonly #nonceCache:         NonceCache;
  readonly #now:                () => number;
  readonly #maxBodyBytes:       number;
  readonly #resolveSenderPkFn?: (
    did: string,
    opts?: { genesisDocument?: object },
  ) => CompressedSecp256k1PublicKey | undefined;

  readonly #actors:   Map<string, ActorEntry> = new Map();
  readonly #peers:    Map<string, Uint8Array> = new Map();
  readonly #inboxes:  Map<string, InboxState> = new Map();

  readonly #broadcastSubscribers: Set<BroadcastSubscriber> = new Set();

  #currentAdvert?: CurrentAdvert;
  #advertSeq = 0;

  /** Replay cache evictions since the last eviction warning. */
  #evictionsSinceWarn = 0;
  /** Unix second of the last eviction warning. */
  #lastEvictionWarnSec?: number;

  constructor(config: HttpServerTransportConfig = {}) {
    this.#logger          = config.logger ?? CONSOLE_LOGGER;
    this.#cors            = config.cors ?? { mode: 'permissive' };
    this.#clockSkewSec    = config.clockSkewSec ?? DEFAULT_CLOCK_SKEW_SEC;
    this.#inboxBufferSize = config.inboxBufferSize ?? 100;
    this.#advertTtlMs     = config.advertTtlMs ?? DEFAULT_ADVERT_TTL_MS;
    this.#heartbeatMs     = config.heartbeatIntervalMs ?? DEFAULT_HEARTBEAT_MS;
    this.#rateLimiter     = config.rateLimiter ?? new RateLimiter();
    this.#nonceCache      = config.nonceCache ?? new NonceCache();
    this.#now             = config.now ?? (() => Date.now());
    this.#maxBodyBytes    = config.maxBodyBytes ?? DEFAULT_MAX_BODY_BYTES;
    this.#resolveSenderPkFn = config.resolveSenderPk;
  }

  // ----------------------------------------------------------------
  // Transport interface
  // ----------------------------------------------------------------

  start(): void {
    // No-op: server-side transport has no persistent outbound connections.
    // SSE subscribers connect on demand via handleSse().
  }

  /**
   * Detach the transport: close every open SSE subscription, clear the advert
   * cache, and drop all actor / peer / inbox state. Intended for shutdown and
   * for test teardown.
   */
  stop(): void {
    for(const sub of this.#broadcastSubscribers) this.#closeBroadcastSubscriber(sub);
    this.#broadcastSubscribers.clear();
    for(const inbox of this.#inboxes.values()) {
      for(const sub of inbox.subscribers) this.#closeInboxSubscriber(sub);
      inbox.subscribers.clear();
    }
    this.#inboxes.clear();
    this.#currentAdvert = undefined;
  }

  registerActor(did: string, keys: SchnorrKeyPair): void {
    this.#actors.set(did, { keys, handlers: new Map() });
  }

  unregisterActor(did: string): void {
    this.#actors.delete(did);
    this.#peers.delete(did);
  }

  getActorPk(did: string): Uint8Array | undefined {
    return this.#actors.get(did)?.keys.publicKey.compressed;
  }

  registerPeer(did: string, communicationPk: Uint8Array): void {
    try {
      new CompressedSecp256k1PublicKey(communicationPk);
    } catch {
      throw new HttpTransportError(
        `Invalid peer public key for ${did}`,
        'INVALID_PEER_KEY',
        { did, keyLength: communicationPk.length },
      );
    }
    this.#peers.set(did, communicationPk);
  }

  getPeerPk(did: string): Uint8Array | undefined {
    return this.#peers.get(did);
  }

  registerMessageHandler(actorDid: string, messageType: string, handler: MessageHandler): void {
    const actor = this.#actors.get(actorDid);
    if(!actor) {
      throw new HttpTransportError(
        `Cannot register handler: actor ${actorDid} not registered`,
        'UNKNOWN_ACTOR',
        { did: actorDid },
      );
    }
    actor.handlers.set(messageType, handler);
  }

  unregisterMessageHandler(actorDid: string, messageType: string): void {
    this.#actors.get(actorDid)?.handlers.delete(messageType);
  }

  async sendMessage(message: BaseMessage, sender: string, recipient?: string): Promise<void> {
    if(!recipient) {
      throw new HttpTransportError(
        'HttpServerTransport.sendMessage requires a recipient. Use publishRepeating for broadcasts.',
        'MISSING_RECIPIENT',
        { messageType: message.type },
      );
    }
    const actor = this.#actors.get(sender);
    if(!actor) {
      throw new HttpTransportError(
        `Unknown sender: ${sender}`,
        'UNKNOWN_SENDER',
        { did: sender },
      );
    }
    // Sign once for every live subscriber. A sign throw goes to the caller.
    const envelope = signEnvelope(message, { did: sender, keys: actor.keys }, {
      to        : recipient,
      timestamp : Math.floor(this.#now() / 1000),
    });
    const pending: PendingDelivery = { envelope, dataJson: JSON.stringify(envelope) };

    const inbox  = this.#getOrCreateInbox(recipient);
    const stored = inbox.buffer.append(SSE_EVENT.MESSAGE, pending);
    for(const sub of inbox.subscribers) {
      this.#safeWrite(sub.stream, stored.event, pending.dataJson, stored.id);
    }
  }

  publishRepeating(
    message:    BaseMessage,
    sender:     string,
    _intervalMs: number,
    _recipient?: string,
  ): () => void {
    const actor = this.#actors.get(sender);
    if(!actor) {
      throw new HttpTransportError(`Unknown sender: ${sender}`, 'UNKNOWN_SENDER', { did: sender });
    }
    // Sign once for every live subscriber. A sign throw goes to the caller. A late
    // subscriber gets an envelope that the server signs again if this one is stale.
    const nowMs    = this.#now();
    const envelope = signEnvelope(message, { did: sender, keys: actor.keys }, { timestamp: Math.floor(nowMs / 1000) });
    const dataJson = JSON.stringify(envelope);
    const id       = String(++this.#advertSeq);
    const expiresAtMs = nowMs + this.#advertTtlMs;

    this.#currentAdvert = { envelope, dataJson, id, expiresAtMs, local: true };
    for(const sub of this.#broadcastSubscribers) {
      this.#safeWrite(sub.stream, SSE_EVENT.ADVERT, dataJson, id);
    }

    return (): void => {
      if(this.#currentAdvert?.id === id) this.#currentAdvert = undefined;
    };
  }

  // ----------------------------------------------------------------
  // Sans-I/O HTTP surface
  // ----------------------------------------------------------------

  /**
   * Handle a POST / GET request (non-SSE). The caller dispatches SSE paths to
   * {@link handleSse} instead. Returns a fully formed response; the caller's
   * adapter turns it into an HTTP write.
   *
   * The method never rejects. A request target that is not a valid URL gets 404
   * `{ error: 'not_found' }`. An unexpected throw (for example from the injected
   * `resolveSenderPk`) gets a `logger.error` line and 500 `{ error: 'internal_error' }`.
   */
  async handleRequest(req: HttpRequestLike): Promise<HttpResponseLike> {
    try {
      const method = req.method.toUpperCase();
      if(method === 'OPTIONS') return this.#respond(204, '', req);

      const path = extractPath(req.url);
      if(path === undefined) return this.#respondJson(404, { error: 'not_found' }, req);

      if(method === 'GET' && path === HTTP_ROUTE.WELL_KNOWN) {
        return this.#respondJson(200, this.#wellKnownMetadata(), req);
      }
      if(method === 'POST' && path === HTTP_ROUTE.MESSAGES) {
        return await this.#handleMessagesPost(req);
      }
      if(method === 'POST' && path === HTTP_ROUTE.ADVERTS) {
        return await this.#handleAdvertsPost(req);
      }
      return this.#respondJson(404, { error: 'not_found' }, req);
    } catch(err) {
      return this.#internalError(req, err);
    }
  }

  /**
   * Open an SSE stream for a GET request. The caller is responsible for
   * flushing writes and propagating the `onClose` callback when the HTTP
   * connection ends.
   *
   * The method never throws. A request target that is not a valid URL closes the
   * stream. An unexpected throw gets a `logger.error` line and closes the stream;
   * the close fires the `onClose` cleanup of a subscriber that the method added.
   */
  handleSse(req: HttpRequestLike, stream: SseStream): void {
    try {
      if(req.method.toUpperCase() !== 'GET') {
        stream.close();
        return;
      }
      const path = extractPath(req.url);
      if(path === undefined) {
        stream.close();
        return;
      }

      if(path === HTTP_ROUTE.ADVERTS) {
        this.#openBroadcastSubscription(stream);
        return;
      }
      const inboxMatch = matchInboxPath(path);
      if(inboxMatch) {
        this.#openInboxSubscription(req, stream, inboxMatch.did, path);
        return;
      }
      stream.close();
    } catch(err) {
      this.#logUnexpected('SSE request failed with an unexpected error:', err);
      try { stream.close(); } catch { /* already closed */ }
    }
  }

  // ----------------------------------------------------------------
  // Request handlers
  // ----------------------------------------------------------------

  async #handleMessagesPost(req: HttpRequestLike): Promise<HttpResponseLike> {
    const tooLarge = this.#enforceBodySize(req);
    if(tooLarge) return tooLarge;

    // Only no body, a body that does not parse, and `null` are invalid JSON. Every other
    // value that is not an envelope (for example `0` or `false`) is a malformed envelope.
    const body = parseJsonBody(req.body);
    if(body === undefined || body === null) return this.#respondJson(400, { error: 'invalid_json' }, req);
    if(!isEnvelopeShape(body)) return this.#respondJson(400, { error: 'malformed_envelope' }, req);
    const envelope = body;

    // Read the clock once for the skew check, the replay cache, and the rate limiter.
    const nowMs = this.#now();
    const now   = (): number => nowMs;

    const senderPk = this.#resolveSenderPk(envelope.from);
    let bootstrappedPk: CompressedSecp256k1PublicKey | undefined;
    if(senderPk) {
      try {
        verifyEnvelope(envelope, senderPk, { clockSkewSec: this.#clockSkewSec, now });
      } catch(err) {
        this.#logger.debug('POST /v1/messages: envelope verification failed:', err);
        return this.#respondJson(401, { error: 'invalid_envelope' }, req);
      }
    } else {
      // The sender is not a registered peer and its DID does not decode to a key on its
      // own (an EXTERNAL x1 DID commits to a genesis-document hash, not a key). The only
      // way to authenticate is a self-verifying bootstrap opt-in carrying that genesis
      // document; #bootstrapSenderPk derives the key, cross-checks the advertised
      // communicationPk, and verifies the envelope. The derived key is not registered
      // until the request clears every gate below (there is no trust-on-first-use, and a
      // request that is later rejected leaves no peer-registry state behind).
      bootstrappedPk = this.#bootstrapSenderPk(envelope, now);
      if(!bootstrappedPk) return this.#respondJson(401, { error: 'unknown_sender' }, req);
    }

    const admission = this.#admit(envelope.from, envelope.nonce, nowMs);
    if(admission === 'replay') return this.#respondJson(409, { error: 'replay' }, req);
    if(admission === 'rate_limited') return this.#respondJson(429, { error: 'rate_limited' }, req);

    if(!envelope.to) {
      return this.#respondJson(400, { error: 'missing_recipient' }, req);
    }
    const actor = this.#actors.get(envelope.to);
    if(!actor) {
      return this.#respondJson(404, { error: 'unknown_recipient' }, req);
    }

    let revived: Record<string, unknown>;
    try {
      revived = reviveFromWire(envelope.message) as Record<string, unknown>;
    } catch(err) {
      this.#logger.debug('POST /v1/messages: message revive failed:', err);
      return this.#respondJson(400, { error: 'malformed_message' }, req);
    }
    const flat = flattenMessage(revived);

    // Bind the inner message to the authenticated envelope: a sender may only speak as
    // itself. The envelope signature authenticates envelope.from, but the dispatched
    // message carries its own `from` that the runner trusts (it registers a peer and
    // records an opt-in under message.from). Without this check a sender authenticated as
    // its own DID could carry an inner message claiming a different `from`, spoofing that
    // DID into the cohort and poisoning the peer registry for it.
    if(flat.from !== envelope.from) {
      return this.#respondJson(401, { error: 'sender_mismatch' }, req);
    }

    // The request has cleared every gate; only now register a bootstrapped x1 peer, so its
    // later messages resolve from the registry without re-deriving from the genesis. This
    // is the sole point that mutates peer state, and only for a fully-validated request.
    if(bootstrappedPk) {
      this.registerPeer(envelope.from, bootstrappedPk.compressed);
    }

    const messageType = typeof flat.type === 'string' ? flat.type : undefined;
    if(!messageType) return this.#respondJson(400, { error: 'missing_message_type' }, req);

    const handler = actor.handlers.get(messageType);
    if(handler) {
      try { await handler(flat); }
      catch(err) {
        this.#logger.debug(`Handler threw for ${messageType}:`, err);
      }
    }
    return this.#respondJson(202, { ok: true }, req);
  }

  async #handleAdvertsPost(req: HttpRequestLike): Promise<HttpResponseLike> {
    const tooLarge = this.#enforceBodySize(req);
    if(tooLarge) return tooLarge;

    const body = parseJsonBody(req.body);
    if(body === undefined || body === null) return this.#respondJson(400, { error: 'invalid_json' }, req);
    if(!isEnvelopeShape(body)) return this.#respondJson(400, { error: 'malformed_envelope' }, req);
    const envelope = body;

    // Read the clock once for the skew check, the replay cache, the rate limiter, and the TTL.
    const nowMs = this.#now();

    const senderPk = this.#resolveSenderPk(envelope.from);
    if(!senderPk) return this.#respondJson(401, { error: 'unknown_sender' }, req);

    // An advert is a broadcast: `expectedTo: undefined` refuses an envelope with a
    // recipient. Else a recipient could post an inbox envelope of an actor here, and
    // the server would relay it to every broadcast subscriber as the current advert.
    try {
      verifyEnvelope(envelope, senderPk, {
        clockSkewSec : this.#clockSkewSec,
        now          : () => nowMs,
        expectedTo   : undefined,
      });
    } catch(err) {
      this.#logger.debug('POST /v1/adverts: envelope verification failed:', err);
      return this.#respondJson(401, { error: 'invalid_envelope' }, req);
    }

    // A local advert within its TTL stays. GET /v1/adverts gives its envelope to anyone,
    // and the server stored no nonce for an envelope that it signed. Thus a POST of that
    // envelope passes each gate. A posted copy gets no new signature at delivery, and the
    // stop function of publishRepeating does not clear it.
    const current = this.#currentAdvert;
    if(current?.local && current.expiresAtMs > nowMs) {
      return this.#respondJson(409, { error: 'local_advert' }, req);
    }

    const admission = this.#admit(envelope.from, envelope.nonce, nowMs);
    if(admission === 'replay') return this.#respondJson(409, { error: 'replay' }, req);
    if(admission === 'rate_limited') return this.#respondJson(429, { error: 'rate_limited' }, req);

    // Only registered actors can publish adverts on this server.
    if(!this.#actors.has(envelope.from)) {
      return this.#respondJson(403, { error: 'not_an_actor' }, req);
    }

    // Bind the inner message to the authenticated envelope, exactly as POST /v1/messages
    // does. The advert is relayed verbatim to every broadcast subscriber, and a
    // participant reads the service DID it will join from the inner `from`, so an
    // unbound advert lets one actor advertise a cohort in another DID's name.
    let revived: Record<string, unknown>;
    try {
      revived = reviveFromWire(envelope.message) as Record<string, unknown>;
    } catch(err) {
      this.#logger.debug('POST /v1/adverts: message revive failed:', err);
      return this.#respondJson(400, { error: 'malformed_message' }, req);
    }
    const flat = flattenMessage(revived);
    if(flat.from !== envelope.from) {
      return this.#respondJson(401, { error: 'sender_mismatch' }, req);
    }

    // The server relays a posted advert verbatim and does not sign it again: its
    // poster publishes it again on its own interval.
    const id       = String(++this.#advertSeq);
    const dataJson = JSON.stringify(envelope);
    this.#currentAdvert = {
      envelope,
      dataJson,
      id,
      expiresAtMs : nowMs + this.#advertTtlMs,
      local       : false,
    };
    for(const sub of this.#broadcastSubscribers) {
      this.#safeWrite(sub.stream, SSE_EVENT.ADVERT, dataJson, id);
    }
    return this.#respondJson(202, { ok: true }, req);
  }

  #openBroadcastSubscription(stream: SseStream): void {
    const sub: BroadcastSubscriber = { stream };
    this.#broadcastSubscribers.add(sub);
    stream.onClose(() => {
      this.#closeBroadcastSubscriber(sub);
      this.#broadcastSubscribers.delete(sub);
    });

    // Replay the current advert if it is within its TTL. A stale local advert gets a
    // new signature first, and the new envelope replaces the cached one. A posted
    // advert goes out verbatim.
    const nowMs  = this.#now();
    const advert = this.#currentAdvert;
    if(advert && advert.expiresAtMs > nowMs
      && (!advert.local || this.#refreshForDelivery(advert, Math.floor(nowMs / 1000)))) {
      this.#safeWrite(stream, SSE_EVENT.ADVERT, advert.dataJson, advert.id);
    }

    if(this.#heartbeatMs > 0) {
      sub.heartbeatTimer = setInterval(() => {
        try { stream.writeComment('hb'); } catch { /* caller-owned failure */ }
      }, this.#heartbeatMs);
    }
  }

  #openInboxSubscription(req: HttpRequestLike, stream: SseStream, did: string, path: string): void {
    const auth = req.headers.authorization;
    if(!auth) {
      this.#logger.debug(`Inbox subscribe: missing authorization header for ${did}`);
      stream.close();
      return;
    }
    const senderPk = this.#resolveSenderPk(did);
    if(!senderPk) {
      stream.close();
      return;
    }
    // Read the clock once for the skew check, the replay cache, the rate limiter, and the
    // delivery of the buffered events.
    const nowMs = this.#now();
    let parsed: ParsedRequestAuth;
    try {
      parsed = verifyRequestAuth(auth, path, senderPk, {
        clockSkewSec : this.#clockSkewSec,
        now          : () => nowMs,
      });
    } catch(err) {
      this.#logger.debug(`Inbox subscribe: auth verification failed for ${did}:`, err);
      stream.close();
      return;
    }
    if(parsed.did !== did) {
      stream.close();
      return;
    }
    const admission = this.#admit(did, parsed.nonce, nowMs);
    if(admission !== 'admitted') {
      this.#logger.debug(`Inbox subscribe: refused for ${did}: ${admission}`);
      stream.close();
      return;
    }

    const inbox = this.#getOrCreateInbox(did);
    const sub: InboxSubscriber = { stream };
    inbox.subscribers.add(sub);
    stream.onClose(() => {
      this.#closeInboxSubscriber(sub);
      inbox.subscribers.delete(sub);
    });

    // Replay buffered events since the client's Last-Event-ID, if any. A stale event
    // gets a new signature, and the new envelope replaces the buffered one, so a later
    // subscriber uses it again. The event id does not change. An event that the server
    // cannot sign again is skipped; the next events still go out.
    const lastEventId = req.headers['last-event-id'];
    const nowSec      = Math.floor(nowMs / 1000);
    for(const stored of inbox.buffer.since(lastEventId)) {
      if(!this.#refreshForDelivery(stored.data, nowSec)) continue;
      this.#safeWrite(stream, stored.event, stored.data.dataJson, stored.id);
    }

    if(this.#heartbeatMs > 0) {
      sub.heartbeatTimer = setInterval(() => {
        try { stream.writeComment('hb'); } catch { /* caller-owned failure */ }
      }, this.#heartbeatMs);
    }
  }

  // ----------------------------------------------------------------
  // Internal helpers
  // ----------------------------------------------------------------

  #getOrCreateInbox(did: string): InboxState {
    let inbox = this.#inboxes.get(did);
    if(!inbox) {
      inbox = { buffer: new InboxBuffer<PendingDelivery>(this.#inboxBufferSize), subscribers: new Set() };
      this.#inboxes.set(did, inbox);
    }
    return inbox;
  }

  #resolveSenderPk(
    did: string,
    opts?: { genesisDocument?: object },
  ): CompressedSecp256k1PublicKey | undefined {
    const peerBytes = this.#peers.get(did);
    if(peerBytes) {
      try { return new CompressedSecp256k1PublicKey(peerBytes); }
      catch { /* fall through to the injected resolver */ }
    }
    return this.#resolveSenderPkFn?.(did, opts);
  }

  /**
   * Bootstrap-authenticate a sender that {@link #resolveSenderPk} could not resolve, from a
   * self-verifying COHORT_OPT_IN. An EXTERNAL (x1) did:btcr2 DID commits to the hash of its
   * genesis document, so a genesis carried in-band on the opt-in authenticates the sender's
   * communication key with zero trust. This derives the key through the injected
   * genesis-aware resolver (which rejects a genesis that does not hash to the DID),
   * cross-checks it against the advertised `communicationPk` (so a controller cannot
   * authenticate with one key while advertising another), and verifies the envelope
   * signature against it. Returns the derived key on success, or `undefined` on any
   * failure. It performs no registration and mutates no state: the caller registers the
   * returned key only after the request clears its remaining gates (there is no
   * trust-on-first-use). A message that does not revive (for example a malformed
   * `__bytes` sentinel) also returns `undefined`.
   */
  #bootstrapSenderPk(envelope: SignedEnvelope, now: () => number): CompressedSecp256k1PublicKey | undefined {
    if(!this.#resolveSenderPkFn) return undefined;

    // Inspect the still-untrusted message only to derive a candidate key; nothing is
    // trusted until the envelope verifies against that key below.
    let flat: Record<string, unknown>;
    try {
      flat = flattenMessage(reviveFromWire(envelope.message) as Record<string, unknown>);
    } catch(err) {
      this.#logger.debug('POST /v1/messages: bootstrap message revive failed:', err);
      return undefined;
    }
    if(flat.type !== COHORT_OPT_IN) return undefined;

    const genesisDocument = flat.genesisDocument;
    if(!genesisDocument || typeof genesisDocument !== 'object') return undefined;

    const derived = this.#resolveSenderPkFn(envelope.from, { genesisDocument: genesisDocument as object });
    if(!derived) return undefined;

    const communicationPk = flat.communicationPk;
    if(!(communicationPk instanceof Uint8Array) || !equalBytes(communicationPk, derived.compressed)) {
      return undefined;
    }

    try {
      verifyEnvelope(envelope, derived, { clockSkewSec: this.#clockSkewSec, now });
    } catch(err) {
      this.#logger.debug('POST /v1/messages: bootstrap envelope verification failed:', err);
      return undefined;
    }

    return derived;
  }

  /**
   * The replay and rate-limit gates of an authenticated route. The caller verifies
   * the envelope or the auth header first. The order is:
   * 1. The replay lookup: a live `(did, nonce)` entry is a replay. This stores nothing.
   * 2. The rate limiter. A throttled request stores no nonce, so it can come again
   *    after the refill.
   * 3. The nonce store. The entry lives until `nowSec + 2 * clockSkewSec`: a replay
   *    can pass the skew check only until then.
   *
   * A replay costs no token, so a replay of a captured envelope cannot drain the
   * bucket of its sender.
   */
  #admit(did: string, nonce: string, nowMs: number): Admission {
    const nowSec = Math.floor(nowMs / 1000);
    if(this.#nonceCache.has(did, nonce, nowSec)) return 'replay';
    if(!this.#rateLimiter.consume(did, nowMs)) return 'rate_limited';
    const result = this.#nonceCache.store(did, nonce, nowSec + 2 * this.#clockSkewSec, nowSec);
    if(result === 'evicted') this.#noteEviction(nowSec);
    return 'admitted';
  }

  /**
   * Count a replay cache eviction. Write at most one warning per `clockSkewSec`
   * window. The warning gives the count of evictions since the previous warning
   * (or since the start). A clock step back starts a new window.
   */
  #noteEviction(nowSec: number): void {
    this.#evictionsSinceWarn++;
    const last = this.#lastEvictionWarnSec;
    if(last !== undefined && nowSec >= last && nowSec - last < this.#clockSkewSec) return;
    this.#logger.warn(
      `Replay cache full: live entries evicted since the previous warning or the start: ${this.#evictionsSinceWarn}. `
      + 'A replay of an evicted envelope passes until its timestamp leaves the skew window.',
      { evicted: this.#evictionsSinceWarn, windowSec: this.#clockSkewSec },
    );
    this.#evictionsSinceWarn  = 0;
    this.#lastEvictionWarnSec = nowSec;
  }

  /**
   * Make sure that a held envelope is fresh for a delivery at `nowSec`. If the
   * envelope is older than `clockSkewSec / 2`, sign its message again and replace the
   * envelope and its JSON form in `held`. Returns `false` if the server cannot sign
   * again: the caller skips the event.
   */
  #refreshForDelivery(held: PendingDelivery, nowSec: number): boolean {
    if(nowSec - held.envelope.timestamp <= this.#clockSkewSec / 2) return true;
    const envelope = this.#signAgain(held.envelope, nowSec);
    if(!envelope) return false;
    held.envelope = envelope;
    held.dataJson = JSON.stringify(envelope);
    return true;
  }

  /**
   * Sign the wire form of `envelope.message` again with the current actor keys of
   * `envelope.from`, the same recipient, and the timestamp `nowSec`. Returns
   * `undefined` with a log line if the sender is no longer an actor or the sign throws.
   */
  #signAgain(envelope: SignedEnvelope, nowSec: number): SignedEnvelope | undefined {
    const actor = this.#actors.get(envelope.from);
    if(!actor) {
      this.#logger.debug(`SSE delivery: ${envelope.from} is no longer an actor; event skipped`);
      return undefined;
    }
    try {
      return signEnvelope(envelope.message, { did: envelope.from, keys: actor.keys }, {
        to        : envelope.to,
        timestamp : nowSec,
      });
    } catch(err) {
      this.#logger.warn(`SSE delivery: sign failed for an event of ${envelope.from}; event skipped:`, err);
      return undefined;
    }
  }

  /** The 500 answer to an unexpected throw. It does not throw. */
  #internalError(req: HttpRequestLike, err: unknown): HttpResponseLike {
    this.#logUnexpected('HTTP request failed with an unexpected error:', err);
    let cors: Record<string, string> = {};
    try { cors = this.#corsHeaders(req); } catch { /* a malformed request: no CORS headers */ }
    return {
      status  : 500,
      headers : { 'content-type': 'application/json', ...cors },
      body    : JSON.stringify({ error: 'internal_error' }),
    };
  }

  /** Write an error line for an unexpected throw. A logger throw does not go to the caller. */
  #logUnexpected(message: string, err: unknown): void {
    try { this.#logger.error(message, err); } catch { /* the logger failed */ }
  }

  /**
   * Reject an over-large request body before it is parsed, so a large fake genesis cannot be
   * parsed and hashed. Returns a 413 response when the body exceeds {@link #maxBodyBytes},
   * or `undefined` to continue.
   */
  #enforceBodySize(req: HttpRequestLike): HttpResponseLike | undefined {
    if(req.body !== undefined && req.body.length > this.#maxBodyBytes) {
      return this.#respondJson(413, { error: 'payload_too_large' }, req);
    }
    return undefined;
  }

  #safeWrite(stream: SseStream, event: string, data: string, id?: string): void {
    try { stream.writeEvent(event, data, id); }
    catch(err) { this.#logger.debug('SSE writeEvent failed:', err); }
  }

  #closeBroadcastSubscriber(sub: BroadcastSubscriber): void {
    if(sub.heartbeatTimer) clearInterval(sub.heartbeatTimer);
    try { sub.stream.close(); } catch { /* already closed */ }
  }

  #closeInboxSubscriber(sub: InboxSubscriber): void {
    if(sub.heartbeatTimer) clearInterval(sub.heartbeatTimer);
    try { sub.stream.close(); } catch { /* already closed */ }
  }

  #respondJson(status: number, body: unknown, req: HttpRequestLike): HttpResponseLike {
    return {
      status,
      headers : { 'content-type': 'application/json', ...this.#corsHeaders(req) },
      body    : JSON.stringify(body),
    };
  }

  #respond(status: number, body: string, req: HttpRequestLike): HttpResponseLike {
    return { status, headers: this.#corsHeaders(req), body };
  }

  #corsHeaders(req: HttpRequestLike): Record<string, string> {
    const origin = req.headers.origin;
    if(!origin) return {};
    const common: Record<string, string> = {
      'access-control-allow-methods' : 'GET, POST, OPTIONS',
      'access-control-allow-headers' : 'authorization, content-type, last-event-id',
      'access-control-max-age'       : '86400',
    };
    switch(this.#cors.mode) {
      case 'permissive':
        return { 'access-control-allow-origin': '*', ...common };
      case 'allowlist':
        if(this.#cors.origins.includes(origin)) {
          return { 'access-control-allow-origin': origin, vary: 'origin', ...common };
        }
        return {};
      case 'same-origin':
        return {};
    }
  }

  #wellKnownMetadata(): Record<string, unknown> {
    return {
      envelopeVersion     : HTTP_ENVELOPE_VERSION,
      heartbeatIntervalMs : this.#heartbeatMs,
      inboxBufferSize     : this.#inboxBufferSize,
      advertTtlMs         : this.#advertTtlMs,
    };
  }
}

// ----------------------------------------------------------------
// Module-local pure helpers
// ----------------------------------------------------------------

/** Return the path of a request target, or `undefined` if an absolute URL does not parse. */
function extractPath(reqUrl: string): string | undefined {
  if(reqUrl.startsWith('http://') || reqUrl.startsWith('https://')) {
    try { return new URL(reqUrl).pathname; }
    catch { return undefined; }
  }
  const q = reqUrl.indexOf('?');
  return q === -1 ? reqUrl : reqUrl.slice(0, q);
}

function matchInboxPath(path: string): { did: string } | undefined {
  if(!path.startsWith(INBOX_PATH_PREFIX) || !path.endsWith(INBOX_PATH_SUFFIX)) return undefined;
  const encodedDid = path.slice(INBOX_PATH_PREFIX.length, path.length - INBOX_PATH_SUFFIX.length);
  if(!encodedDid) return undefined;
  try { return { did: decodeURIComponent(encodedDid) }; }
  catch { return undefined; }
}

/** Parse a JSON request body. Returns `undefined` for no body or a body that does not parse. */
function parseJsonBody(body: string | undefined): unknown {
  if(body === undefined || body === '') return undefined;
  try { return JSON.parse(body) as unknown; }
  catch { return undefined; }
}

/**
 * Copy the members of `msg.body` to the top level of the message. The result keeps the
 * outer `body` as its `body` member. Thus a `body` member inside `body` cannot replace
 * it, and the checks of the transport and the state machines read the same members.
 */
function flattenMessage(msg: Record<string, unknown>): Record<string, unknown> {
  const body = msg.body;
  if(body && typeof body === 'object') {
    return { ...msg, ...(body as Record<string, unknown>), body };
  }
  return msg;
}

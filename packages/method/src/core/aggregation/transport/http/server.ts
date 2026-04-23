import type { SchnorrKeyPair } from '@did-btcr2/keypair';
import { CompressedSecp256k1PublicKey } from '@did-btcr2/keypair';

import { Identifier } from '../../../identifier.js';
import type { Logger } from '../../logger.js';
import { CONSOLE_LOGGER } from '../../logger.js';
import type { BaseMessage } from '../../messages/base.js';
import type { MessageHandler, Transport } from '../transport.js';
import { reviveFromWire, signEnvelope, verifyEnvelope } from './envelope.js';
import { HttpTransportError } from './errors.js';
import { InboxBuffer } from './inbox-buffer.js';
import { NonceCache } from './nonce-cache.js';
import {
  DEFAULT_CLOCK_SKEW_SEC,
  HTTP_ENVELOPE_VERSION,
  HTTP_ROUTE,
  SSE_EVENT,
  type SignedEnvelope,
} from './protocol.js';
import { RateLimiter } from './rate-limiter.js';
import { verifyRequestAuth } from './request-auth.js';

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
  /** Envelope / request-auth clock-skew tolerance, seconds. */
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
  /** Clock injection point for tests. Returns unix milliseconds. */
  now?: () => number;
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

interface InboxState {
  buffer: InboxBuffer;
  subscribers: Set<InboxSubscriber>;
}

interface CurrentAdvert {
  dataJson: string;
  id: string;
  expiresAtMs: number;
}

const INBOX_PATH_PREFIX = '/v1/actors/';
const INBOX_PATH_SUFFIX = '/inbox';

const DEFAULT_ADVERT_TTL_MS = 5 * 60 * 1000;
const DEFAULT_HEARTBEAT_MS  = 20_000;

/**
 * Server-side HTTP transport. Sans-I/O — the caller mounts
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

  readonly #actors:   Map<string, ActorEntry> = new Map();
  readonly #peers:    Map<string, Uint8Array> = new Map();
  readonly #inboxes:  Map<string, InboxState> = new Map();

  readonly #broadcastSubscribers: Set<BroadcastSubscriber> = new Set();

  #currentAdvert?: CurrentAdvert;
  #advertSeq = 0;

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
    const envelope = signEnvelope(message, { did: sender, keys: actor.keys }, { to: recipient });
    const dataJson = JSON.stringify(envelope);

    const inbox  = this.#getOrCreateInbox(recipient);
    const stored = inbox.buffer.append(SSE_EVENT.MESSAGE, dataJson);
    for(const sub of inbox.subscribers) {
      this.#safeWrite(sub.stream, stored.event, stored.data, stored.id);
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
    const envelope = signEnvelope(message, { did: sender, keys: actor.keys });
    const dataJson = JSON.stringify(envelope);
    const id       = String(++this.#advertSeq);
    const expiresAtMs = this.#now() + this.#advertTtlMs;

    this.#currentAdvert = { dataJson, id, expiresAtMs };
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
   */
  async handleRequest(req: HttpRequestLike): Promise<HttpResponseLike> {
    const method = req.method.toUpperCase();
    if(method === 'OPTIONS') return this.#respond(204, '', req);

    const path = extractPath(req.url);

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
  }

  /**
   * Open an SSE stream for a GET request. The caller is responsible for
   * flushing writes and propagating the `onClose` callback when the HTTP
   * connection ends.
   */
  handleSse(req: HttpRequestLike, stream: SseStream): void {
    if(req.method.toUpperCase() !== 'GET') {
      stream.close();
      return;
    }
    const path = extractPath(req.url);

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
  }

  // ----------------------------------------------------------------
  // Request handlers
  // ----------------------------------------------------------------

  async #handleMessagesPost(req: HttpRequestLike): Promise<HttpResponseLike> {
    const envelope = parseJsonBody<SignedEnvelope>(req.body);
    if(!envelope) return this.#respondJson(400, { error: 'invalid_json' }, req);

    const senderPk = this.#resolveSenderPk(envelope.from);
    if(!senderPk) {
      return this.#respondJson(401, { error: 'unknown_sender' }, req);
    }

    try {
      verifyEnvelope(envelope, senderPk, { clockSkewSec: this.#clockSkewSec });
    } catch(err) {
      this.#logger.debug('POST /v1/messages: envelope verification failed:', err);
      return this.#respondJson(401, { error: 'invalid_envelope' }, req);
    }

    if(!this.#nonceCache.store(envelope.from, envelope.nonce, envelope.timestamp)) {
      return this.#respondJson(409, { error: 'replay' }, req);
    }

    if(!this.#rateLimiter.consume(envelope.from, this.#now())) {
      return this.#respondJson(429, { error: 'rate_limited' }, req);
    }

    if(!envelope.to) {
      return this.#respondJson(400, { error: 'missing_recipient' }, req);
    }
    const actor = this.#actors.get(envelope.to);
    if(!actor) {
      return this.#respondJson(404, { error: 'unknown_recipient' }, req);
    }

    const revived = reviveFromWire(envelope.message) as Record<string, unknown>;
    const flat = flattenMessage(revived);
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
    const envelope = parseJsonBody<SignedEnvelope>(req.body);
    if(!envelope) return this.#respondJson(400, { error: 'invalid_json' }, req);

    const senderPk = this.#resolveSenderPk(envelope.from);
    if(!senderPk) return this.#respondJson(401, { error: 'unknown_sender' }, req);

    try {
      verifyEnvelope(envelope, senderPk, { clockSkewSec: this.#clockSkewSec });
    } catch {
      return this.#respondJson(401, { error: 'invalid_envelope' }, req);
    }

    if(!this.#nonceCache.store(envelope.from, envelope.nonce, envelope.timestamp)) {
      return this.#respondJson(409, { error: 'replay' }, req);
    }
    if(!this.#rateLimiter.consume(envelope.from, this.#now())) {
      return this.#respondJson(429, { error: 'rate_limited' }, req);
    }

    // Only registered actors can publish adverts on this server.
    if(!this.#actors.has(envelope.from)) {
      return this.#respondJson(403, { error: 'not_an_actor' }, req);
    }

    const id = String(++this.#advertSeq);
    this.#currentAdvert = {
      dataJson    : JSON.stringify(envelope),
      id,
      expiresAtMs : this.#now() + this.#advertTtlMs,
    };
    for(const sub of this.#broadcastSubscribers) {
      this.#safeWrite(sub.stream, SSE_EVENT.ADVERT, this.#currentAdvert.dataJson, id);
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

    // Replay current advert if still within TTL.
    if(this.#currentAdvert && this.#currentAdvert.expiresAtMs > this.#now()) {
      this.#safeWrite(stream, SSE_EVENT.ADVERT, this.#currentAdvert.dataJson, this.#currentAdvert.id);
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
    let parsedTs = 0;
    let parsedNonce = '';
    try {
      const parsed = verifyRequestAuth(auth, path, senderPk, {
        clockSkewSec : this.#clockSkewSec,
        now          : () => this.#now(),
      });
      if(parsed.did !== did) { stream.close(); return; }
      parsedTs    = parsed.ts;
      parsedNonce = parsed.nonce;
    } catch(err) {
      this.#logger.debug(`Inbox subscribe: auth verification failed for ${did}:`, err);
      stream.close();
      return;
    }
    if(!this.#nonceCache.store(did, parsedNonce, parsedTs)) {
      stream.close();
      return;
    }
    if(!this.#rateLimiter.consume(did, this.#now())) {
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

    // Replay buffered events since the client's Last-Event-ID, if any.
    const lastEventId = req.headers['last-event-id'];
    for(const stored of inbox.buffer.since(lastEventId)) {
      this.#safeWrite(stream, stored.event, stored.data, stored.id);
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
      inbox = { buffer: new InboxBuffer(this.#inboxBufferSize), subscribers: new Set() };
      this.#inboxes.set(did, inbox);
    }
    return inbox;
  }

  #resolveSenderPk(did: string): CompressedSecp256k1PublicKey | undefined {
    const peerBytes = this.#peers.get(did);
    if(peerBytes) {
      try { return new CompressedSecp256k1PublicKey(peerBytes); }
      catch { /* fall through */ }
    }
    try {
      const components = Identifier.decode(did);
      if(components.idType === 'KEY') {
        return new CompressedSecp256k1PublicKey(components.genesisBytes);
      }
    } catch { /* not decodable */ }
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

function extractPath(reqUrl: string): string {
  if(reqUrl.startsWith('http://') || reqUrl.startsWith('https://')) {
    return new URL(reqUrl).pathname;
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

function parseJsonBody<T>(body: string | undefined): T | undefined {
  if(body === undefined || body === '') return undefined;
  try { return JSON.parse(body) as T; }
  catch { return undefined; }
}

function flattenMessage(msg: Record<string, unknown>): Record<string, unknown> {
  if(msg.body && typeof msg.body === 'object') {
    return { ...msg, ...(msg.body as Record<string, unknown>) };
  }
  return msg;
}

import type { SchnorrKeyPair } from '@did-btcr2/keypair';
import { CompressedSecp256k1PublicKey } from '@did-btcr2/keypair';
import { equalBytes } from '@noble/curves/utils.js';

import type { Logger } from '../core/logger.js';
import { CONSOLE_LOGGER } from '../core/logger.js';
import type { BaseMessage } from '../core/messages/base.js';
import type { MessageHandler, Transport } from '../core/transport/transport.js';
import { reviveFromWire, signEnvelope, verifyEnvelope } from '../core/transport/http/envelope.js';
import { HttpTransportError } from '../core/transport/http/errors.js';
import {
  DEFAULT_CLOCK_SKEW_SEC,
  HTTP_ROUTE,
  SSE_EVENT,
  type SignedEnvelope,
} from '../core/transport/http/protocol.js';
import { buildRequestAuth } from '../core/transport/http/request-auth.js';
import { isEnvelopeShape } from '../core/transport/http/wire-checks.js';
import type { SseParseOptions } from './sse-stream.js';
import { parseSseStream } from './sse-stream.js';

export interface HttpClientTransportConfig {
  /**
   * Base URL of the aggregation service (e.g. `https://aggregator.example.com/`). The URL
   * must be absolute, use https, and hold no username or password. The client accepts
   * plain http only for a loopback host (see {@link HttpClientTransport}), or if
   * `allowInsecureHttp` is `true`.
   */
  baseUrl: string | URL;
  /**
   * Accept plain http on any host. Default `false`.
   *
   * If `true`, signed envelopes, MuSig2 nonces, and partial signatures go over the network
   * in clear. Use it only behind a trusted TLS proxy or on a closed test network.
   */
  allowInsecureHttp?: boolean;
  /**
   * Custom `fetch` implementation (tests, React Native). Defaults to `globalThis.fetch`.
   * The client calls the function with no `this` value, so the global `fetch` of a
   * browser works without a bind.
   */
  fetchImpl?: typeof fetch;
  /** Diagnostic logger. Defaults to {@link CONSOLE_LOGGER}. */
  logger?: Logger;
  /**
   * Reconnect backoff (ms) for an attempt count (0-based). The client waits this delay after
   * every attempt of an SSE subscription. The attempt count goes back to 0 after an attempt
   * that received at least one byte (an event or a heartbeat comment).
   */
  reconnectBackoff?: (attempt: number) => number;
  /** Clock-skew tolerance in seconds for each broadcast and inbox envelope. Default 60. */
  clockSkewSec?: number;
  /**
   * The maximum byte count of one SSE event, for each broadcast event and each inbox
   * event. Default: no limit. A number greater than 0 sets the limit. The parser ignores
   * each other value. `RECOMMENDED_MAX_SSE_EVENT_BYTES` is the recommended value.
   *
   * If an event is larger than the limit, the client writes a `logger.warn` line and
   * closes the stream. It then connects again after the backoff delay. The attempt
   * counts as a failed attempt, also if bytes arrived. See
   * {@link SseParseOptions.maxEventBytes} for the byte count rule.
   *
   * If an inbox event is larger than the limit, the parser can give the `id` value of
   * that event (see {@link SseParseOptions.maxEventBytes}). The client then applies that
   * id with the inbox resume rules of {@link HttpClientTransport}. If the id replaces the
   * resume id, the next inbox request resumes after the refused event. The actor then
   * loses only that event. `formatSseEvent` writes the `id` field first. If the
   * `SseStream` adapter of `HttpServerTransport` uses it and the `id` line fits in the
   * limit, the parser gives the id of a refused event.
   *
   * In these cases, the resume id does not skip the refused event:
   * - The event has no `id` field before the count becomes greater than the limit.
   * - The id is equal to the resume id.
   * - The client ignores the id.
   * - The id is empty. The empty id clears the resume id, so the server sends each
   *   retained event again, also the events before the refused event.
   *
   * The server then sends the refused event again at each reconnect. Thus the inbox of
   * the actor gets no later event while the server holds that event in its buffer. The
   * client connects again at the backoff rate.
   */
  maxSseEventBytes?: number;
  /**
   * Resolve a sender's communication public key from its DID when the sender is not a
   * registered peer. Lets the transport stay DID-method-agnostic: the caller supplies
   * the decode (for example, a did:btcr2 KEY identifier yields its genesis key). The
   * optional `genesisDocument` mirrors the server transport's genesis-aware signature so a
   * single injected resolver serves both; the client does not itself bootstrap senders.
   * When omitted, sender resolution is limited to registered peers. If the function
   * throws, the client drops the event.
   */
  resolveSenderPk?: (
    did: string,
    opts?: { genesisDocument?: object },
  ) => CompressedSecp256k1PublicKey | undefined;
}

/** Default exponential backoff: 1s, 2s, 4s, ..., capped at 30s, 20% jitter. */
export function defaultReconnectBackoff(attempt: number): number {
  const base   = Math.min(1000 * 2 ** attempt, 30_000);
  const jitter = base * 0.2 * Math.random();
  return Math.floor(base + jitter);
}

interface ActorEntry {
  keys: SchnorrKeyPair;
  handlers: Map<string, MessageHandler>;
  inboxAbort?: AbortController;
  /** The id of the last inbox event. The next inbox request sends it in `Last-Event-ID`. */
  lastEventId?: string;
}

/** Progress of one SSE subscription attempt. */
interface AttemptProgress {
  /** `true` after the attempt received at least one body byte. */
  received: boolean;
  /** `true` if the attempt ended with an event above the size limit. The attempt then counts as failed. */
  tooLarge: boolean;
}

/** The message of an `INVALID_BASE_URL` error. */
const INVALID_BASE_URL_MESSAGE = 'The baseUrl must be an absolute http or https URL.';

/** The message of an `INVALID_BASE_URL` error for a URL with a username or a password. */
const BASE_URL_CREDENTIALS_MESSAGE = 'The baseUrl must not hold a username or a password.';

/** The message of an `INSECURE_BASE_URL` error. */
const INSECURE_BASE_URL_MESSAGE =
  'The baseUrl must use https. Plain http is allowed only for a loopback host, or if allowInsecureHttp is true.';

/** An IPv4 host in 127.0.0.0/8, in the serialized form of the URL parser. */
const IPV4_LOOPBACK_HOST = /^127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/;

/**
 * 1 to 256 visible ASCII characters (0x21 to 0x7E). Fetch accepts each of these
 * characters in a header. The length limit keeps the request headers small.
 */
const LAST_EVENT_ID_PATTERN = /^[\x21-\x7E]{1,256}$/;

/** The maximum count of bytes that the client reads from the body of a failed POST. */
const ERROR_BODY_MAX_BYTES = 1024;

/** The maximum count of characters of a failed POST body in the error data. */
const ERROR_BODY_MAX_CHARS = 256;

/**
 * HTTP transport client. Implements the transport-agnostic {@link Transport}
 * interface; the wire is fetch-based SSE for incoming events and fetch-based
 * POST for outgoing messages. All runtime I/O goes through `fetchImpl` so
 * tests can substitute a mock without touching the network.
 *
 * Transport security:
 * - The base URL must use https. The client accepts plain http only for a loopback
 *   host, or if `allowInsecureHttp` is `true`. Else the constructor throws
 *   `INSECURE_BASE_URL`.
 * - A loopback host is an IPv4 address in 127.0.0.0/8, the IPv6 address `::1`, or a
 *   localhost name. A localhost name is `localhost` or a name that ends with
 *   `.localhost`. Each name can have a trailing dot. An IPv4-mapped IPv6 address is
 *   not a loopback host.
 * - A localhost name is a trust assumption: the host must resolve each localhost name
 *   to a loopback address.
 * - The client does not follow redirects (`redirect: 'manual'`). A redirect answer is a
 *   failed request: `sendMessage` throws `SEND_MESSAGE_HTTP`, and an SSE subscription
 *   waits the backoff delay and connects again. Node and Cloudflare Workers give the 3xx
 *   answer. A browser gives an opaque redirect answer with status 0 for a same-origin
 *   request, or if the redirect answer passes the CORS check.
 * - In a browser, fetch rejects for a cross-origin redirect answer that fails the CORS
 *   check, and for a CORS preflight that gets a redirect. `sendMessage` then gives the
 *   rejection to the caller. An SSE subscription writes a debug line, waits the backoff
 *   delay, and connects again. The client does not follow the redirect in each case.
 *
 * Inbox resume: the client keeps the id of the last inbox event of each actor and
 * sends it in `Last-Event-ID` at each reconnect. The server then sends only the later
 * events. The client ignores an id that is longer than 256 characters or that holds a
 * character outside 0x21 to 0x7E. {@link HttpClientTransport.stop} and
 * {@link HttpClientTransport.start} keep the id. A new
 * {@link HttpClientTransport.registerActor} starts with no id, so the server sends
 * each retained event again: handlers must be idempotent.
 *
 * Event failures: the client drops a malformed event, an event from a sender that it
 * cannot resolve, and an event that fails a check. Each drop gets a `logger.debug`
 * line. A handler that throws or rejects gets a `logger.warn` line. Any other throw in
 * the dispatch of one event gets a `logger.error` line, and the client drops the
 * event. The stream stays open in each case. An event above `maxSseEventBytes` gets a
 * `logger.warn` line, and the client closes the stream and connects again. For an inbox
 * event, the client skips the event if the parser gives its id and that id replaces the
 * resume id (see `maxSseEventBytes`).
 *
 * Subscription loops: a logger that throws does not end a loop. A `reconnectBackoff`
 * that throws ends the loop with a `logger.error` line. The subscription then stays
 * closed. Call {@link HttpClientTransport.stop}, then {@link HttpClientTransport.start},
 * to open each subscription again.
 */
export class HttpClientTransport implements Transport {
  readonly name = 'http';

  readonly #baseUrl:      URL;
  readonly #fetch:        typeof fetch;
  readonly #logger:       Logger;
  readonly #backoff:      (attempt: number) => number;
  readonly #clockSkewSec: number;
  readonly #sseOptions:   SseParseOptions;
  readonly #resolveSenderPkFn?: (
    did: string,
    opts?: { genesisDocument?: object },
  ) => CompressedSecp256k1PublicKey | undefined;

  readonly #actors: Map<string, ActorEntry>   = new Map();
  readonly #peers:  Map<string, Uint8Array>   = new Map();

  #started = false;
  #broadcastAbort?: AbortController;

  /**
   * @throws {HttpTransportError} `INVALID_BASE_URL` if `baseUrl` is not an absolute http
   *   or https URL, or if it holds a username or a password. `INSECURE_BASE_URL` if
   *   `baseUrl` uses plain http, the host is not a loopback host, and
   *   `allowInsecureHttp` is not `true`. `NO_FETCH_IMPL` if no fetch implementation is
   *   available.
   */
  constructor(config: HttpClientTransportConfig) {
    this.#baseUrl      = parseBaseUrl(config.baseUrl, config.allowInsecureHttp === true);
    this.#logger       = config.logger ?? CONSOLE_LOGGER;
    this.#backoff      = config.reconnectBackoff ?? defaultReconnectBackoff;
    this.#clockSkewSec = config.clockSkewSec ?? DEFAULT_CLOCK_SKEW_SEC;
    this.#sseOptions   = { maxEventBytes: config.maxSseEventBytes };
    this.#resolveSenderPkFn = config.resolveSenderPk;

    const fetchImpl = config.fetchImpl ?? globalThis.fetch;
    if(typeof fetchImpl !== 'function') {
      throw new HttpTransportError(
        'No fetch implementation available. Pass config.fetchImpl explicitly.',
        'NO_FETCH_IMPL',
      );
    }
    // Call fetch with no `this` value. A browser fetch refuses the transport as `this`.
    this.#fetch = (input, init) => fetchImpl(input, init);
  }

  start(): void {
    if(this.#started) return;
    this.#started = true;

    this.#broadcastAbort = new AbortController();
    this.#runBroadcastLoop(this.#broadcastAbort.signal).catch((err: unknown) => {
      this.#logUnexpected('Broadcast loop ended after an unexpected error:', err);
    });

    for(const [did, entry] of this.#actors) {
      this.#openInbox(did, entry);
    }
  }

  /**
   * Tear down all SSE subscriptions and stop reconnect loops. Not part of the
   * {@link Transport} interface, but needed in tests and whenever a client
   * wants to cleanly disconnect without unregistering every actor.
   *
   * Idempotent. Actors remain registered (re-call {@link start} to resume). Each
   * actor keeps the id of its last inbox event, so the next inbox request resumes
   * after that event.
   */
  stop(): void {
    this.#broadcastAbort?.abort();
    this.#broadcastAbort = undefined;
    for(const entry of this.#actors.values()) {
      entry.inboxAbort?.abort();
      entry.inboxAbort = undefined;
    }
    this.#started = false;
  }

  registerActor(did: string, keys: SchnorrKeyPair): void {
    const existing = this.#actors.get(did);
    if(existing?.inboxAbort) existing.inboxAbort.abort();

    const entry: ActorEntry = { keys, handlers: new Map() };
    this.#actors.set(did, entry);
    if(this.#started) this.#openInbox(did, entry);
  }

  unregisterActor(did: string): void {
    const entry = this.#actors.get(did);
    if(!entry) return;
    entry.inboxAbort?.abort();
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
        `Invalid communication public key for peer ${did}: expected a 33-byte compressed secp256k1 key.`,
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
        `Cannot register handler: actor ${actorDid} not registered. Call registerActor() first.`,
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
    const actor = this.#actors.get(sender);
    if(!actor) {
      throw new HttpTransportError(
        `Unknown sender: ${sender}. Call registerActor() before sending messages.`,
        'UNKNOWN_SENDER',
        { did: sender },
      );
    }

    const envelope = signEnvelope(
      message,
      { did: sender, keys: actor.keys },
      { to: recipient },
    );

    // The client does not follow a redirect. A 3xx answer, or an opaque redirect answer
    // (status 0) in a browser, is not ok, so the check below throws. In a browser, a
    // cross-origin redirect that fails the CORS check makes fetch reject. The rejection
    // goes to the caller.
    const url = this.#route(HTTP_ROUTE.MESSAGES);
    const res = await this.#fetch(url, {
      method   : 'POST',
      headers  : { 'content-type': 'application/json' },
      body     : JSON.stringify(envelope),
      redirect : 'manual',
    });

    if(!res.ok) {
      const body = await readErrorBody(res);
      throw new HttpTransportError(
        `sendMessage failed: HTTP ${res.status}`,
        'SEND_MESSAGE_HTTP',
        { status: res.status, body, messageType: message.type },
      );
    }
  }

  publishRepeating(
    message:   BaseMessage,
    sender:    string,
    intervalMs: number,
    recipient?: string,
  ): () => void {
    let stopped = false;
    const attempt = (): void => {
      if(stopped) return;
      this.sendMessage(message, sender, recipient).catch((err: unknown) => {
        this.#logSafe('debug', 'publishRepeating send failed:', err);
      });
    };
    attempt();
    const timer = setInterval(attempt, intervalMs);
    return (): void => {
      if(stopped) return;
      stopped = true;
      clearInterval(timer);
    };
  }

  #route(template: string): URL {
    // Strip the leading slash so `new URL(rel, base)` is resolved against the
    // base's pathname instead of replacing it.
    return new URL(template.replace(/^\//, ''), this.#baseUrl);
  }

  #openInbox(did: string, entry: ActorEntry): void {
    const abort = new AbortController();
    entry.inboxAbort = abort;
    this.#runInboxLoop(did, entry, abort.signal).catch((err: unknown) => {
      this.#logUnexpected(`Inbox loop for ${did} ended after an unexpected error:`, err);
    });
  }

  /**
   * Keep the broadcast subscription open. The loop waits the backoff delay after each
   * attempt: a failed answer, a stream end, an event above the size limit, or a fetch
   * or read error. The loop sends no `Last-Event-ID`: the server sends its current
   * advert at each subscribe, and an advert repeats by design.
   *
   * A throw of `reconnectBackoff` ends the loop: the returned promise rejects.
   */
  async #runBroadcastLoop(signal: AbortSignal): Promise<void> {
    const url = this.#route(HTTP_ROUTE.ADVERTS);
    let attempt = 0;
    while(!signal.aborted) {
      const progress: AttemptProgress = { received: false, tooLarge: false };
      try {
        const res = await this.#fetch(url, {
          method   : 'GET',
          headers  : { accept: 'text/event-stream' },
          redirect : 'manual',
          signal,
        });
        if(!res.ok || !res.body) {
          this.#logSafe('warn', `Broadcast subscribe failed: HTTP ${res.status}`);
          discardBody(res);
        } else {
          for await (const ev of parseSseStream(observeBytes(res.body, progress), this.#sseOptions)) {
            if(signal.aborted) return;
            if(ev.event !== SSE_EVENT.ADVERT) continue;
            try {
              this.#dispatchBroadcast(ev.data);
            } catch(err) {
              this.#logUnexpected('Broadcast event dropped after an unexpected error:', err);
            }
          }
        }
      } catch(err) {
        if(signal.aborted) return;
        if(isEventTooLarge(err)) {
          progress.tooLarge = true;
          this.#logSafe('warn', `Broadcast event dropped: it exceeds the limit of ${err.data?.maxEventBytes} bytes. The client connects again.`);
        } else {
          this.#logSafe('debug', 'Broadcast loop error:', err);
        }
      }
      if(signal.aborted) return;
      if(progress.received && !progress.tooLarge) attempt = 0;
      // A throw of the backoff function ends the loop. The caller writes the error line.
      const delayMs = this.#backoff(attempt++);
      try {
        await sleep(delayMs, signal);
      } catch {
        return; // sleep was aborted
      }
    }
  }

  /**
   * Keep the inbox subscription of one actor open. The loop waits the backoff delay
   * after each attempt, as {@link #runBroadcastLoop} does. Each request sends the id of
   * the last inbox event in `Last-Event-ID`, if the actor has one. An event above the
   * size limit changes this id only if the parser gives the id of that event (see
   * `maxSseEventBytes`).
   *
   * A throw of `reconnectBackoff` ends the loop: the returned promise rejects.
   */
  async #runInboxLoop(did: string, entry: ActorEntry, signal: AbortSignal): Promise<void> {
    const url = this.#route(HTTP_ROUTE.ACTOR_INBOX.replace('{did}', encodeURIComponent(did)));
    let attempt = 0;
    while(!signal.aborted) {
      const progress: AttemptProgress = { received: false, tooLarge: false };
      try {
        const headers: Record<string, string> = {
          accept        : 'text/event-stream',
          authorization : buildRequestAuth(did, entry.keys, url.pathname),
        };
        if(entry.lastEventId !== undefined) headers['last-event-id'] = entry.lastEventId;
        const res = await this.#fetch(url, {
          method   : 'GET',
          headers,
          redirect : 'manual',
          signal,
        });
        if(!res.ok || !res.body) {
          this.#logSafe('warn', `Inbox subscribe failed for ${did}: HTTP ${res.status}`);
          discardBody(res);
        } else {
          for await (const ev of parseSseStream(observeBytes(res.body, progress), this.#sseOptions)) {
            if(signal.aborted) return;
            // Record the id before the name filter and before the checks. An event that
            // fails a check fails again on a replay, so the client does not ask for it.
            if(ev.id !== undefined) recordLastEventId(entry, ev.id);
            if(ev.event !== SSE_EVENT.MESSAGE) continue;
            try {
              await this.#dispatchInbox(ev.data, did, entry);
            } catch(err) {
              this.#logUnexpected(`Inbox event for ${did} dropped after an unexpected error:`, err);
            }
          }
        }
      } catch(err) {
        if(signal.aborted) return;
        if(isEventTooLarge(err)) {
          progress.tooLarge = true;
          // Apply the id of the refused event with the inbox resume rules. If the id
          // replaces the resume id, the next request resumes after the refused event.
          // If not, the server sends the refused event again at each reconnect.
          const eventId = err.data?.eventId;
          const before  = entry.lastEventId;
          if(typeof eventId === 'string') recordLastEventId(entry, eventId);
          const skips = entry.lastEventId !== before && entry.lastEventId === eventId;
          const next  = skips ? 'The client skips the event and connects again.' : 'The client connects again.';
          this.#logSafe('warn', `Inbox event for ${did} dropped: it exceeds the limit of ${err.data?.maxEventBytes} bytes. ${next}`);
        } else {
          this.#logSafe('debug', `Inbox loop error for ${did}:`, err);
        }
      }
      if(signal.aborted) return;
      if(progress.received && !progress.tooLarge) attempt = 0;
      // A throw of the backoff function ends the loop. The caller writes the error line.
      const delayMs = this.#backoff(attempt++);
      try {
        await sleep(delayMs, signal);
      } catch {
        return;
      }
    }
  }

  #dispatchBroadcast(dataJson: string): void {
    const envelope = parseEnvelope(dataJson, this.#logger);
    if(!envelope) return;

    const senderPk = this.#resolveSenderPk(envelope.from);
    if(!senderPk) {
      this.#logger.debug(`Broadcast from unresolvable DID: ${envelope.from}`);
      return;
    }
    // A broadcast names no recipient: `expectedTo: undefined` refuses an envelope with a
    // `to`. Else a recipient can relay an envelope from its inbox as an advert of the sender.
    try {
      verifyEnvelope(envelope, senderPk, {
        clockSkewSec : this.#clockSkewSec,
        expectedTo   : undefined,
      });
    } catch(err) {
      this.#logger.debug('Broadcast envelope verification failed:', err);
      return;
    }

    let revived: Record<string, unknown>;
    try {
      revived = reviveFromWire(envelope.message) as Record<string, unknown>;
    } catch(err) {
      this.#logger.debug('Broadcast message revive failed:', err);
      return;
    }
    const flat = flattenMessage(revived);

    // Bind the inner message to the authenticated envelope. The envelope signature
    // authenticates envelope.from; the advert inside it names the service DID the
    // participant will join and the key it will encrypt to. Unbound, any sender the
    // server relays for can advertise a cohort in a reputable service's name, and a
    // participant whose join filter trusts that DID encrypts its updates to the sender.
    if(flat.from !== envelope.from) {
      this.#logger.debug(`Broadcast inner sender ${describeSender(flat.from)} does not match envelope sender ${envelope.from}`);
      return;
    }

    // The key a sender advertises to the cohort must be the key it authenticated with,
    // the same cross-check the server applies to a bootstrap opt-in (ADR 066).
    const communicationPk = flat.communicationPk;
    if(communicationPk !== undefined
      && (!(communicationPk instanceof Uint8Array) || !equalBytes(communicationPk, senderPk.compressed))) {
      this.#logger.debug(`Broadcast from ${envelope.from} advertises a key it did not authenticate with`);
      return;
    }

    const messageType = typeof flat.type === 'string' ? flat.type : undefined;
    if(!messageType) return;

    // Fire and forget. A handler that throws or rejects gets a warn line, and the
    // handlers of the other actors still run.
    for(const actor of this.#actors.values()) {
      const handler = actor.handlers.get(messageType);
      if(!handler) continue;
      try {
        void Promise.resolve(handler(flat)).catch((err: unknown) => {
          this.#logHandlerFailure('Broadcast', messageType, envelope.from, err);
        });
      } catch(err) {
        this.#logHandlerFailure('Broadcast', messageType, envelope.from, err);
      }
    }
  }

  async #dispatchInbox(dataJson: string, actorDid: string, entry: ActorEntry): Promise<void> {
    const envelope = parseEnvelope(dataJson, this.#logger);
    if(!envelope) return;

    const senderPk = this.#resolveSenderPk(envelope.from);
    if(!senderPk) {
      this.#logger.debug(`Inbox message from unresolvable DID: ${envelope.from}`);
      return;
    }
    try {
      verifyEnvelope(envelope, senderPk, {
        clockSkewSec : this.#clockSkewSec,
        expectedTo   : actorDid,
      });
    } catch(err) {
      this.#logger.debug(`Inbox envelope verification failed for ${actorDid}:`, err);
      return;
    }

    let revived: Record<string, unknown>;
    try {
      revived = reviveFromWire(envelope.message) as Record<string, unknown>;
    } catch(err) {
      this.#logger.debug(`Inbox message revive failed for ${actorDid}:`, err);
      return;
    }
    const flat = flattenMessage(revived);

    // Bind the inner message to the authenticated envelope: the participant state machine
    // acts on the inner `from` (it holds every service-originated message to the cohort's
    // service DID), so a sender authenticated as itself must not be able to speak as the
    // service by relabelling the message it carries.
    if(flat.from !== envelope.from) {
      this.#logger.debug(`Inbox inner sender ${describeSender(flat.from)} does not match envelope sender ${envelope.from}`);
      return;
    }

    const messageType = typeof flat.type === 'string' ? flat.type : undefined;
    if(!messageType) return;

    const handler = entry.handlers.get(messageType);
    if(!handler) return;
    try {
      await handler(flat);
    } catch(err) {
      this.#logHandlerFailure('Inbox', messageType, envelope.from, err);
    }
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
    try {
      return this.#resolveSenderPkFn?.(did, opts);
    } catch(err) {
      this.#logger.debug(`Sender key resolution failed for ${did}:`, err);
      return undefined;
    }
  }

  /** Write a warn line for a handler that throws or rejects. A logger throw does not leave this method. */
  #logHandlerFailure(stream: 'Broadcast' | 'Inbox', messageType: string, sender: string, err: unknown): void {
    try {
      this.#logger.warn(`${stream} handler for ${messageType} from ${sender} failed:`, err);
    } catch { /* the logger failed */ }
  }

  /** Write an error line for an unexpected throw. A logger throw does not leave this method. */
  #logUnexpected(message: string, err: unknown): void {
    try { this.#logger.error(message, err); } catch { /* the logger failed */ }
  }

  /** Write a debug or warn line. A logger throw does not leave this method. */
  #logSafe(level: 'debug' | 'warn', message: string, ...args: unknown[]): void {
    try { this.#logger[level](message, ...args); } catch { /* the logger failed */ }
  }
}

/**
 * Parse and check the base URL of the service. Returns a copy whose path ends with a slash.
 *
 * The check order is:
 * 1. The parse. A value that is not a string or a URL, or that does not parse as an
 *    absolute URL, gives `INVALID_BASE_URL`.
 * 2. The protocol. A protocol other than `https:` or `http:` gives `INVALID_BASE_URL`.
 * 3. The credentials. A URL with a username or a password gives `INVALID_BASE_URL`.
 *    Fetch refuses a request URL with credentials, and its error text shows the URL.
 * 4. The host. Plain http with a host that is not a loopback host gives
 *    `INSECURE_BASE_URL`, unless `allowInsecureHttp` is `true`.
 *
 * The error data never holds the full URL.
 */
function parseBaseUrl(value: unknown, allowInsecureHttp: boolean): URL {
  const base = toUrl(value);
  if(!base) throw new HttpTransportError(INVALID_BASE_URL_MESSAGE, 'INVALID_BASE_URL');
  if(base.protocol !== 'https:' && base.protocol !== 'http:') {
    throw new HttpTransportError(INVALID_BASE_URL_MESSAGE, 'INVALID_BASE_URL', { protocol: base.protocol });
  }
  if(base.username !== '' || base.password !== '') {
    throw new HttpTransportError(BASE_URL_CREDENTIALS_MESSAGE, 'INVALID_BASE_URL');
  }
  if(base.protocol === 'http:' && !allowInsecureHttp && !isLoopbackHost(base.hostname)) {
    throw new HttpTransportError(INSECURE_BASE_URL_MESSAGE, 'INSECURE_BASE_URL', { hostname: base.hostname });
  }
  if(!base.pathname.endsWith('/')) base.pathname += '/';
  return base;
}

/** Parse a string or copy a URL. Returns `undefined` for any other value or for a parse failure. */
function toUrl(value: unknown): URL | undefined {
  try {
    if(typeof value === 'string') return new URL(value);
    if(value instanceof URL) return new URL(value.href);
  } catch { /* not an absolute URL */ }
  return undefined;
}

/**
 * Return `true` if `hostname` (the `hostname` of a parsed URL) is a loopback host:
 * - An IPv4 address in 127.0.0.0/8. The URL parser serializes each IPv4 form, so
 *   `127.1` and `0x7f000001` give `127.0.0.1`.
 * - The IPv6 address `::1` only. The URL parser serializes it as `[::1]`. An
 *   IPv4-mapped address (for example `[::ffff:127.0.0.1]`) is not a loopback host.
 * - A localhost name: `localhost` or a name that ends with `.localhost`. Each name can
 *   have a trailing dot. The URL parser makes names lowercase.
 *
 * A localhost name is a trust assumption: the host must resolve it to a loopback address.
 * W3C Secure Contexts 3.1 applies the same name rule only if the resolver follows
 * "let localhost be localhost".
 */
function isLoopbackHost(hostname: string): boolean {
  if(IPV4_LOOPBACK_HOST.test(hostname)) return true;
  if(hostname === '[::1]') return true;
  const name = hostname.endsWith('.') ? hostname.slice(0, -1) : hostname;
  return name === 'localhost' || name.endsWith('.localhost');
}

/**
 * Apply the `id` field of an inbox event to `entry.lastEventId`:
 * - An empty id clears the value (the HTML SSE rule). The next request then sends no
 *   `Last-Event-ID`.
 * - An id of 1 to 256 visible ASCII characters (0x21 to 0x7E) replaces the value.
 * - The client ignores any other id and keeps the value. Fetch refuses some header
 *   values (for example a character above U+00FF), and a server can refuse a long
 *   header. A stored id of this kind makes each reconnect fail.
 */
function recordLastEventId(entry: ActorEntry, id: string): void {
  if(id === '') entry.lastEventId = undefined;
  else if(LAST_EVENT_ID_PATTERN.test(id)) entry.lastEventId = id;
}

/**
 * Pass `body` through and set `progress.received` at the first chunk with one or more
 * bytes. A heartbeat comment counts: it shows that the connection works.
 */
function observeBytes(body: ReadableStream<Uint8Array>, progress: AttemptProgress): ReadableStream<Uint8Array> {
  return body.pipeThrough(new TransformStream<Uint8Array, Uint8Array>({
    transform(chunk, controller) {
      if(chunk.byteLength > 0) progress.received = true;
      controller.enqueue(chunk);
    },
  }));
}

/** Return `true` if `err` is the `SSE_EVENT_TOO_LARGE` error of the SSE parser. */
function isEventTooLarge(err: unknown): err is HttpTransportError {
  return err instanceof HttpTransportError && err.type === 'SSE_EVENT_TOO_LARGE';
}

/** Cancel the unread body of an answer to free the connection. The function ignores errors. */
function discardBody(res: Response): void {
  try {
    res.body?.cancel().catch(() => { /* ignored */ });
  } catch { /* ignored */ }
}

function sleep(ms: number, signal: AbortSignal): Promise<void> {
  if(ms <= 0) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const onAbort = (): void => {
      clearTimeout(timer);
      reject(new HttpTransportError('aborted', 'SLEEP_ABORTED'));
    };
    const timer = setTimeout(() => {
      signal.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    if(signal.aborted) onAbort();
    else signal.addEventListener('abort', onAbort, { once: true });
  });
}

/**
 * Read the start of the body of a failed answer. Returns at most
 * {@link ERROR_BODY_MAX_CHARS} characters, or `''` if the read fails.
 *
 * The function reads at most {@link ERROR_BODY_MAX_BYTES} bytes, then cancels the body.
 * Thus a body that never ends does not fill the memory.
 */
async function readErrorBody(res: Response): Promise<string> {
  let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
  try {
    if(!res.body) return '';
    reader = res.body.getReader();
    const decoder = new TextDecoder();
    let text = '';
    let bytes = 0;
    while(bytes < ERROR_BODY_MAX_BYTES) {
      const { value, done } = await reader.read();
      if(done) {
        text += decoder.decode();
        break;
      }
      const chunk = value.subarray(0, ERROR_BODY_MAX_BYTES - bytes);
      bytes += chunk.byteLength;
      text += decoder.decode(chunk, { stream: true });
    }
    return text.slice(0, ERROR_BODY_MAX_CHARS);
  } catch {
    return '';
  } finally {
    reader?.cancel().catch(() => { /* ignored */ });
  }
}

/**
 * Parse the data of an SSE event as an envelope. Returns `undefined` with a debug line if
 * the data is not JSON or does not have the outer shape of an envelope.
 */
function parseEnvelope(dataJson: string, logger: Logger): SignedEnvelope | undefined {
  let value: unknown;
  try {
    value = JSON.parse(dataJson);
  } catch(err) {
    logger.debug('SSE event: failed to parse envelope JSON:', err);
    return undefined;
  }
  if(!isEnvelopeShape(value)) {
    logger.debug('SSE event: malformed envelope');
    return undefined;
  }
  return value;
}

/**
 * Give a log text for the inner `from` of a message. A value that is not a string gives
 * its type, because `String(value)` can throw for an object from the wire.
 */
function describeSender(value: unknown): string {
  return typeof value === 'string' ? value : typeof value;
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

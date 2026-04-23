import type { SchnorrKeyPair } from '@did-btcr2/keypair';
import { CompressedSecp256k1PublicKey } from '@did-btcr2/keypair';

import { Identifier } from '../../../identifier.js';
import type { Logger } from '../../logger.js';
import { CONSOLE_LOGGER } from '../../logger.js';
import type { BaseMessage } from '../../messages/base.js';
import type { MessageHandler, Transport } from '../transport.js';
import { reviveFromWire, signEnvelope, verifyEnvelope } from './envelope.js';
import { HttpTransportError } from './errors.js';
import {
  DEFAULT_CLOCK_SKEW_SEC,
  HTTP_ROUTE,
  SSE_EVENT,
  type SignedEnvelope,
} from './protocol.js';
import { buildRequestAuth } from './request-auth.js';
import { parseSseStream } from './sse-stream.js';

export interface HttpClientTransportConfig {
  /** Base URL of the aggregation service (e.g. `https://aggregator.example.com/`). */
  baseUrl: string | URL;
  /** Custom `fetch` implementation (tests, Workers, React Native). Defaults to `globalThis.fetch`. */
  fetchImpl?: typeof fetch;
  /** Diagnostic logger. Defaults to {@link CONSOLE_LOGGER}. */
  logger?: Logger;
  /** Reconnect backoff (ms) given attempt count (0-based). */
  reconnectBackoff?: (attempt: number) => number;
  /** Envelope / request-auth clock-skew tolerance in seconds. */
  clockSkewSec?: number;
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
}

/**
 * HTTP transport client. Implements the transport-agnostic {@link Transport}
 * interface; the wire is fetch-based SSE for incoming events and fetch-based
 * POST for outgoing messages. All runtime I/O goes through `fetchImpl` so
 * tests can substitute a mock without touching the network.
 */
export class HttpClientTransport implements Transport {
  readonly name = 'http';

  readonly #baseUrl:      URL;
  readonly #fetch:        typeof fetch;
  readonly #logger:       Logger;
  readonly #backoff:      (attempt: number) => number;
  readonly #clockSkewSec: number;

  readonly #actors: Map<string, ActorEntry>   = new Map();
  readonly #peers:  Map<string, Uint8Array>   = new Map();

  #started = false;
  #broadcastAbort?: AbortController;

  constructor(config: HttpClientTransportConfig) {
    const base = typeof config.baseUrl === 'string' ? new URL(config.baseUrl) : new URL(config.baseUrl.href);
    if(!base.pathname.endsWith('/')) base.pathname += '/';
    this.#baseUrl      = base;
    this.#logger       = config.logger ?? CONSOLE_LOGGER;
    this.#backoff      = config.reconnectBackoff ?? defaultReconnectBackoff;
    this.#clockSkewSec = config.clockSkewSec ?? DEFAULT_CLOCK_SKEW_SEC;

    const fetchImpl = config.fetchImpl ?? globalThis.fetch;
    if(typeof fetchImpl !== 'function') {
      throw new HttpTransportError(
        'No fetch implementation available. Pass config.fetchImpl explicitly.',
        'NO_FETCH_IMPL',
      );
    }
    this.#fetch = fetchImpl;
  }

  start(): void {
    if(this.#started) return;
    this.#started = true;

    this.#broadcastAbort = new AbortController();
    this.#runBroadcastLoop(this.#broadcastAbort.signal);

    for(const [did, entry] of this.#actors) {
      this.#openInbox(did, entry);
    }
  }

  /**
   * Tear down all SSE subscriptions and stop reconnect loops. Not part of the
   * {@link Transport} interface, but needed in tests and whenever a client
   * wants to cleanly disconnect without unregistering every actor.
   *
   * Idempotent. Actors remain registered (re-call {@link start} to resume).
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

    const url = this.#route(HTTP_ROUTE.MESSAGES);
    const res = await this.#fetch(url, {
      method  : 'POST',
      headers : { 'content-type': 'application/json' },
      body    : JSON.stringify(envelope),
    });

    if(!res.ok) {
      const body = await safeText(res);
      throw new HttpTransportError(
        `sendMessage failed: HTTP ${res.status}`,
        'SEND_MESSAGE_HTTP',
        { status: res.status, body: body.slice(0, 256), messageType: message.type },
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
      this.sendMessage(message, sender, recipient).catch((err) => {
        this.#logger.debug('publishRepeating send failed:', err);
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
    this.#runInboxLoop(did, entry, abort.signal);
  }

  async #runBroadcastLoop(signal: AbortSignal): Promise<void> {
    const url = this.#route(HTTP_ROUTE.ADVERTS);
    let attempt = 0;
    while(!signal.aborted) {
      try {
        const res = await this.#fetch(url, {
          method  : 'GET',
          headers : { accept: 'text/event-stream' },
          signal,
        });
        if(!res.ok || !res.body) {
          this.#logger.warn(`Broadcast subscribe failed: HTTP ${res.status}`);
          await sleep(this.#backoff(attempt++), signal);
          continue;
        }
        attempt = 0;
        for await (const ev of parseSseStream(res.body)) {
          if(signal.aborted) return;
          if(ev.event !== SSE_EVENT.ADVERT) continue;
          this.#dispatchBroadcast(ev.data);
        }
      } catch(err) {
        if(signal.aborted) return;
        this.#logger.debug('Broadcast loop error:', err);
        try {
          await sleep(this.#backoff(attempt++), signal);
        } catch {
          return; // sleep was aborted
        }
      }
    }
  }

  async #runInboxLoop(did: string, entry: ActorEntry, signal: AbortSignal): Promise<void> {
    const url = this.#route(HTTP_ROUTE.ACTOR_INBOX.replace('{did}', encodeURIComponent(did)));
    let attempt = 0;
    while(!signal.aborted) {
      try {
        const auth = buildRequestAuth(did, entry.keys, url.pathname);
        const res = await this.#fetch(url, {
          method  : 'GET',
          headers : { accept: 'text/event-stream', authorization: auth },
          signal,
        });
        if(!res.ok || !res.body) {
          this.#logger.warn(`Inbox subscribe failed for ${did}: HTTP ${res.status}`);
          await sleep(this.#backoff(attempt++), signal);
          continue;
        }
        attempt = 0;
        for await (const ev of parseSseStream(res.body)) {
          if(signal.aborted) return;
          if(ev.event !== SSE_EVENT.MESSAGE) continue;
          await this.#dispatchInbox(ev.data, did, entry);
        }
      } catch(err) {
        if(signal.aborted) return;
        this.#logger.debug(`Inbox loop error for ${did}:`, err);
        try {
          await sleep(this.#backoff(attempt++), signal);
        } catch {
          return;
        }
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
    try {
      verifyEnvelope(envelope, senderPk, { clockSkewSec: this.#clockSkewSec });
    } catch(err) {
      this.#logger.debug('Broadcast envelope verification failed:', err);
      return;
    }

    const revived = reviveFromWire(envelope.message) as Record<string, unknown>;
    const flat = flattenMessage(revived);
    const messageType = typeof flat.type === 'string' ? flat.type : undefined;
    if(!messageType) return;

    for(const actor of this.#actors.values()) {
      const handler = actor.handlers.get(messageType);
      if(handler) void Promise.resolve(handler(flat));
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

    const revived = reviveFromWire(envelope.message) as Record<string, unknown>;
    const flat = flattenMessage(revived);
    const messageType = typeof flat.type === 'string' ? flat.type : undefined;
    if(!messageType) return;

    const handler = entry.handlers.get(messageType);
    if(handler) await handler(flat);
  }

  #resolveSenderPk(did: string): CompressedSecp256k1PublicKey | undefined {
    const peerBytes = this.#peers.get(did);
    if(peerBytes) {
      try { return new CompressedSecp256k1PublicKey(peerBytes); }
      catch { /* fall through to DID decode */ }
    }
    try {
      const components = Identifier.decode(did);
      if(components.idType === 'KEY') {
        return new CompressedSecp256k1PublicKey(components.genesisBytes);
      }
    } catch {
      // Not a decodable did:btcr2 KEY identifier.
    }
    return undefined;
  }
}

function sleep(ms: number, signal: AbortSignal): Promise<void> {
  if(ms <= 0) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const onAbort = (): void => {
      clearTimeout(timer);
      reject(new Error('aborted'));
    };
    const timer = setTimeout(() => {
      signal.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    if(signal.aborted) onAbort();
    else signal.addEventListener('abort', onAbort, { once: true });
  });
}

async function safeText(res: Response): Promise<string> {
  try { return await res.text(); }
  catch { return ''; }
}

function parseEnvelope(dataJson: string, logger: Logger): SignedEnvelope | undefined {
  try { return JSON.parse(dataJson) as SignedEnvelope; }
  catch(err) {
    logger.debug('SSE event: failed to parse envelope JSON:', err);
    return undefined;
  }
}

function flattenMessage(msg: Record<string, unknown>): Record<string, unknown> {
  if(msg.body && typeof msg.body === 'object') {
    return { ...msg, ...(msg.body as Record<string, unknown>) };
  }
  return msg;
}

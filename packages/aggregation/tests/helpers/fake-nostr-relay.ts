/**
 * In-process fake Nostr relay for transport tests.
 *
 * Installed via nostr-tools' `useWebSocketImplementation`, so a NostrTransport's
 * SimplePool "connects" to an in-memory relay keyed by URL instead of the
 * network. Transports pointing at the same URL share one relay, which stores
 * published events, answers REQ with matching history + EOSE, and fans new
 * events out to every matching subscription - the narrow harness needed to
 * drive the real NostrTransport event handlers without a network.
 */
import type { Event, Filter } from 'nostr-tools';
import { matchFilters } from 'nostr-tools';
import { useWebSocketImplementation } from 'nostr-tools/pool';

type Frame = unknown[];

class FakeNostrRelay {
  static #registry = new Map<string, FakeNostrRelay>();
  static #nextSocketId = 0;

  static forUrl(url: string): FakeNostrRelay {
    const key = FakeNostrRelay.#normalize(url);
    let relay = this.#registry.get(key);
    if(!relay) {
      relay = new FakeNostrRelay();
      this.#registry.set(key, relay);
    }
    return relay;
  }

  static reset(): void {
    this.#registry.clear();
    this.#nextSocketId = 0;
  }

  static nextSocketId(): number {
    return ++this.#nextSocketId;
  }

  /** Mirror nostr-tools' normalizeURL closely enough to key the registry. */
  static #normalize(url: string): string {
    const parsed = new URL(url.indexOf('://') === -1 ? `wss://${url}` : url);
    parsed.pathname = parsed.pathname.replace(/\/+$/, '');
    return parsed.toString();
  }

  #sockets = new Set<FakeRelaySocket>();
  // Keyed by `${socket.id}:${subId}`: nostr-tools numbers subscription ids
  // per pool, so two transports on one relay reuse the same ids.
  #subs    = new Map<string, { socket: FakeRelaySocket; id: string; filters: Filter[] }>();
  #stored  : Event[] = [];

  get subscriptionCount(): number { return this.#subs.size; }
  get storedEvents(): readonly Event[] { return this.#stored; }

  connect(socket: FakeRelaySocket): void { this.#sockets.add(socket); }

  disconnect(socket: FakeRelaySocket): void {
    this.#sockets.delete(socket);
    for(const [key, sub] of this.#subs) {
      if(sub.socket === socket) this.#subs.delete(key);
    }
  }

  static subKey(socket: FakeRelaySocket, id: string): string {
    return `${socket.id}:${id}`;
  }

  /** Handle one client frame (REQ / EVENT / CLOSE) from a connected socket. */
  handle(socket: FakeRelaySocket, raw: string): void {
    const msg = JSON.parse(raw) as unknown[];
    switch(msg[0]) {
      case 'REQ': {
        const [, id, ...filters] = msg as [unknown, string, ...Filter[]];
        this.#subs.set(FakeNostrRelay.subKey(socket, id), { socket, id, filters });
        for(const event of this.#stored) {
          if(matchFilters(filters, event)) socket.deliver(['EVENT', id, event]);
        }
        socket.deliver(['EOSE', id]);
        break;
      }
      case 'EVENT': {
        const event = msg[1] as Event;
        this.#stored.push(event);
        socket.deliver(['OK', event.id, true, '']);
        this.#fanout(event);
        break;
      }
      case 'CLOSE': {
        this.#subs.delete(FakeNostrRelay.subKey(socket, msg[1] as string));
        break;
      }
    }
  }

  /** Inject an event as if a third-party client published it (test entry point). */
  inject(event: Event): void {
    this.#stored.push(event);
    this.#fanout(event);
  }

  #fanout(event: Event): void {
    for(const sub of this.#subs.values()) {
      if(matchFilters(sub.filters, event)) sub.socket.deliver(['EVENT', sub.id, event]);
    }
  }
}

/** WebSocket stand-in wired to a shared {@link FakeNostrRelay}. */
export class FakeRelaySocket {
  static readonly CONNECTING = 0;
  static readonly OPEN       = 1;
  static readonly CLOSING    = 2;
  static readonly CLOSED     = 3;

  readyState: number = FakeRelaySocket.CONNECTING;
  onopen   : (() => void) | null                       = null;
  onerror  : ((ev: unknown) => void) | null            = null;
  onclose  : ((ev: { message?: string }) => void) | null = null;
  onmessage: ((ev: { data: string }) => void) | null     = null;

  readonly id: number;
  readonly #relay: FakeNostrRelay;

  constructor(url: string | URL) {
    this.#relay = FakeNostrRelay.forUrl(String(url));
    this.id = FakeNostrRelay.nextSocketId();
    queueMicrotask(() => {
      if(this.readyState !== FakeRelaySocket.CONNECTING) return;
      this.readyState = FakeRelaySocket.OPEN;
      this.#relay.connect(this);
      this.onopen?.();
    });
  }

  send(data: string): void {
    if(this.readyState !== FakeRelaySocket.OPEN) return;
    this.#relay.handle(this, data);
  }

  close(): void {
    if(this.readyState !== FakeRelaySocket.OPEN) return;
    this.readyState = FakeRelaySocket.CLOSED;
    this.#relay.disconnect(this);
  }

  /** Deliver a relay frame to the nostr-tools client (async, like a real socket). */
  deliver(frame: Frame): void {
    queueMicrotask(() => {
      if(this.readyState === FakeRelaySocket.OPEN) this.onmessage?.({ data: JSON.stringify(frame) });
    });
  }
}

/** Test-facing handle to the shared in-memory relay behind a URL. */
export function fakeNostrRelay(url: string): FakeNostrRelay {
  return FakeNostrRelay.forUrl(url);
}

/** Point every subsequently created SimplePool at the in-memory relays. */
export function installFakeRelaySockets(): void {
  useWebSocketImplementation(FakeRelaySocket);
}

/** Restore the default (global WebSocket) implementation and drop all relay state. */
export function uninstallFakeRelaySockets(): void {
  useWebSocketImplementation(undefined);
  FakeNostrRelay.reset();
}

export interface BucketState {
  tokens: number;
  lastRefillMs: number;
}

/**
 * Pluggable storage backend for rate-limit state. The default
 * {@link InMemoryRateLimitStore} is a plain Map; swap in Redis-backed or
 * SQLite-backed implementations for multi-instance deployments.
 */
export interface RateLimitStore {
  get(key: string): BucketState | undefined;
  set(key: string, state: BucketState): void;
}

export class InMemoryRateLimitStore implements RateLimitStore {
  readonly #buckets = new Map<string, BucketState>();

  get(key: string): BucketState | undefined {
    return this.#buckets.get(key);
  }

  set(key: string, state: BucketState): void {
    this.#buckets.set(key, state);
  }
}

export interface RateLimiterConfig {
  /** Steady-state request rate per key (requests per second). Default 10. */
  rps?: number;
  /** Peak burst allowance (bucket capacity). Default 30. */
  burst?: number;
  /** Optional pluggable store. Defaults to an in-memory Map. */
  store?: RateLimitStore;
}

/**
 * Token-bucket rate limiter keyed by an opaque string (typically a verified
 * sender DID). Tokens refill linearly at `rps` up to `burst`. Each `consume`
 * call atomically debits one token or returns `false` to reject.
 *
 * The limiter is synchronous and deterministic given `nowMs` — tests can
 * drive it with a fixed clock to exercise exact boundaries.
 */
export class RateLimiter {
  readonly #rps: number;
  readonly #burst: number;
  readonly #store: RateLimitStore;

  constructor(config: RateLimiterConfig = {}) {
    this.#rps   = config.rps   ?? 10;
    this.#burst = config.burst ?? 30;
    this.#store = config.store ?? new InMemoryRateLimitStore();
  }

  /** Consume one token for `key`. Returns `true` if accepted, `false` if throttled. */
  consume(key: string, nowMs: number): boolean {
    const existing = this.#store.get(key);
    const state: BucketState = existing ?? { tokens: this.#burst, lastRefillMs: nowMs };

    if(existing) {
      const elapsedSec = Math.max(0, (nowMs - existing.lastRefillMs) / 1000);
      state.tokens       = Math.min(this.#burst, existing.tokens + elapsedSec * this.#rps);
      state.lastRefillMs = nowMs;
    }

    if(state.tokens < 1) {
      this.#store.set(key, state);
      return false;
    }
    state.tokens -= 1;
    this.#store.set(key, state);
    return true;
  }
}

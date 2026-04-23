export interface NonceCacheConfig {
  /** Max distinct entries to retain before FIFO eviction. Default 10,000. */
  maxEntries?: number;
}

/**
 * Bounded anti-replay cache for `(did, nonce)` pairs.
 *
 * Replay windowing is the caller's responsibility — this cache only detects
 * duplicates. Callers are expected to reject envelopes/headers whose timestamp
 * is outside the clock-skew window *before* consulting the cache, so entries
 * here are always within the protocol's acceptable window.
 *
 * Eviction is strict-FIFO (Map insertion order) once `maxEntries` is reached.
 */
export class NonceCache {
  readonly #maxEntries: number;
  readonly #entries = new Map<string, number>();

  constructor(config: NonceCacheConfig = {}) {
    this.#maxEntries = config.maxEntries ?? 10_000;
  }

  /**
   * Record a nonce. Returns `true` if it was novel (caller should accept the
   * request) or `false` if it was a replay (caller should reject).
   */
  store(did: string, nonce: string, timestampSec: number): boolean {
    const key = `${did}:${nonce}`;
    if(this.#entries.has(key)) return false;
    this.#entries.set(key, timestampSec);
    if(this.#entries.size > this.#maxEntries) {
      const oldest = this.#entries.keys().next();
      if(!oldest.done) this.#entries.delete(oldest.value);
    }
    return true;
  }

  /** Current cache size. Exposed for observability and tests. */
  size(): number {
    return this.#entries.size;
  }
}

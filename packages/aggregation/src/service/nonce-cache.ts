export interface NonceCacheConfig {
  /** Max distinct entries to retain across all DIDs. Default 10,000. */
  maxEntries?: number;
  /**
   * Max entries retained per DID. Bounds any single sender's footprint so a
   * flood from one (or a few) DIDs can never evict another DID's live entries
   * and reopen their replay window (audit L18). Default 512.
   */
  maxPerDid?: number;
  /**
   * Entries older than this many seconds are expired: the caller rejects
   * envelopes outside its clock-skew window before consulting the cache, so an
   * expired entry can never match a valid replay and is safe to drop. Expiry is
   * the primary eviction path. Default 300 seconds (well above the transport's
   * 60-second clock-skew tolerance).
   */
  windowSec?: number;
  /** Clock injection point for tests. Returns unix seconds. */
  nowSec?: () => number;
}

/**
 * Bounded anti-replay cache for `(did, nonce)` pairs.
 *
 * Replay windowing is the caller's responsibility - this cache only detects
 * duplicates. Callers are expected to reject envelopes/headers whose timestamp
 * is outside the clock-skew window *before* consulting the cache, so entries
 * here are always within the protocol's acceptable window.
 *
 * Eviction order (audit L18): expired entries first (they can no longer match a
 * legitimate replay), then the over-limit DID's own oldest entries once it
 * exceeds `maxPerDid`, and only then a global oldest-first backstop at
 * `maxEntries`. A global FIFO alone lets an attacker flush a victim's live
 * entries and replay inside the window; per-DID buckets plus expiry close that.
 */
export class NonceCache {
  readonly #maxEntries: number;
  readonly #maxPerDid: number;
  readonly #windowSec: number;
  readonly #nowSec: () => number;
  /** Per-DID insertion-ordered buckets: nonce -> timestampSec. */
  readonly #byDid = new Map<string, Map<string, number>>();
  #total = 0;

  constructor(config: NonceCacheConfig = {}) {
    this.#maxEntries = config.maxEntries ?? 10_000;
    this.#maxPerDid = config.maxPerDid ?? 512;
    this.#windowSec = config.windowSec ?? 300;
    this.#nowSec = config.nowSec ?? (() => Math.floor(Date.now() / 1000));
  }

  /**
   * Record a nonce. Returns `true` if it was novel (caller should accept the
   * request) or `false` if it was a replay (caller should reject).
   */
  store(did: string, nonce: string, timestampSec: number): boolean {
    let bucket = this.#byDid.get(did);
    if(bucket?.has(nonce)) return false;
    if(!bucket) {
      bucket = new Map();
      this.#byDid.set(did, bucket);
    }
    bucket.set(nonce, timestampSec);
    this.#total += 1;

    this.#evict(did, bucket);
    return true;
  }

  #evict(did: string, bucket: Map<string, number>): void {
    // 1. Expire stale entries whenever pressure demands it (or the DID's own
    // bucket is over its cap): they are outside the replay window and can never
    // match a legitimate retry.
    if(this.#total > this.#maxEntries || bucket.size > this.#maxPerDid) {
      this.#sweepExpired();
    }
    // 2. Per-DID cap: evict the offending DID's oldest entries only.
    while(bucket.size > this.#maxPerDid) {
      const oldest = bucket.keys().next();
      if(oldest.done) break;
      bucket.delete(oldest.value);
      this.#total -= 1;
    }
    // 3. Global backstop: evict oldest entries across all DIDs.
    if(this.#total > this.#maxEntries) {
      for(const [otherDid, other] of this.#byDid) {
        while(other.size > 0 && this.#total > this.#maxEntries) {
          const oldest = other.keys().next();
          if(oldest.done) break;
          other.delete(oldest.value);
          this.#total -= 1;
        }
        if(other.size === 0) this.#byDid.delete(otherDid);
        if(this.#total <= this.#maxEntries) break;
      }
    }
    if(bucket.size === 0) this.#byDid.delete(did);
  }

  #sweepExpired(): void {
    const cutoff = this.#nowSec() - this.#windowSec;
    for(const [did, bucket] of this.#byDid) {
      for(const [nonce, ts] of bucket) {
        if(ts < cutoff) {
          bucket.delete(nonce);
          this.#total -= 1;
        }
      }
      if(bucket.size === 0) this.#byDid.delete(did);
    }
  }

  /** Current cache size. Exposed for observability and tests. */
  size(): number {
    return this.#total;
  }
}

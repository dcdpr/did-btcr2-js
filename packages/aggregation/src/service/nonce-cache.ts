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
 * Capacity policy (audit L18/MS-10): when a DID's bucket reaches `maxPerDid`
 * or the cache reaches `maxEntries`, expired entries are reclaimed first (they
 * are outside the replay window and can never match a legitimate retry). If
 * capacity is still exhausted afterwards, the NEW admission is refused rather
 * than evicting a live in-window entry: evicting live entries (a global FIFO,
 * or draining whole buckets) reopens exactly the replay window this cache
 * exists to close, letting an attacker flush a victim's entries and replay
 * their requests inside the window. Failing closed means an over-capacity
 * cache rejects new requests - a liveness cost, never a replay-forgery risk.
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
   * Record a nonce. Returns `true` if it was novel and admitted (caller should
   * accept the request) or `false` if it was a replay - or if admitting it
   * would require evicting a live in-window entry, in which case the caller
   * must reject the request (fail-closed; audit MS-10).
   */
  store(did: string, nonce: string, timestampSec: number): boolean {
    let bucket = this.#byDid.get(did);
    if(bucket?.has(nonce)) return false;

    const bucketFull = bucket !== undefined && bucket.size >= this.#maxPerDid;
    if(bucketFull || this.#total >= this.#maxEntries) {
      // Reclaim expired entries first: they are outside the replay window and
      // can never match a legitimate retry.
      this.#sweepExpired();
      bucket = this.#byDid.get(did);
      // Still at capacity: reject the new admission instead of evicting a live
      // in-window entry (which would reopen the replay window).
      if(this.#total >= this.#maxEntries) return false;
      if(bucket !== undefined && bucket.size >= this.#maxPerDid) return false;
    }

    if(!bucket) {
      bucket = new Map();
      this.#byDid.set(did, bucket);
    }
    bucket.set(nonce, timestampSec);
    this.#total += 1;
    return true;
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

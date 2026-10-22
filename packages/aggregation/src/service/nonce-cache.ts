import { AggregationServiceError } from '../core/errors.js';

/** Default maximum count of entries. */
const DEFAULT_MAX_ENTRIES = 10_000;

export interface NonceCacheConfig {
  /** Maximum count of entries. Must be an integer >= 1. Default 10,000. */
  maxEntries?: number;
}

/**
 * Result of {@link NonceCache.store}. `'evicted'` means that the cache was full of
 * live entries and the store deleted the live entry that expires first.
 */
export type NonceStoreResult = 'stored' | 'evicted';

/**
 * Time-based anti-replay cache for `(did, nonce)` pairs.
 *
 * Each entry holds the unix second at which it expires. An entry is live while
 * its expiry is at or after the current second. Before the cache, the caller
 * refuses an envelope or an auth header whose timestamp is outside the clock-skew
 * window. The cache thus keeps each nonce for at least as long as a replay of it
 * can pass the skew check.
 *
 * The entries are in insertion order. The server passes a non-decreasing expiry,
 * so the head is the entry that expires first: the purge and the eviction both
 * take the head. If the clock steps back, the purge of some expired entries
 * comes later, and {@link NonceCache.has} treats an expired entry as absent.
 *
 * The capacity is admission control, not a replay guarantee. Under a flood of
 * fresh nonces the cache evicts its oldest live entry. The envelope of an evicted
 * entry can then be replayed until its timestamp leaves the skew window. This is
 * the accepted residual of the bound.
 */
export class NonceCache {
  readonly #maxEntries: number;
  readonly #entries = new Map<string, number>();

  constructor(config: NonceCacheConfig = {}) {
    const maxEntries = config.maxEntries ?? DEFAULT_MAX_ENTRIES;
    if(!Number.isInteger(maxEntries) || maxEntries < 1) {
      throw new AggregationServiceError(
        `NonceCache maxEntries must be an integer >= 1; got ${maxEntries}`,
        'INVALID_NONCE_CACHE_CAPACITY',
        { maxEntries },
      );
    }
    this.#maxEntries = maxEntries;
  }

  /** Return `true` if a live entry for `(did, nonce)` exists at `nowSec`. */
  has(did: string, nonce: string, nowSec: number): boolean {
    const expiresAtSec = this.#entries.get(entryKey(did, nonce));
    return expiresAtSec !== undefined && expiresAtSec >= nowSec;
  }

  /**
   * Record `(did, nonce)` until `expiresAtSec`. The caller checks {@link NonceCache.has}
   * first.
   *
   * The steps are:
   * 1. Purge the expired entries from the head (stop at the first live head).
   * 2. Delete an existing entry for the same key, so that the new entry goes to the tail.
   * 3. If the cache is full, delete the head (the live entry that expires first).
   * 4. Insert the new entry.
   *
   * Returns `'evicted'` if step 3 deleted an entry, else `'stored'`.
   */
  store(did: string, nonce: string, expiresAtSec: number, nowSec: number): NonceStoreResult {
    this.#purge(nowSec);

    const key = entryKey(did, nonce);
    this.#entries.delete(key);

    let result: NonceStoreResult = 'stored';
    if(this.#entries.size >= this.#maxEntries) {
      const head = this.#entries.keys().next();
      if(!head.done) this.#entries.delete(head.value);
      result = 'evicted';
    }

    this.#entries.set(key, expiresAtSec);
    return result;
  }

  /** Current cache size. Exposed for observability and tests. */
  size(): number {
    return this.#entries.size;
  }

  #purge(nowSec: number): void {
    for(const [key, expiresAtSec] of this.#entries) {
      if(expiresAtSec >= nowSec) return;
      this.#entries.delete(key);
    }
  }
}

function entryKey(did: string, nonce: string): string {
  return `${did}:${nonce}`;
}

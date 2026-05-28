/** Number of bytes in a SHA-256 hash. */
export const HASH_BYTE_LENGTH = 32;

/** Number of bits in a SHA-256 hash. */
export const HASH_BIT_LENGTH = 8 * HASH_BYTE_LENGTH;

/** Number of hex characters in a SHA-256 hash. */
export const HASH_HEX_LENGTH = 2 * HASH_BYTE_LENGTH;

/** The null hash: 32 zero bytes. */
export const NULL_HASH = new Uint8Array(HASH_BYTE_LENGTH);

/**
 * `2^256` — one past the top of the 256-bit key space.
 * Used internally for index range checks.
 */
export const OUTER_BIT = 1n << BigInt(HASH_BIT_LENGTH);

/**
 * MSB-first bit masks used during **tree construction** to descend from root
 * (depth 0) to leaf (depth 256). `BITS[i] = 2^(255 - i)`.
 *
 * Note: this is an internal helper for `OptimizedSMT.add()` / `setHash()`,
 * which walk the trie top-down using the index's most-significant bits first.
 * It is NOT the bit order used by the spec's proof verifier, which walks the
 * collapsed bitmap and the index from the LSB upward.
 */
export const BITS: readonly bigint[] = (() => {
  const arr: bigint[] = new Array(HASH_BIT_LENGTH);
  let bit = OUTER_BIT >> 1n; // 2^255
  for (let i = 0; i < HASH_BIT_LENGTH; i++) {
    arr[i] = bit;
    bit >>= 1n;
  }
  return arr;
})();

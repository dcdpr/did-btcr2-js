/** Number of bytes in a SHA-256 hash. */
export const HASH_BYTE_LENGTH = 32;

/** Number of bits in a SHA-256 hash. */
export const HASH_BIT_LENGTH = 8 * HASH_BYTE_LENGTH;

/** Number of hex characters in a SHA-256 hash. */
export const HASH_HEX_LENGTH = 2 * HASH_BYTE_LENGTH;

/** The null hash: 32 zero bytes. Used for non-inclusion leaves. */
export const NULL_HASH = new Uint8Array(HASH_BYTE_LENGTH);

/**
 * Sentinel bit above the 256-bit key space (`2^256`).
 * Used by batch validation to disambiguate left-side indexes.
 */
export const OUTER_BIT = 1n << BigInt(HASH_BIT_LENGTH);

/**
 * Pre-computed MSB-first bit masks for tree traversal and proof validation.
 * `BITS[i] = 2^(255 - i)` for `i` in `[0, 255]`, `BITS[256] = 0n` (sentinel).
 *
 * Used by both {@link OptimizedSMT} (tree building/finalization) and
 * {@link SMTProof} (proof validation) — MUST be the same array.
 */
export const BITS: readonly bigint[] = (() => {
  const arr: bigint[] = new Array(HASH_BIT_LENGTH + 1);
  let bit = OUTER_BIT >> 1n; // 2^255
  for (let i = 0; i < HASH_BIT_LENGTH; i++) {
    arr[i] = bit;
    bit >>= 1n;
  }
  arr[HASH_BIT_LENGTH] = 0n;
  return arr;
})();

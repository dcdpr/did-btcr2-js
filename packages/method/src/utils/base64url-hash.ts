import { base64UrlToHash, hashToHex } from '@did-btcr2/smt';

/** The base64url letters of RFC 4648 Section 5, in the order of their values. */
const BASE64URL_LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';

/**
 * The hex of a base64url SHA-256 hash, or `undefined`. The function returns `undefined` if
 * `value` is not a string, or if the strict decoder does not decode it to 32 bytes. The
 * strict decoder refuses `=` padding, letters outside the base64url alphabet, and non-zero
 * pad bits (RFC 4648 Section 3.5).
 * @param {unknown} value The base64url text, with no padding.
 * @returns {string | undefined} The hex of the 32 decoded bytes, or `undefined`.
 */
export function base64UrlHashHex(value: unknown): string | undefined {
  if(typeof value !== 'string') return undefined;
  try {
    return hashToHex(base64UrlToHash(value));
  } catch {
    return undefined;
  }
}

/**
 * The hex of the decoded `id` of an SMT proof, or `undefined`. The function returns
 * `undefined` if `proof` is not an object, or if its `id` is not a base64url SHA-256 hash
 * (see {@link base64UrlHashHex}).
 * @param {unknown} proof The SMT proof.
 * @returns {string | undefined} The hex of the decoded `id`, or `undefined`.
 */
export function smtProofRootHex(proof: unknown): string | undefined {
  if(typeof proof !== 'object' || proof === null) return undefined;
  return base64UrlHashHex((proof as { id?: unknown }).id);
}

/**
 * True if `value` is base64url text, with or without `=` padding, whose last letter has
 * non-zero pad bits (RFC 4648 Section 3.5). A lenient decoder ignores these bits and gets
 * the same bytes as from the text with zero pad bits. The strict decoder refuses the text.
 * The function does not decode the text.
 * @param {unknown} value The text to check.
 * @returns {boolean} True only for base64url text with non-zero pad bits.
 */
export function hasNonZeroPadBits(value: unknown): boolean {
  if(typeof value !== 'string') return false;
  // The pad bits are in the last letter, also before `=` padding.
  const text = value.replace(/={1,2}$/, '');
  if(!/^[A-Za-z0-9_-]*$/.test(text)) return false;
  // 2 letters hold 1 byte and 4 pad bits. 3 letters hold 2 bytes and 2 pad bits.
  const remainder = text.length % 4;
  if(remainder !== 2 && remainder !== 3) return false;
  const last = BASE64URL_LETTERS.indexOf(text[text.length - 1]!);
  return (last & (remainder === 2 ? 0x0f : 0x03)) !== 0;
}

import { equalBytes } from '@noble/curves/utils.js';
import { sha256 } from '@noble/hashes/sha2';
import { concatBytes } from '@noble/hashes/utils';
import { base64 } from '@scure/base';
import { HASH_BYTE_LENGTH, HASH_HEX_LENGTH } from './constants.js';

/**
 * Returns true if `hash` is exactly {@link HASH_BYTE_LENGTH} bytes.
 */
export function isValidHash(hash: Uint8Array): boolean {
  return hash.length === HASH_BYTE_LENGTH;
}

/**
 * Throws `RangeError` if `hash` is not exactly {@link HASH_BYTE_LENGTH} bytes.
 */
export function validateHash(hash: Uint8Array): void {
  if (!isValidHash(hash)) {
    throw new RangeError(`Invalid hash: expected ${HASH_BYTE_LENGTH} bytes, got ${hash.length}`);
  }
}

/**
 * SHA-256 digest of all `blocks` concatenated in order.
 */
export function blockHash(...blocks: Uint8Array[]): Uint8Array {
  return sha256(concatBytes(...blocks));
}

/**
 * Interpret a 32-byte hash as a big-endian 256-bit unsigned integer.
 */
export function hashToBigInt(hash: Uint8Array): bigint {
  validateHash(hash);
  let value = 0n;
  for (const byte of hash) {
    value = (value << 8n) | BigInt(byte);
  }
  return value;
}

/**
 * Encode a 256-bit unsigned integer as a 32-byte big-endian hash.
 * Throws `RangeError` if the value exceeds 256 bits.
 */
export function bigIntToHash(value: bigint): Uint8Array {
  const hash = new Uint8Array(HASH_BYTE_LENGTH);
  let v = value;
  for (let i = HASH_BYTE_LENGTH - 1; i >= 0; i--) {
    hash[i] = Number(v & 0xFFn);
    v >>= 8n;
  }
  if (v !== 0n) {
    throw new RangeError('Value exceeds 256 bits');
  }
  return hash;
}

/**
 * Convert a 32-byte hash to a zero-padded 64-character lowercase hex string.
 */
export function hashToHex(hash: Uint8Array): string {
  validateHash(hash);
  let s = '';
  for (const byte of hash) {
    s += byte.toString(16).padStart(2, '0');
  }
  return s;
}

/**
 * Parse a 64-character hex string into a 32-byte hash.
 * Throws `RangeError` if the string is invalid.
 */
export function hexToHash(hex: string): Uint8Array {
  validateHex(hex, true);
  const hash = new Uint8Array(HASH_BYTE_LENGTH);
  for (let i = 0; i < HASH_BYTE_LENGTH; i++) {
    hash[i] = Number.parseInt(hex.substring(i * 2, i * 2 + 2), 16);
  }
  return hash;
}

/**
 * Convert a bigint to a hex string.
 * When `padded` is true, the result is zero-padded to 64 characters.
 * When false, leading zeros are stripped (minimum 1 character).
 */
export function bigIntToHex(value: bigint, padded: boolean): string {
  const s = value.toString(16);
  return padded ? s.padStart(HASH_HEX_LENGTH, '0') : s;
}

/**
 * Parse a hex string into a bigint.
 * When `padded` is true, the string must be exactly 64 characters.
 * When false, 1-64 characters are accepted.
 * Throws `RangeError` on invalid input.
 */
export function hexToBigInt(hex: string, padded: boolean): bigint {
  validateHex(hex, padded);
  return BigInt(`0x${hex}`);
}

/**
 * Constant-time comparison of two 32-byte hashes using `equalBytes`.
 * Returns false if either hash has an invalid length.
 */
export function hashesEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (!isValidHash(a) || !isValidHash(b)) return false;
  return equalBytes(a, b);
}

/**
 * Convert a 32-byte hash to a standard base64 string.
 */
export function hashToBase64(hash: Uint8Array): string {
  validateHash(hash);
  return base64.encode(hash);
}

/**
 * Parse a base64 string into a 32-byte hash.
 * Throws `RangeError` if the decoded result is not 32 bytes.
 */
export function base64ToHash(b64: string): Uint8Array {
  const hash = base64.decode(b64);
  if (hash.length !== HASH_BYTE_LENGTH) {
    throw new RangeError(`Invalid base64 hash: expected ${HASH_BYTE_LENGTH} decoded bytes, got ${hash.length}`);
  }
  return hash;
}

/**
 * Convert a bigint to a base64 string.
 * When `padded` is true, the value is zero-padded to 32 bytes before encoding.
 * When false, leading zero bytes are stripped.
 */
export function bigIntToBase64(value: bigint, padded: boolean): string {
  let bytes = bigIntToHash(value);
  if (!padded) {
    const firstNonZero = bytes.findIndex(b => b !== 0x00);
    bytes = firstNonZero === -1 ? new Uint8Array(1) : bytes.slice(firstNonZero);
  }
  return base64.encode(bytes);
}

/**
 * Parse a base64 string into a bigint.
 * When `padded` is true, the decoded bytes must be exactly 32.
 */
export function base64ToBigInt(b64: string, padded: boolean): bigint {
  const bytes = base64.decode(b64);
  if (padded && bytes.length !== HASH_BYTE_LENGTH) {
    throw new RangeError(`Invalid padded base64 bigint: expected ${HASH_BYTE_LENGTH} decoded bytes, got ${bytes.length}`);
  }
  if (bytes.length > HASH_BYTE_LENGTH) {
    throw new RangeError(`Value exceeds ${HASH_BYTE_LENGTH} bytes`);
  }
  let value = 0n;
  for (const byte of bytes) {
    value = (value << 8n) | BigInt(byte);
  }
  return value;
}

// ---------------------------------------------------------------------------
// Internal
// ---------------------------------------------------------------------------

const HEX_RE = /^[0-9A-Fa-f]+$/;

function validateHex(s: string, requireHashLength: boolean): void {
  const len = s.length;
  const minLen = requireHashLength ? HASH_HEX_LENGTH : 1;
  if (len < minLen || len > HASH_HEX_LENGTH || !HEX_RE.test(s)) {
    throw new RangeError(`Invalid hex string: expected ${requireHashLength ? HASH_HEX_LENGTH : '1-' + HASH_HEX_LENGTH} hex characters, got ${len}`);
  }
}

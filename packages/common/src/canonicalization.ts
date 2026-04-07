import { sha256 } from '@noble/hashes/sha2';
import { base58, base64urlnopad, hex } from '@scure/base';
import { canonicalize as jcsa } from 'json-canonicalize';
import { CanonicalizationError } from './errors.js';
import type { HashBytes } from './types.js';

export type CanonicalizationAlgorithm = 'jcs' | 'rdfc';
export type CanonicalizationEncoding = 'hex' | 'base58' | 'base64url';

export interface CanonicalizationOptions {
  algorithm?: CanonicalizationAlgorithm;
  encoding?: CanonicalizationEncoding;
}

const SUPPORTED_ALGORITHMS: ReadonlySet<CanonicalizationAlgorithm> = new Set(['jcs']);
const SUPPORTED_ENCODINGS: ReadonlySet<CanonicalizationEncoding> = new Set(['hex', 'base58', 'base64url']);

/**
 * Normalizes and validates the canonicalization algorithm.
 * @param {CanonicalizationAlgorithm} algorithm - The algorithm to normalize.
 * @returns {CanonicalizationAlgorithm} The normalized algorithm.
 * @throws {CanonicalizationError} If the algorithm is not supported.
 */
function normalizeAlgorithm(algorithm: CanonicalizationAlgorithm): CanonicalizationAlgorithm {
  const lower = algorithm.toLowerCase();
  if (!SUPPORTED_ALGORITHMS.has(lower as CanonicalizationAlgorithm)) {
    throw new CanonicalizationError(`Unsupported algorithm: ${algorithm}`, 'ALGORITHM_ERROR');
  }
  return lower as CanonicalizationAlgorithm;
}

/**
 * Normalizes and validates the canonicalization encoding.
 * @param {CanonicalizationEncoding} encoding - The encoding to normalize.
 * @returns {CanonicalizationEncoding} The normalized encoding.
 * @throws {CanonicalizationError} If the encoding is not supported.
 */
function normalizeEncoding(encoding: CanonicalizationEncoding): CanonicalizationEncoding {
  const lower = encoding.toLowerCase();
  if (!SUPPORTED_ENCODINGS.has(lower as CanonicalizationEncoding)) {
    throw new CanonicalizationError(`Unsupported encoding: ${encoding}`, 'ENCODING_ERROR');
  }
  return lower as CanonicalizationEncoding;
}

/**
 * Canonicalizes a JSON object using the specified algorithm.
 *
 * @param {Record<any, any>} object - The object to canonicalize.
 * @param {CanonicalizationAlgorithm} [algorithm='jcs'] - The algorithm to use.
 * @returns {string} The canonicalized string.
 * @throws {CanonicalizationError} If the algorithm is not supported.
 */
export function canonicalize(object: Record<any, any>, algorithm: CanonicalizationAlgorithm = 'jcs'): string {
  const normalized = normalizeAlgorithm(algorithm);
  switch (normalized) {
    case 'jcs': {
      // Round-trip to a plain object so JCS always sees the same key set
      // regardless of whether the input is a class instance or a POJO.
      const plain = JSON.parse(JSON.stringify(object));
      return jcsa(plain);
    }
    default:
      throw new CanonicalizationError(`Unsupported algorithm: ${algorithm}`, 'ALGORITHM_ERROR');
  }
}

/**
 * SHA-256 hashes a canonicalized string.
 *
 * @param {string} canonicalized - The canonicalized string to hash.
 * @returns {HashBytes} The SHA-256 hash bytes (Uint8Array).
 */
export function hash(canonicalized: string): HashBytes {
  return sha256(canonicalized);
}

/**
 * Encodes hash bytes using the specified encoding.
 *
 * @param {HashBytes} hashBytes - The hash bytes to encode.
 * @param {CanonicalizationEncoding} [encoding='base64url'] - The encoding format.
 * @returns {string} The encoded string.
 * @throws {CanonicalizationError} If the encoding is not supported.
 */
export function encode(hashBytes: HashBytes, encoding: CanonicalizationEncoding = 'base64url'): string {
  const normalized = normalizeEncoding(encoding);
  switch (normalized) {
    case 'hex':       return hex.encode(hashBytes);
    case 'base58':    return base58.encode(hashBytes);
    case 'base64url': return base64urlnopad.encode(hashBytes);
  }
}

/**
 * Decodes an encoded hash string back to bytes.
 *
 * @param {string} encoded - The encoded hash string.
 * @param {CanonicalizationEncoding} [encoding='base64url'] - The encoding format.
 * @returns {HashBytes} The decoded hash bytes.
 * @throws {CanonicalizationError} If the encoding is not supported.
 */
export function decode(encoded: string, encoding: CanonicalizationEncoding = 'base64url'): HashBytes {
  const normalized = normalizeEncoding(encoding);
  switch (normalized) {
    case 'hex':       return hex.decode(encoded);
    case 'base58':    return base58.decode(encoded);
    case 'base64url': return base64urlnopad.decode(encoded);
  }
}

/**
 * Implements {@link https://dcdpr.github.io/did-btcr2/algorithms.html#json-document-hashing | 8.c JSON Document Hashing}.
 *
 * Full pipeline: Canonicalize (JCS) -> Hash (SHA-256) -> Encode.
 *
 * @param {Record<any, any>} object - The object to process.
 * @param {CanonicalizationOptions} [options] - Options for algorithm and encoding.
 * @returns {string} The encoded hash string.
 */
export function canonicalHash(object: Record<any, any>, options?: CanonicalizationOptions): string {
  const algorithm = normalizeAlgorithm(options?.algorithm ?? 'jcs');
  const encoding = normalizeEncoding(options?.encoding ?? 'base64url');
  return encode(hash(canonicalize(object, algorithm)), encoding);
}

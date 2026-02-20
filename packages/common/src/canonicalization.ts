import { sha256 } from '@noble/hashes/sha2';
import { bytesToHex, hexToBytes } from '@noble/hashes/utils';
import { canonicalize as jcsa } from 'json-canonicalize';
import { base58btc } from 'multiformats/bases/base58';
import { CanonicalizationError } from './errors.js';
import { CanonicalizationAlgorithm, CanonicalizationEncoding, HashBytes, HexString } from './types.js';

export interface CanonicalizationOptions {
  algorithm?: CanonicalizationAlgorithm;
  encoding?: CanonicalizationEncoding;
}

/**
 * Canonicalization class provides methods for canonicalizing JSON objects
 * and hashing them using SHA-256. It supports different canonicalization
 * algorithms and encoding formats (hex and base58).
 * @class Canonicalization
 * @type {Canonicalization}
 */
export class Canonicalization {
  /**
   * Normalizes the canonicalization algorithm.
   * @param {CanonicalizationAlgorithm} algorithm
   * @returns {CanonicalizationAlgorithm} The normalized algorithm.
   * @throws {CanonicalizationError} If the algorithm is not supported.
   */
  static normalizeAlgorithm(algorithm: CanonicalizationAlgorithm): CanonicalizationAlgorithm {
    const normalized = algorithm.toLowerCase() as CanonicalizationAlgorithm;
    if (normalized !== 'jcs') {
      throw new CanonicalizationError(`Unsupported algorithm: ${algorithm}`, 'ALGORITHM_ERROR');
    }
    return normalized;
  }

  /**
   * Normalizes the canonicalization encoding.
   * @param {CanonicalizationEncoding} encoding - The encoding to normalize.
   * @returns {CanonicalizationEncoding} The normalized encoding.
   * @throws {CanonicalizationError} If the encoding is not supported.
   */
  static normalizeEncoding(encoding: CanonicalizationEncoding): CanonicalizationEncoding {
    const normalized = encoding.toLowerCase() as CanonicalizationEncoding;
    if (normalized !== 'hex' && normalized !== 'base58') {
      throw new CanonicalizationError(`Unsupported encoding: ${encoding}`, 'ENCODING_ERROR');
    }
    return normalized;
  }

  /**
   * Implements {@link http://dcdpr.github.io/did-btcr2/#json-canonicalization-and-hash | 9.2 JSON Canonicalization and Hash}.
   *
   * A macro function that takes in a JSON document, document, and canonicalizes it following the JSON Canonicalization
   * Scheme. The function returns the canonicalizedBytes.
   *
   * Optionally encodes a sha256 hashed canonicalized JSON object.
   * Step 1 Canonicalize (JCS) → Step 2 Hash (SHA256) → Step 3 Encode (Hex/Base58).
   *
   * @param {Record<any, any>} object The object to process.
   * @param {Object} [options] Options for processing.
   * @param {CanonicalizationEncoding} [options.encoding='hex'] The encoding format ('hex' or 'base58').
   * @param {CanonicalizationAlgorithm} [options.algorithm] The canonicalization algorithm to use.
   * @returns {string} The final SHA-256 hash bytes as a hex string.
   */
  static process(object: Record<any, any>, options?: CanonicalizationOptions): string {
    // Normalize the algorithm
    const algorithm = Canonicalization.normalizeAlgorithm(options?.algorithm ?? 'jcs');
    // Normalize the encoding
    const encoding = Canonicalization.normalizeEncoding(options?.encoding ?? 'hex');

    // Step 1: Canonicalize
    const canonicalized = this.canonicalize(object, algorithm);
    // Step 2: Hash
    const hashed = this.toHash(canonicalized);
    // Step 3: Encode
    const encoded = this.encode(hashed, encoding);
    // Return the encoded string
    return encoded;
  }

  /**
   * Step 1: Uses this.algorithm to determine the method (JCS).
   * @param {Record<any, any>} object The object to canonicalize.
   * @param {CanonicalizationAlgorithm} [algorithm] The algorithm to use.
   * @returns {string} The canonicalized object.
   */
  static canonicalize(object: Record<any, any>, algorithm: CanonicalizationAlgorithm = 'jcs'): string {
    switch (Canonicalization.normalizeAlgorithm(algorithm)) {
      case 'jcs':
        return this.jcs(object);
      default:
        throw new CanonicalizationError(`Unsupported algorithm: ${algorithm}`, 'ALGORITHM_ERROR');
    }
  }

  /**
   * Step 1: Canonicalizes an object using JCS (JSON Canonicalization Scheme).
   * @param {Record<any, any>} object The object to canonicalize.
   * @returns {string} The canonicalized object.
   */
  static jcs(object: Record<any, any>): string {
    return jcsa(object);
  }

  /**
   * Step 2: SHA-256 hashes a canonicalized object.
   * @param {string} canonicalized The canonicalized object.
   * @returns {HashBytes} The SHA-256 HashBytes (Uint8Array).
   */
  static toHash(canonicalized: string): HashBytes {
    return sha256(canonicalized);
  }

  /**
   * Step 3: Encodes SHA-256 hashed, canonicalized object as a hex or base58 string.
   * @param {string} canonicalizedhash The canonicalized object to encode.
   * @param {CanonicalizationEncoding} encoding The encoding format ('hex' or 'base58').
   * @throws {CanonicalizationError} If the encoding format is not supported.
   * @returns {string} The encoded string.
   */
  static encode(canonicalizedhash: HashBytes, encoding: CanonicalizationEncoding = 'hex'): string {
    // Normalize encoding
    const normalized = Canonicalization.normalizeEncoding(encoding);

    // If encoding is hex, encode to hex
    if (normalized === 'hex') {
      return this.toHex(canonicalizedhash);
    }

    // If encoding is base58, encode to base58
    if (normalized === 'base58') {
      return this.toBase58(canonicalizedhash);
    }

    // Throw error if encoding is unsupported
    throw new CanonicalizationError(`Unsupported encoding: ${encoding}`, 'ENCODING_ERROR');
  }

  /**
   * Decodes SHA-256 hashed, canonicalized object as a hex or base58 string.
   * @param {string} canonicalizedhash The canonicalized object to encode.
   * @param {CanonicalizationEncoding} encoding The encoding format ('hex' or 'base58').
   * @throws {CanonicalizationError} If the encoding format is not supported.
   * @returns {string} The encoded string.
   */
  static decode(canonicalizedhash: string, encoding: CanonicalizationEncoding = 'hex'): HashBytes {
    // Normalize encoding
    const normalized = Canonicalization.normalizeEncoding(encoding);

    // If encoding is hex, decode from hex
    if (normalized === 'hex') {
      return this.fromHex(canonicalizedhash);
    }

    // If encoding is base58, decode from base58
    if (normalized === 'base58') {
      return this.fromBase58(canonicalizedhash);
    }

    // Throw error if encoding is unsupported
    throw new CanonicalizationError(`Unsupported encoding: ${encoding}`, 'DECODING_ERROR');
  }

  /**
   * Step 3.1: Encodes HashBytes (Uint8Array) to a hex string.
   * @param {HashBytes} hashBytes The hash as a Uint8Array.
   * @returns {string} The hash as a hex string.
   */
  static toHex(hashBytes: HashBytes): string {
    return bytesToHex(hashBytes);
  }

  /**
   * Decodes a hex string to HashBytes (Uint8Array).
   * @param {HexString} hexString The hash as a hex string.
   * @returns {HashBytes} The hash bytes.
   */
  static fromHex(hexString: HexString): HashBytes {
    return hexToBytes(hexString);
  }

  /**
   * Step 3.2: Encodes HashBytes (Uint8Array) to a base58btc string.
   * @param {HashBytes} hashBytes The hash as a Uint8Array.
   * @returns {string} The hash as a hex string.
   */
  static toBase58(hashBytes: HashBytes): string {
    return base58btc.encode(hashBytes);
  }

  /**
   * Decodes a base58 string to HashBytes (Uint8Array).
   * @param {string} b58str The hash as a base58 string.
   * @returns {HashBytes} The hash bytes.
   */
  static fromBase58(b58str: string): HashBytes {
    return base58btc.decode(b58str);
  }

  /**
   * Canonicalizes an object, hashes it and returns it as hash bytes.
   * Step 1-2: Canonicalize → Hash.
   * @param {Record<any, any>} object The object to process.
   * @returns {Promise<HashBytes>} The final SHA-256 hash bytes.
   */
  static andHash(
    object: Record<any, any>,
    algorithm: CanonicalizationAlgorithm = 'jcs'
  ): HashBytes {
    // Step 1: Canonicalize
    const canonicalized = this.canonicalize(object, algorithm);
    // Step 2: Hash
    const hashed = this.toHash(canonicalized);
    // Return canonicalized hash bytes
    return hashed;
  }

  /**
   * Computes the SHA-256 hash of a canonicalized object and encodes it as a hex string.
   * Step 2-3: Hash → Encode(Hex).
   * @param {string} canonicalized The canonicalized object to hash.
   * @returns {string} The SHA-256 hash as a hex string.
   */
  static andHashToHex(canonicalized: string): string {
    // Step 2: Hash
    const hashed = this.toHash(canonicalized);
    // Step 3: Encode (Hex)
    const hexed = this.toHex(hashed);
    // Return the hashed encoded string
    return hexed;
  }

  /**
   * Computes the SHA-256 hashes of canonicalized object and encodes it as a base58 string.
   * Step 2-3: Hash → Encode(base58).
   * @param {string} canonicalized The canonicalized object to hash.
   * @returns {string} The SHA-256 hash as a base58 string.
   */
  static andHashToBase58(canonicalized: string): string {
    return this.encode(this.toHash(canonicalized), 'base58');
  }
}

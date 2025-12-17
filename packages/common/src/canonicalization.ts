import { sha256 } from '@noble/hashes/sha2';
import { bytesToHex } from '@noble/hashes/utils';
import { canonicalize as jcsa } from 'json-canonicalize';
import { base58btc } from 'multiformats/bases/base58';
import { CanonicalizationError } from './errors.js';
import { CanonicalizationAlgorithm, CanonicalizationEncoding, HashBytes } from './types.js';

/**
 * Canonicalization class provides methods for canonicalizing JSON objects
 * and hashing them using SHA-256. It supports different canonicalization
 * algorithms and encoding formats (hex and base58).
 * @class Canonicalization
 * @type {Canonicalization}
 */
export class Canonicalization {
  private readonly _defaultAlgorithm: CanonicalizationAlgorithm;

  /**
   * Initializes the Canonicalization class with the specified algorithm.
   * @param {CanonicalizationAlgorithm} algorithm The canonicalization algorithm to use ('jcs').
   */
  constructor(algorithm: CanonicalizationAlgorithm = 'jcs') {
    this._defaultAlgorithm = Canonicalization.normalizeAlgorithm(algorithm);
  }

  /**
   * Gets the canonicalization algorithm.
   * @returns {CanonicalizationAlgorithm} The current canonicalization algorithm.
   */
  get algorithm(): CanonicalizationAlgorithm {
    return this._defaultAlgorithm;
  }

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
   * @returns {Promise<string>} The final SHA-256 hash bytes as a hex string.
   */
  async process(object: Record<any, any>, options: {
    encoding?: CanonicalizationEncoding;
    algorithm?: CanonicalizationAlgorithm;
    multibase?: boolean;
  } = {}): Promise<string> {
    const algorithm = Canonicalization.normalizeAlgorithm(options.algorithm ?? this._defaultAlgorithm);
    const encoding = Canonicalization.normalizeEncoding(options.encoding ?? 'hex');

    // Step 1: Canonicalize
    const canonicalized = await this.canonicalize(object, algorithm);
    // Step 2: Hash
    const hashed = this.hash(canonicalized);
    // Step 3: Encode
    const encoded = this.encode(hashed, encoding, options.multibase ?? false);
    // Return the encoded string
    return encoded;
  }

  /**
   * Step 1: Uses this.algorithm to determine the method (JCS).
   * @param {Record<any, any>} object The object to canonicalize.
   * @param {CanonicalizationAlgorithm} [algorithm] The algorithm to use.
   * @returns {Promise<string>} The canonicalized object.
   */
  async canonicalize(object: Record<any, any>, algorithm: CanonicalizationAlgorithm = this._defaultAlgorithm): Promise<string> {
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
  jcs(object: Record<any, any>): string {
    return jcsa(object);
  }

  /**
   * Step 2: SHA-256 hashes a canonicalized object.
   * @param {string} canonicalized The canonicalized object.
   * @returns {HashBytes} The SHA-256 HashBytes (Uint8Array).
   */
  public hash(canonicalized: string): HashBytes {
    return sha256(canonicalized);
  }

  /**
   * Step 3: Encodes SHA-256 hashed, canonicalized object as a hex or base58 string.
   * @param {string} canonicalizedhash The canonicalized object to encode.
   * @param {CanonicalizationEncoding} encoding The encoding format ('hex' or 'base58').
   * @throws {CanonicalizationError} If the encoding format is not supported.
   * @returns {string} The encoded string.
   */
  public encode(canonicalizedhash: HashBytes, encoding: CanonicalizationEncoding = 'hex', multibase: boolean = false): string {
    const normalized = Canonicalization.normalizeEncoding(encoding);
    if (normalized === 'hex') return this.hex(canonicalizedhash);
    if (normalized === 'base58') {
      const encoded = this.base58(canonicalizedhash);
      return multibase ? `z${encoded}` : encoded;
    }
    throw new CanonicalizationError(`Unsupported encoding: ${encoding}`, 'ENCODING_ERROR');
  }

  /**
   * Step 3.1: Encodes HashBytes (Uint8Array) to a hex string.
   * @param {HashBytes} hashBytes The hash as a Uint8Array.
   * @returns {string} The hash as a hex string.
   */
  public hex(hashBytes: HashBytes): string {
    return bytesToHex(hashBytes);
  }

  /**
   * Step 3.2: Encodes HashBytes (Uint8Array) to a base58btc string.
   * @param {HashBytes} hashBytes The hash as a Uint8Array.
   * @returns {string} The hash as a hex string.
   */
  public base58(hashBytes: HashBytes): string {
    const encoded = base58btc.encode(hashBytes);
    return encoded.startsWith('z') ? encoded.slice(1) : encoded;
  }

  /**
   * Canonicalizes an object, hashes it and returns it as hash bytes.
   * Step 1-2: Canonicalize → Hash.
   * @param {Record<any, any>} object The object to process.
   * @returns {Promise<HashBytes>} The final SHA-256 hash bytes.
   */
  public async canonicalhash(
    object: Record<any, any>,
    algorithm: CanonicalizationAlgorithm = this._defaultAlgorithm
  ): Promise<HashBytes> {
    const canonicalized = await this.canonicalize(object, algorithm);
    return this.hash(canonicalized);
  }

  /**
   * Computes the SHA-256 hash of a canonicalized object and encodes it as a hex string.
   * Step 2-3: Hash → Encode(Hex).
   * @param {string} canonicalized The canonicalized object to hash.
   * @returns {string} The SHA-256 hash as a hex string.
   */
  public hashhex(canonicalized: string): string {
    return this.encode(this.hash(canonicalized), 'hex');
  }

  /**
   * Computes the SHA-256 hashes of canonicalized object and encodes it as a base58 string.
   * Step 2-3: Hash → Encode(base58).
   * @param {string} canonicalized The canonicalized object to hash.
   * @returns {string} The SHA-256 hash as a base58 string.
   */
  public hashbase58(canonicalized: string): string {
    return this.encode(this.hash(canonicalized), 'base58', false);
  }
}

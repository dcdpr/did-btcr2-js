import { sha256 } from '@noble/hashes/sha2';
import { bytesToHex } from '@noble/hashes/utils';
import { canonicalize as jcsa } from 'json-canonicalize';
import { base58btc } from 'multiformats/bases/base58';
import rdf from 'rdf-canonize';
import { CanonicalizationAlgorithm, HashBytes, JSONObject } from './types.js';
import { CanonicalizationError } from './errors.js';

/**
 * Canonicalization class provides methods for canonicalizing JSON objects
 * and hashing them using SHA-256. It supports different canonicalization
 * algorithms and encoding formats (hex and base58).
 * @class Canonicalization
 * @type {Canonicalization}
 */
export class Canonicalization {
  private _algorithm: CanonicalizationAlgorithm;

  /**
   * Initializes the Canonicalization class with the specified algorithm.
   * @param {CanonicalizationAlgorithm} algorithm The canonicalization algorithm to use ('jcs' or 'rdfc').
   */
  // TODO: Need to move to using RDFC by default
  constructor(algorithm: CanonicalizationAlgorithm = 'jcs') {
    this._algorithm = algorithm;
  }

  /**
   * Sets the canonicalization algorithm.
   * @param {'jcs' | 'rdfc'} algorithm Either 'jcs' or 'rdfc'.
   */
  set algorithm(algorithm: 'jcs' | 'rdfc') {
    // Normalize the passed algorithm to lowercase
    algorithm = algorithm.toLowerCase() as CanonicalizationAlgorithm;

    // Validate the algorithm is either 'jcs' or 'rdfc'
    if(!['jcs', 'rdfc'].includes(algorithm)){
      throw new CanonicalizationError(`Unsupported algorithm: ${algorithm}`, 'ALGORITHM_ERROR');
    }
    // Set the algorithm
    this._algorithm = algorithm;
  }

  /**
   * Gets the canonicalization algorithm.
   * @returns {CanonicalizationAlgorithm} The current canonicalization algorithm.
   */
  get algorithm(): CanonicalizationAlgorithm {
    return this._algorithm;
  }

  /**
   * Implements {@link http://dcdpr.github.io/did-btcr2/#json-canonicalization-and-hash | 9.2 JSON Canonicalization and Hash}.
   *
   * A macro function that takes in a JSON document, document, and canonicalizes it following the JSON Canonicalization
   * Scheme. The function returns the canonicalizedBytes.
   *
   * Optionally encodes a sha256 hashed canonicalized JSON object.
   * Step 1 Canonicalize (JCS/RDFC) → Step 2 Hash (SHA256) → Step 3 Encode (Hex/Base58).
   *
   * @param {JSONObject} object The object to process.
   * @param {string} encoding The encoding format ('hex' or 'base58').
   * @returns {Promise<string>} The final SHA-256 hash bytes as a hex string.
   */
  public async process(object: JSONObject, encoding: string = 'hex'): Promise<string> {
    // Step 1: Canonicalize
    const canonicalized = await this.canonicalize(object);
    // Step 2: Hash
    const hashed = this.hash(canonicalized);
    // Step 3: Encode
    const encoded = this.encode(hashed, encoding);
    // Return the encoded string
    return encoded;
  }

  /**
   * Step 1: Uses this.algorithm to determine the method (JCS/RDFC).
   * @param {JSONObject} object The object to canonicalize.
   * @returns {Promise<string>} The canonicalized object.
   */
  public async canonicalize(object: JSONObject): Promise<string> {
    return await (this[this.algorithm] as (object: JSONObject) => any)(object);
  }

  /**
   * Step 1: Canonicalizes an object using JCS (JSON Canonicalization Scheme).
   * @param {JSONObject} object The object to canonicalize.
   * @returns {string} The canonicalized object.
   */
  public jcs(object: JSONObject): any {
    return jcsa(object);
  }

  /**
   * Step 1: Canonicalizes an object using RDF Canonicalization (RDFC).
   * @param {JSONObject} object The object to canonicalize.
   * @returns {Promise<string>} The canonicalized object.
   */
  public rdfc(object: JSONObject): Promise<string> {
    return rdf.canonize([object], { algorithm: 'RDFC-1.0' });
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
   * @param {string} encoding The encoding format ('hex' or 'base58').
   * @throws {CanonicalizationError} If the encoding format is not supported.
   * @returns {string} The encoded string.
   */
  public encode(canonicalizedhash: HashBytes, encoding: string = 'hex'): string {
    switch(encoding) {
      case 'hex':
        return this.hex(canonicalizedhash);
      case 'base58':
        return this.base58(canonicalizedhash);
      default:
        throw new CanonicalizationError(`Unsupported encoding: ${encoding}`, 'ENCODING_ERROR');
    }
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
    return base58btc.encode(hashBytes);
  }

  /**
   * Canonicalizes an object, hashes it and returns it as hash bytes.
   * Step 1-2: Canonicalize → Hash.
   * @param {JSONObject} object The object to process.
   * @returns {Promise<HashBytes>} The final SHA-256 hash bytes.
   */
  public async canonicalhash(object: JSONObject): Promise<HashBytes> {
    const canonicalized = await this.canonicalize(object);
    return this.hash(canonicalized);
  }

  /**
   * Computes the SHA-256 hash of a canonicalized object and encodes it as a hex string.
   * Step 2-3: Hash → Encode(Hex).
   * @param {string} canonicalized The canonicalized object to hash.
   * @returns {string} The SHA-256 hash as a hex string.
   */
  public hashhex(canonicalized: string): string {
    return this.encode(this.hash(canonicalized));
  }

  /**
   * Computes the SHA-256 hashes of canonicalized object and encodes it as a base58 string.
   * Step 2-3: Hash → Encode(base58).
   * @param {string} canonicalized The canonicalized object to hash.
   * @returns {string} The SHA-256 hash as a base58 string.
   */
  public hashb58(canonicalized: string): string {
    return this.encode(this.hash(canonicalized), 'base58');
  }
}

export const canonicalization = new Canonicalization();
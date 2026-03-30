import {
  Bytes,
  Hex,
  KeyBytes,
  MultibaseObject,
  PublicKeyError,
  PublicKeyObject
} from '@did-btcr2/common';
import { secp256k1, schnorr } from '@noble/curves/secp256k1.js';
import { equalBytes } from '@noble/curves/utils.js';
import { base58 } from '@scure/base';
import { CryptoOptions } from './types.js';

export const BIP340_PUBLIC_KEY_MULTIBASE_PREFIX: Bytes = new Uint8Array([0xe7, 0x01]);

/**
 * Point Interface representing an (x, y) coordinate on the secp256k1 curve.
 * @interface Point
 * @type {Point}
 */
export interface Point {
  x: KeyBytes;
  y: KeyBytes;
}

/**
 * General PublicKey Interface used by CompressedSecp256k1PublicKey.
 * @interface PublicKey
 * @type {PublicKey}
 */
export interface PublicKey {
  /**
   * Compressed public key getter.
   * @readonly @type {KeyBytes} The 33 byte compressed public key [parity, x-coord].
   */
  compressed: KeyBytes;

  /**
   * Uncompressed public key getter.
   * @readonly @type {KeyBytes} The 65 byte uncompressed public key [0x04, x-coord, y-coord].
   */
  uncompressed: KeyBytes;

  /**
   * X-only public key getter.
   * @readonly @type {KeyBytes} The 32 byte x-only public key [x-coord].
   */
  xOnly: KeyBytes;

  /**
   * CompressedSecp256k1PublicKey parity getter.
   * @readonly @type {number} The 1 byte parity (0x02 if even, 0x03 if odd).
   */
  parity: number;

  /**
   * CompressedSecp256k1PublicKey isEven getter.
   * @readonly @type {boolean} True if the public key is even, false if odd.
   */
  isEven: boolean;

  /**
   * CompressedSecp256k1PublicKey x-coordinate getter.
   * @readonly @type {KeyBytes} The 32 byte x-coordinate of the public key.
   */
  x: KeyBytes;

  /**
   * CompressedSecp256k1PublicKey y-coordinate getter.
   * @readonly @type {KeyBytes} The 32 byte y-coordinate of the public key.
   */
  y: KeyBytes;

  /**
   * CompressedSecp256k1PublicKey multibase getter.
   * @readonly @returns {MultibaseObject} The public key as MultibaseObject as a address string, key and prefix bytes.
   */
  multibase: MultibaseObject;

  /**
   * CompressedSecp256k1PublicKey hex string getter.
   * @readonly @type {Hex} The public key as a hex string.
   */
  hex: Hex;

  /**
   * CompressedSecp256k1PublicKey point getter.
   * @readonly @type {Point} The public key as a point (x, y).
   */
  point: Point;

  /**
   * Decode the base58btc multibase string to the compressed public key prefixed with 0x02.
   * @returns {KeyBytes} The public key as a 33-byte compressed public key with header.
   */
  decode(): KeyBytes;

  /**
   * Encode the CompressedSecp256k1PublicKey as an x-only base58btc multibase public key.
   * @returns {string} The public key formatted a base58btc multibase string.
   */
  encode(): string;

  /**
   * Public key equality check.
   * @param {PublicKey} other The public key to compare.
   * @returns {boolean} True if the public keys are equal.
   */
  equals(other: PublicKey): boolean;
}

/**
 * Encapsulates a secp256k1 public key compliant to BIP-340 BIP schnorr signature scheme.
 * Provides get methods for different formats (compressed, x-only, multibase).
 * Provides helpers methods for comparison and serialization.
 * @class CompressedSecp256k1PublicKey
 * @type {CompressedSecp256k1PublicKey}
 */
export class CompressedSecp256k1PublicKey implements PublicKey {
  /**
   * The public key bytes
   **/
  readonly #bytes: KeyBytes;

  /**
   * The public key as a MultibaseObject
   */
  readonly #multibase: MultibaseObject = {
    prefix  : BIP340_PUBLIC_KEY_MULTIBASE_PREFIX,
    key     : [],
    encoded : ''
  };

  /**
   * Creates a CompressedSecp256k1PublicKey instance.
   * @param {Hex} initialBytes The public key byte array.
   * @throws {PublicKeyError} if the byte length is not 32 (x-only) or 33 (compressed)
   */
  constructor(initialBytes: Hex) {
    // Convert hex string to Uint8Array if necessary
    const keyBytes = initialBytes instanceof Uint8Array
      ? initialBytes
      : Uint8Array.from(Buffer.from(initialBytes, 'hex'));

    // If the byte length is not 33, throw an error
    if(!keyBytes || keyBytes.length !== 33) {
      throw new PublicKeyError(
        'Invalid argument: byte length must be 33 (compressed)',
        'CONSTRUCTOR_ERROR', { keyBytes }
      );
    }

    // Validate the point is on curve and in compressed form
    if (!secp256k1.utils.isValidPublicKey(keyBytes)) {
      throw new PublicKeyError(
        'Invalid argument: not a valid secp256k1 compressed point',
        'CONSTRUCTOR_ERROR', { keyBytes }
      );
    }
    // Defensive copy — caller cannot mutate internal state
    this.#bytes = new Uint8Array(keyBytes);

    // Set multibase
    this.#multibase.encoded = this.encode();
    this.#multibase.key = [...this.#multibase.prefix, ...this.compressed];
  }

  /**
   * Get the compressed public key.
   * @returns {KeyBytes} The 33-byte compressed public key (0x02 or 0x03, x).
   */
  get compressed(): KeyBytes {
    const bytes = new Uint8Array(this.#bytes);
    return bytes;
  };

  /**
   * Get the uncompressed public key.
   * @returns {Uint8Array} The 65-byte uncompressed public key (0x04, x, y).
   */
  get uncompressed(): KeyBytes {
    return secp256k1.Point.fromBytes(this.compressed).toBytes(false);
  }

  /**
   * X-only (32-byte) view of the public key per BIP-340.
   */
  get xOnly(): KeyBytes {
    const xOnly = this.compressed.slice(1);
    return xOnly;
  }

  /**
   * Parity of the SEC compressed public key.
   * @returns {0x02 | 0x03} The parity byte (0x02 if even, 0x03 if odd).
   * @throws {PublicKeyError} If the parity byte is not 0x02 or 0x03.
   */
  get parity(): 0x02 | 0x03 {
    const parity = this.compressed[0];
    if(![0x02, 0x03].includes(parity)) {
      throw new PublicKeyError(
        'Invalid state: parity byte must be 2 or 3',
        'PARITY_ERROR', { parity }
      );
    }
    return parity as 0x02 | 0x03;
  }

  /**
   * Whether the SEC compressed public key has even Y.
   * @returns {boolean} True if the public key has even Y.
   */
  get isEven(): boolean {
    return this.parity === 0x02;
  }

  /**
   * Get the x-coordinate of the public key.
   * @returns {Uint8Array} The 32-byte x-coordinate of the public key.
   */
  get x(): KeyBytes {
    const x = this.compressed.slice(1, 33);
    return x;
  }

  /**
   * Get the y-coordinate of the public key.
   * @returns {Uint8Array} The 32-byte y-coordinate of the public key.
   */
  get y(): KeyBytes {
    const y = this.uncompressed.slice(33, 65);
    return y;
  }

  /**
   * Get the multibase public key.
   * @returns {MultibaseObject} An object containing the multibase bytes, address and prefix.
   */
  get multibase(): MultibaseObject {
    return {
      prefix  : new Uint8Array(this.#multibase.prefix),
      key     : [...this.#multibase.key],
      encoded : this.#multibase.encoded
    };
  }

  /**
   * Returns the raw public key as a hex string.
   * @returns {string} The public key as a hex string.
   */
  get hex(): string {
    const hex = Buffer.from(this.compressed).toString('hex');
    return hex;
  }

  /**
   * Return the public key point.
   * @returns {Point} The public key point.
   */
  get point(): Point {
    return {
      x : this.x,
      y : this.y
    };
  }

  /**
   * Returns the BIP-340 (x-only) representation of this key.
   * @returns {KeyBytes} The BIP-340 (x-only) representation of the public key.
   */
  bip340(): KeyBytes {
    return this.xOnly;
  }

  /**
   * Decodes the multibase string to the 35-byte corresponding public key (2 byte prefix + 32 byte public key).
   * @returns {KeyBytes} The decoded public key: prefix and public key bytes
   */
  decode(): KeyBytes {
    return base58.decode(this.multibase.encoded.slice(1));
  }

  /**
   * Encodes compressed secp256k1 public key from bytes to BIP340 multibase format.
   * @returns {string} The public key encoded in base-58-btc multibase format.
   */
  encode(): string {
    const pk = Array.from(this.compressed);
    const publicKeyMultibase = Array.from(BIP340_PUBLIC_KEY_MULTIBASE_PREFIX);
    publicKeyMultibase.push(...pk);
    return 'z' + base58.encode(Uint8Array.from(publicKeyMultibase));
  }

  /**
   * Verify a signature using schnorr or ecdsa.
   * @param {SignatureBytes} signature Signature for verification.
   * @param {string} data Data for verification.
   * @param {CryptoOptions} opts Options for signing.
   * @param {('ecdsa' | 'schnorr')} opts.scheme The signature scheme to use. Default is 'schnorr'.
   * @returns {boolean} If the signature is valid against the public key.
   */
  verify(signature: Bytes, data: Bytes, opts?: CryptoOptions): boolean {
    // Default to schnorr scheme
    opts ??= { scheme: 'schnorr' };

    if(opts.scheme === 'ecdsa') {
      return secp256k1.verify(signature, data, this.compressed);
    }
    else if(opts.scheme === 'schnorr') {
      return schnorr.verify(signature, data, this.x);
    }

    // If scheme is neither ecdsa nor schnorr, throw an error
    throw new PublicKeyError(`Invalid scheme: ${opts.scheme}.`, 'VERIFY_SIGNATURE_ERROR', opts);
  }

  /**
   * Compares this public key to another public key.
   * @param {PublicKey} other The other public key to compare
   * @returns {boolean} True if the public keys are equal, false otherwise.
   */
  equals(other: PublicKey): boolean {
    return equalBytes(this.compressed, other.compressed);
  }

  /**
   * JSON representation of a CompressedSecp256k1PublicKey object.
   * @returns {PublicKeyObject} The CompressedSecp256k1PublicKey as a JSON object.
   */
  toJSON(): PublicKeyObject {
    return {
      hex       : this.hex,
      multibase : this.multibase,
      point     : {
        x      : Array.from(this.x),
        y      : Array.from(this.y),
        parity : this.parity,
      },
    };
  }

  /**
   * Static method to validate a public key.
   * @param {Hex} pk The public key in hex (Uint8Array or string) format.
   * @returns {boolean} True if the public key is valid, false otherwise.
   */
  static isValid(pk: Hex): boolean {
    try {
      new CompressedSecp256k1PublicKey(pk);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Creates a CompressedSecp256k1PublicKey object from a JSON representation.
   * @param {PublicKeyObject} json The JSON object to initialize the CompressedSecp256k1PublicKey.
   * @returns {CompressedSecp256k1PublicKey} The initialized CompressedSecp256k1PublicKey object.
   */
  static fromJSON(json: PublicKeyObject): CompressedSecp256k1PublicKey {
    return new CompressedSecp256k1PublicKey(Uint8Array.from([json.point.parity, ...json.point.x]));
  }

}
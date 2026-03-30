import {
  Bytes,
  Hex,
  HexString,
  KeyBytes,
  SecretKeyError,
  SecretKeyObject,
  SignatureBytes
} from '@did-btcr2/common';
import { sha256 } from '@noble/hashes/sha2';
import { bytesToHex } from '@noble/hashes/utils';
import { secp256k1, schnorr } from '@noble/curves/secp256k1.js';
import { randomBytes } from '@noble/hashes/utils';
import { base58 } from '@scure/base';
import { CompressedSecp256k1PublicKey } from './public.js';
import { CryptoOptions } from './types.js';
import { equalBytes } from '@noble/curves/utils.js';

/** Fixed secret key header bytes per the Data Integrity BIP340 Cryptosuite spec: [0x81, 0x26] */
const BIP340_SECRET_KEY_MULTIBASE_PREFIX: Bytes = new Uint8Array([0x81, 0x26]);
/** Hash of the BIP-340 Multikey secret key prefix */
const BIP340_SECRET_KEY_MULTIBASE_PREFIX_HASH: string = bytesToHex(sha256(BIP340_SECRET_KEY_MULTIBASE_PREFIX));

/**
 * General SecretKey interface for the Secp256k1SecretKey class.
 * @interface SecretKey
 * @type {SecretKey}
 */
export interface SecretKey {
  /**
   * Get the secret key bytes.
   * @readonly @type {KeyBytes} The secret key bytes.
   */
  bytes: KeyBytes;

  /**
   * Getter returns the secret key bytes in bigint format.
   * Setter allows alternative method of using a bigint seed for the entropy.
   * @type {bigint} The secret key seed.
   */
  seed: bigint;

  /**
   * Get the secret key as a hex string.
   * @readonly @type {Hex} The secret key as a hex string.
   */
  hex: Hex;

  /**
   * Checks if this secret key is equal to another secret key.
   * @param {SecretKey} other The other secret key to compare.
   * @returns {boolean} True if the private keys are equal.
   */
  equals(other: SecretKey): boolean;

  /**
   * Uses the secret key to compute the corresponding public key.
   * @returns {CompressedSecp256k1PublicKey} The computed public key bytes.
   */
  computePublicKey(): CompressedSecp256k1PublicKey;

  /**
   * Checks if the secret key is valid.
   * @returns {boolean} Whether the secret key is valid.
   */
  isValid(): boolean;
}

/**
 * Encapsulates a secp256k1 secret key
 * Provides get methods for different formats (raw, secret, point).
 * Provides helpers methods for comparison, serialization and publicKey generation.
 * @class Secp256k1SecretKey
 * @type {Secp256k1SecretKey}
 * @implements {SecretKey}
 */
export class Secp256k1SecretKey implements SecretKey {
  /** @type {KeyBytes} The entropy for the secret key as a byte array */
  #bytes?: KeyBytes;

  /** @type {bigint} The entropy for the secret key as a bigint */
  #seed?: bigint;

  /** @type {string} The secret key as a secretKeyMultibase */
  #multibase: string;

  /**
   * Instantiates an instance of Secp256k1SecretKey.
   * @param {Bytes | bigint} entropy bytes (Uint8Array) or secret (bigint)
   * @throws {SecretKeyError} If entropy is not provided, not a valid 32-byte secret key or not a valid bigint seed
   */
  constructor(entropy: Bytes | bigint) {
    // If entropy not valid bytes or bigint seed, throw an error
    const isBytes = entropy instanceof Uint8Array;
    const isSecret = typeof entropy === 'bigint';
    if(!isBytes && !isSecret) {
      throw new SecretKeyError(
        'Invalid entropy: must be a valid byte array (32) or bigint',
        'CONSTRUCTOR_ERROR'
      );
    }

    // If bytes and length is 32, defensive-copy and derive seed
    if (isBytes && entropy.length === 32) {
      this.#bytes = new Uint8Array(entropy);
      this.#seed = Secp256k1SecretKey.toSecret(this.#bytes);
    }

    // If bigint in valid range [1, n), convert to bytes
    if (isSecret && entropy >= 1n && entropy < secp256k1.Point.Fn.ORDER) {
      this.#bytes = Secp256k1SecretKey.toBytes(entropy);
      this.#seed = entropy;
    }

    if(!this.#bytes || this.#bytes.length !== 32) {
      throw new SecretKeyError(
        'Invalid bytes: must be a valid 32-byte secret key',
        'CONSTRUCTOR_ERROR'
      );
    }

    if(!this.#seed || this.#seed < 1n || this.#seed >= secp256k1.Point.Fn.ORDER) {
      throw new SecretKeyError(
        'Invalid seed: must be valid bigint',
        'CONSTRUCTOR_ERROR'
      );
    }

    // Set the secret key multibase
    this.#multibase = this.encode();
  }

  /**
   * Zeros out secret key material from memory.
   * The instance should not be used after calling this method.
   */
  public destroy(): void {
    if (this.#bytes) this.#bytes.fill(0);
    this.#seed = undefined;
    this.#multibase = '';
  }

  /**
   * Get the secret key entropy as a byte array.
   * @returns {KeyBytes} The secret key bytes as a Uint8Array
   */
  get bytes(): Uint8Array {
    // Return a copy of the secret key bytes
    const bytes = new Uint8Array(this.#bytes!);
    return bytes;
  }

  /**
   * Get the secret key entropy as a bigint.
   * @returns {bigint} The secret key as a bigint
   */
  get seed(): bigint {
    // Memoize the secret and return
    const seed = BigInt(this.#seed!) as bigint;
    return seed;
  }

  /**
   * Returns the raw secret key as a hex string.
   * @returns {HexString} The secret key as a hex string
   */
  get hex(): HexString {
    // Convert the raw secret key bytes to a hex string
    return Buffer.from(this.bytes).toString('hex');
  }


  /**
   * Encode the secret key bytes as a secretKeyMultibase string.
   * @returns {string} The secret key in base58btc multibase format
   */
  get multibase(): string {
    const multibase = this.#multibase;
    return multibase;
  }

  /**
   * Encodes the secret key bytes to BIP340 multibase format.
   * @returns {string} The secret key in BIP340 multibase format.
   */
  public encode(): string {
    const secretKeyBytes = Array.from(this.bytes);
    const mbaseBytes = Array.from(BIP340_SECRET_KEY_MULTIBASE_PREFIX);
    mbaseBytes.push(...secretKeyBytes);
    return 'z' + base58.encode(Uint8Array.from(mbaseBytes));
  }

  /**
   * Checks if this secret key is equal to another.
   * @param {SecretKey} other The other secret key
   * @returns {boolean} True if the private keys are equal, false otherwise
   */
  public equals(other: SecretKey): boolean {
    return equalBytes(this.bytes, other.bytes);
  }

  /**
   * Computes the public key from the secret key bytes.
   * @returns {CompressedSecp256k1PublicKey} The computed public key
   */
  public computePublicKey(): CompressedSecp256k1PublicKey {
    return new CompressedSecp256k1PublicKey(secp256k1.getPublicKey(this.bytes));
  }

  /**
   * Safe JSON representation. Does not expose secret material.
   * Called implicitly by JSON.stringify(). Use exportJSON() for full serialization.
   */
  public toJSON(): { type: string } {
    return { type: 'Secp256k1SecretKey' };
  }

  /**
   * Exports the secret key as a JSON object. Contains sensitive material.
   * @returns {SecretKeyObject} The secret key as a JSON object
   */
  public exportJSON(): SecretKeyObject {
    return {
      bytes : Array.from(this.bytes),
      seed  : this.seed.toString(),
      hex   : this.hex,
    };
  }

  /** @override Prevents secret material from appearing in console.log */
  public toString(): string {
    return '[Secp256k1SecretKey]';
  }

  /** @override Prevents secret material from appearing in Node.js inspect */
  [Symbol.for('nodejs.util.inspect.custom')](): string {
    return '[Secp256k1SecretKey]';
  }

  /**
   * Checks if the secret key is valid.
   * @returns {boolean} True if the secret key is valid, false otherwise
   */
  public isValid(): boolean {
    return secp256k1.utils.isValidSecretKey(this.bytes);
  }

  /**
   * Checks if the public key is a valid secp256k1 point.
   * @returns {boolean} True if the public key is valid, false otherwise
   */
  public hasValidPublicKey(): boolean {
    try {
      this.computePublicKey();
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Produce a signature over arbitrary data using schnorr or ecdsa.
   * @param {MessageBytes} data Data to be signed.
   * @param {CryptoOptions} opts Options for signing.
   * @param {('ecdsa' | 'schnorr')} opts.scheme The signature scheme to use. Default is 'schnorr'.
   * @returns {SignatureBytes} Signature byte array.
   * @throws {SecretKeyError} if no private key is provided.
   */
  public sign(data: Bytes, opts?: CryptoOptions): SignatureBytes {
    // Set default options if not provided
    opts ??= { scheme: 'schnorr' };

    if(opts.scheme === 'ecdsa') {
      return secp256k1.sign(data, this.bytes);
    }

    if(opts.scheme === 'schnorr') {
      return schnorr.sign(data, this.bytes);
    }

    throw new SecretKeyError(`Invalid scheme: ${opts.scheme}.`, 'SIGN_ERROR', opts);
  }

  /**
   * Decodes the multibase string to the 34-byte secret key (2 byte prefix + 32 byte key).
   * @param {string} multibase The multibase string to decode
   * @returns {Bytes} The decoded secret key.
   */
  public static decode(multibase: string): Bytes {
    // Decode the public key multibase string
    const decoded = base58.decode(multibase.slice(1));

    // If the public key bytes are not 35 bytes, throw an error
    if(decoded.length !== 34) {
      throw new SecretKeyError(
        'Invalid argument: must be 34 byte secretKeyMultibase',
        'DECODE_MULTIBASE_ERROR'
      );
    }

    // Grab the prefix bytes
    const prefix = decoded.slice(0, 2);

    // Compute the prefix hash
    const prefixHash = Buffer.from(sha256(prefix)).toString('hex');

    // If the prefix hash does not equal the BIP340 prefix hash, throw an error
    if (prefixHash !== BIP340_SECRET_KEY_MULTIBASE_PREFIX_HASH) {
      throw new SecretKeyError(
        `Invalid prefix: malformed multibase prefix ${prefix}`,
        'DECODE_MULTIBASE_ERROR'
      );
    }

    // Return the decoded key bytes
    return decoded;
  }

  /**
   * Creates a Secp256k1SecretKey object from a JSON object.
   * @param {SecretKeyObject} json The JSON object containing the secret key bytes
   * @returns {Secp256k1SecretKey} A new Secp256k1SecretKey object
   */
  public static fromJSON(json: SecretKeyObject): Secp256k1SecretKey {
    return new Secp256k1SecretKey(new Uint8Array(json.bytes));
  }

  /**
   * Convert a bigint secret to secret key bytes.
   * @param {KeyBytes} bytes The secret key bytes
   * @returns {bigint} The secret key bytes as a bigint secret
   */
  public static toSecret(bytes: KeyBytes): bigint {
    return bytes.reduce((acc, byte) => (acc << 8n) | BigInt(byte), 0n);
  }

  /**
   * Convert a secret key bytes to a bigint secret.
   * @param {bigint} secret The secret key secret.
   * @returns {KeyBytes} The secret key secret as secret key bytes.
   */
  public static toBytes(secret: bigint): KeyBytes {
    // Ensure it’s a valid 32-byte value in [1, n-1] and convert bigint to Uint8Array
    const bytes = Uint8Array.from(
      { length: 32 },
      (_, i) => Number(secret >> BigInt(8 * (31 - i)) & BigInt(0xff))
    );

    // If bytes are not a valid secp256k1 secret key, throw error
    if (!secp256k1.utils.isValidSecretKey(bytes)) {
      throw new SecretKeyError(
        'Invalid secret key: secret out of valid range',
        'SET_PRIVATE_KEY_ERROR'
      );
    }
    return new Uint8Array(bytes);
  }

  /**
   * Creates a new Secp256k1SecretKey object from a bigint secret.
   * @param {bigint} bint The secret bigint
   * @returns {Secp256k1SecretKey} A new Secp256k1SecretKey object
   */
  public static fromBigInt(bint: bigint): Secp256k1SecretKey {
    return new Secp256k1SecretKey(Secp256k1SecretKey.toBytes(bint));
  }

  /**
   * Generates random secret key bytes.
   * @returns {KeyBytes} Uint8Array of 32 random bytes.
   */
  public static random(): KeyBytes {
    let byteArray: Uint8Array;
    // Retry until bytes fall in valid scalar range [1, n)
    do {
      byteArray = randomBytes(32);
    } while (!secp256k1.utils.isValidSecretKey(byteArray));
    return byteArray;
  }

  /**
   * Creates a new Secp256k1SecretKey from random secret key bytes.
   * @returns {Secp256k1SecretKey} A new Secp256k1SecretKey object
   */
  public static generate(): Secp256k1SecretKey {
    // Generate empty 32-byte array
    const randomBytes = this.random();

    // Use the getRandomValues function to fill the byteArray with random values
    return new Secp256k1SecretKey(randomBytes);
  }

  /**
   * Generates a public key from the given secret key bytes.
   * @param {KeyBytes} bytes The secret key bytes
   * @returns {CompressedSecp256k1PublicKey} The computed public key bytes
   */
  public static getPublicKey(bytes: KeyBytes): CompressedSecp256k1PublicKey {
    // Create a new Secp256k1SecretKey from the bytes and compute the public key
    return new Secp256k1SecretKey(bytes).computePublicKey();
  }
}
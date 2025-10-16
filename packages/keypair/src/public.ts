import {
  Hex,
  KeyBytes,
  MultibaseObject,
  PublicKeyError,
  PublicKeyObject
} from '@did-btcr2/common';
import { sha256 } from '@noble/hashes/sha2';
import { base58btc } from 'multiformats/bases/base58';
import * as tinysecp from 'tiny-secp256k1';
import { Secp256k1SecretKey } from './secret.js';

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
   * CompressedSecp256k1PublicKey key equality check. Checks if `this` public key is equal to `other` public key.
   * @param {CompressedSecp256k1PublicKey} other The public key to compare.
   * @returns {boolean} True if the public keys are equal.
   */
  equals(other: CompressedSecp256k1PublicKey): boolean;

  /**
   * JSON representation of a CompressedSecp256k1PublicKey object.
   * @returns {PublicKeyObject} The CompressedSecp256k1PublicKey as a JSON object.
   */
  json(): PublicKeyObject;
}

/**
 * Encapsulates a secp256k1 public key compliant to BIP-340 BIP schnorr signature scheme.
 * Provides get methods for different formats (compressed, x-only, multibase).
 * Provides helpers methods for comparison and serialization.
 * @class CompressedSecp256k1PublicKey
 * @type {CompressedSecp256k1PublicKey}
 */
export class CompressedSecp256k1PublicKey implements PublicKey {
  /** @type {KeyBytes} The public key bytes */
  private readonly _bytes: KeyBytes;

  /** @type {MultibaseObject} The public key as a MultibaseObject */
  private _multibase: MultibaseObject = {
    prefix  : BIP340_PUBLIC_KEY_MULTIBASE_PREFIX,
    key     : [],
    encoded : ''
  };

  /**
   * Creates a CompressedSecp256k1PublicKey instance.
   * @param {KeyBytes} bytes The public key byte array.
   * @throws {PublicKeyError} if the byte length is not 32 (x-only) or 33 (compressed)
   */
  constructor(bytes: KeyBytes) {
    // If the byte length is not 33, throw an error
    if(bytes.length !== 33) {
      throw new PublicKeyError(
        'Invalid argument: byte length must be 33 (compressed)',
        'CONSTRUCTOR_ERROR', { bytes }
      );
    }

    // Validate the point is on curve and in compressed form
    if (!tinysecp.isPoint(bytes)) {
      throw new PublicKeyError(
        'Invalid argument: bytes are not a valid secp256k1 compressed point',
        'CONSTRUCTOR_ERROR', { bytes }
      );
    }
    // Set the bytes
    this._bytes = bytes;

    // Set multibase
    this._multibase.encoded = this.encode();
    this._multibase.key = [...this._multibase.prefix, ...this.compressed];
  }

  /**
   * Get the compressed public key.
   * @returns {KeyBytes} The 33-byte compressed public key (0x02 or 0x03, x).
   */
  get compressed(): KeyBytes {
    const bytes = new Uint8Array(this._bytes);
    return bytes;
  };

  /**
   * Get the uncompressed public key.
   * @returns {Uint8Array} The 65-byte uncompressed public key (0x04, x, y).
   */
  get uncompressed(): KeyBytes {
    const uncompressed = this.liftX();
    return uncompressed;
  }

  /**
   * X-only (32-byte) view of the public key per BIP-340.
   */
  get xOnly(): KeyBytes {
    return this._bytes.slice(1);
  }

  /**
   * Parity of the SEC compressed public key.
   * @returns {0x02 | 0x03} The parity byte (0x02 if even, 0x03 if odd).
   * @throws {PublicKeyError} If the parity byte is not 0x02 or 0x03.
   */
  get parity(): 0x02 | 0x03 {
    const parity = this._bytes[0];
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
    return this._bytes[0] === 0x02;
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
    const multibase = this._multibase;
    return multibase;
  }

  /**
   * Returns the raw public key as a hex string.
   * @returns {Hex} The public key as a hex string.
   */
  get hex(): Hex {
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
  public bip340(): KeyBytes {
    return this.xOnly;
  }

  /**
   * Returns the point of the public key.
   * @param {Hex} pk The public key in hex (Uint8Array or string) format.
   * @returns {Point} The point of the public key.
   * @throws {PublicKeyError} If the public key is not a valid hex string or byte array.
   */
  static point(pk: Hex): Point {
    // If the public key is a hex string, convert it to a CompressedSecp256k1PublicKey object and return the point
    if(typeof pk === 'string' && /^[0-9a-fA-F]+$/.test(pk)) {
      const publicKey = new CompressedSecp256k1PublicKey(Buffer.fromHex(pk));
      return publicKey.point;
    }

    // If the public key is a byte array or ArrayBuffer, convert it to a CompressedSecp256k1PublicKey object and return the point
    if(pk instanceof Uint8Array || ArrayBuffer.isView(pk)) {
      const publicKey = new CompressedSecp256k1PublicKey(pk as KeyBytes);
      return publicKey.point;
    }

    // If the public key is neither a hex string nor a byte array, throw an error
    throw new PublicKeyError(
      'Invalid publicKey: must be a hex string or byte array',
      'POINT_ERROR', { publicKey: pk }
    );
  }

  /**
   * Decodes the multibase string to the 35-byte corresponding public key (2 byte prefix + 32 byte public key).
   * @returns {KeyBytes} The decoded public key: prefix and public key bytes
   */
  public decode(): KeyBytes {
    // Decode the public key multibase string
    const decoded = base58btc.decode(this.multibase.encoded);

    // If the public key bytes are not 35 bytes, throw an error
    if(decoded.length !== 35) {
      throw new PublicKeyError(
        'Invalid argument: must be 35 byte publicKeyMultibase',
        'DECODE_MULTIBASE_ERROR'
      );
    }

    // Grab the prefix bytes
    const prefix = decoded.slice(0, 2);

    // Compute the prefix hash
    const prefixHash = Buffer.from(sha256(prefix)).toString('hex');

    // If the prefix hash does not equal the BIP340 prefix hash, throw an error
    if (prefixHash !== BIP340_PUBLIC_KEY_MULTIBASE_PREFIX_HASH) {
      throw new PublicKeyError(
        `Invalid prefix: malformed multibase prefix ${prefix}`,
        'DECODE_MULTIBASE_ERROR'
      );
    }

    // Return the decoded public key bytes
    return decoded;
  }

  /**
   * Encodes compressed secp256k1 public key from bytes to BIP340 multibase format.
   * @returns {string} The public key encoded in base-58-btc multibase format.
   */
  public encode(): string {
    // Convert public key bytes to an array
    const pk = this.compressed.toArray();

    // Ensure the public key is 33-byte secp256k1 compressed public key
    if (pk.length !== 33) {
      throw new PublicKeyError(
        'Invalid argument: must be 33-byte (compressed) public key',
        'ENCODE_MULTIBASE_ERROR'
      );
    }

    // Convert prefix to an array
    const publicKeyMultibase = BIP340_PUBLIC_KEY_MULTIBASE_PREFIX.toArray();

    // Push the public key bytes at the end of the prefix
    publicKeyMultibase.push(...pk);

    // Encode the bytes in base58btc format and return
    return base58btc.encode(publicKeyMultibase.toUint8Array());
  }

  /**
   * Compares this public key to another public key.
   * @param {CompressedSecp256k1PublicKey} other The other public key to compare
   * @returns {boolean} True if the public keys are equal, false otherwise.
   */
  public equals(other: CompressedSecp256k1PublicKey): boolean {
    return this.hex === other.hex;
  }

  /**
   * JSON representation of a CompressedSecp256k1PublicKey object.
   * @returns {PublicKeyObject} The CompressedSecp256k1PublicKey as a JSON object.
   */
  public json(): PublicKeyObject {
    return {
      hex       : this.hex,
      multibase : this.multibase,
      point     : {
        x      : this.x.toArray(),
        y      : this.y.toArray(),
        parity : this.parity,
      },
    };
  }

  /**
   * Creates a CompressedSecp256k1PublicKey object from a JSON representation.
   * @param {PublicKeyObject} json The JSON object to initialize the CompressedSecp256k1PublicKey.
   * @returns {CompressedSecp256k1PublicKey} The initialized CompressedSecp256k1PublicKey object.
   */
  public static fromJSON(json: PublicKeyObject): CompressedSecp256k1PublicKey {
    json.point.x.unshift(json.point.parity);
    return new CompressedSecp256k1PublicKey(json.point.x.toUint8Array());
  }

  /**
   * Computes the deterministic public key for a given secret key.
   * @param {Secp256k1SecretKey | KeyBytes} sk The Secp256k1SecretKey object or the secret key bytes
   * @returns {CompressedSecp256k1PublicKey} A new CompressedSecp256k1PublicKey object
   */
  public static fromSecretKey(sk: Secp256k1SecretKey | KeyBytes): CompressedSecp256k1PublicKey {
    // If the secret key is a Secp256k1SecretKey object, get the raw bytes else use the bytes
    const bytes = sk instanceof Secp256k1SecretKey ? sk.bytes : sk;

    // Throw error if the secret key is not 32 bytes
    if(bytes.length !== 32) {
      throw new PublicKeyError('Invalid arg: must be 32 byte secret key', 'FROM_SECRET_KEY_ERROR');
    }

    // Compute the public key from the secret key
    const secret = sk instanceof Secp256k1SecretKey
      ? sk
      : new Secp256k1SecretKey(sk);

    // Return a new CompressedSecp256k1PublicKey object
    return secret.computePublicKey();
  }

  /**
   * Computes modular exponentiation: (base^exp) % mod.
   * Used for computing modular square roots.
   * @param {bigint} base The base value
   * @param {bigint} exp The exponent value
   * @param {bigint} mod The modulus value
   * @returns {bigint} The result of the modular exponentiation
   */
  public modPow(base: bigint, exp: bigint, mod: bigint): bigint {
    let result = 1n;
    while (exp > 0n) {
      if (exp & 1n) result = (result * base) % mod;
      base = (base * base) % mod;
      exp >>= 1n;
    }
    return result;
  };

  /**
   * Computes `sqrt(a) mod p` using Tonelli-Shanks algorithm.
   * This finds `y` such that `y^2 ≡ a mod p`.
   * @param {bigint} a The value to find the square root of
   * @param {bigint} p The prime modulus
   * @returns {bigint} The square root of `a` mod `p`
   */
  public sqrtMod(a: bigint, p: bigint): bigint {
    return this.modPow(a, (p + 1n) >> 2n, p);
  };

  /**
   * Lifts a 32-byte x-only coordinate into a full secp256k1 point (x, y).
   * @param xBytes 32-byte x-coordinate
   * @returns {Uint8Array} 65-byte uncompressed public key (starts with `0x04`)
   */
  public liftX(): Uint8Array {
    // Ensure x-coordinate is 32 bytes
    if (this.x.length !== 32) {
      throw new PublicKeyError('Invalid argument: x-coordinate length must be 32 bytes', 'LIFT_X_ERROR');
    }

    // Convert x from Uint8Array → BigInt
    const x = BigInt('0x' + Buffer.from(this.x).toString('hex'));
    if (x <= 0n || x >= CURVE.p) {
      throw new PublicKeyError('Invalid conversion: x out of range as BigInt', 'LIFT_X_ERROR');
    }

    // Compute y² = x³ + 7 mod p
    const ySquared = BigInt((x ** 3n + CURVE.b) % CURVE.p);

    // Compute y (do not enforce parity)
    const y = this.sqrtMod(ySquared, CURVE.p);

    // Convert x and y to Uint8Array
    const yBytes = Buffer.fromHex(y.toString(16).padStart(64, '0'));

    // Return 65-byte uncompressed public key: `0x04 || x || y`
    return new Uint8Array(Buffer.concat([Buffer.from([0x04]), Buffer.from(this.x), yBytes]));
  };
}
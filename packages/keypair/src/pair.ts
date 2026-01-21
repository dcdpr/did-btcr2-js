import {
  Hex,
  HexString,
  KeyBytes,
  KeyPairError,
  SchnorrKeyPairObject
} from '@did-btcr2/common';
import { CompressedSecp256k1PublicKey, PublicKey } from './public.js';
import { Secp256k1SecretKey, SecretKey } from './secret.js';
import { HexSchnorrKeyPair, MultibaseKeys, RawSchnorrKeyPair, SchnorrKeyPairParams } from './types.js';

/**
 * General KeyPair interface used by SchnorrKeyPair class.
 * @interface KeyPair
 * @type {KeyPair}
 */
export interface KeyPair {
  /**
   * @type {PublicKey} The public key associated with the SchnorrKeyPair (required).
   */
  readonly publicKey: PublicKey;

  /**
   * @type {SecretKey} The secret key associated with the SchnorrKeyPair (optional).
   * @throws {KeyPairError} If the secret key is not available.
   */
  readonly secretKey?: SecretKey;
}

/**
 * Encapsulates a CompressedSecp256k1PublicKey and a Secp256k1SecretKey object as a single SchnorrKeyPair object.
 * @class SchnorrKeyPair
 * @type {SchnorrKeyPair}
 */
export class SchnorrKeyPair implements KeyPair {
  /** @type {Secp256k1SecretKey} The secret key object */
  #secretKey?: Secp256k1SecretKey;

  /** @type {CompressedSecp256k1PublicKey} The public key object */;
  #publicKey: CompressedSecp256k1PublicKey;

  /** @type {string} The public key in multibase format */
  #publicKeyMultibase: string;

  /** @type {string} The secret key in multibase format */
  #secretKeyMultibase: string;

  /**
   * Creates an instance of Keys. Must provide a at least a secret key.
   * Can optionally provide both a secret and public key, but must be a valid pair.
   * @param {SchnorrKeyPairParams} params The parameters to initialize the Keys object.
   * @param {CompressedSecp256k1PublicKey | KeyBytes} params.publicKey The public key object or bytes
   * @param {Secp256k1SecretKey | KeyBytes} [params.secret] The secret key object or bytes
   * @throws {KeyPairError} If neither a public key or secret key is provided.
   * @throws {KeyPairError} If the public key is not a valid pair with the secret key.
   */
  constructor(params: SchnorrKeyPairParams = {}) {
    // If no secret key or public key, throw an error
    if (!params.publicKey && !params.secretKey) {
      throw new KeyPairError('Argument missing: must at least provide a publicKey', 'CONSTRUCTOR_ERROR');
    }

    // Set the secretKey
    if(params.secretKey instanceof Uint8Array) {
      this.#secretKey = new Secp256k1SecretKey(params.secretKey);
    } else if (params.secretKey instanceof Secp256k1SecretKey) {
      this.#secretKey = params.secretKey;
    }

    // Set the publicKey
    if(params.publicKey instanceof CompressedSecp256k1PublicKey) {
      this.#publicKey = params.publicKey;
    } else if (params.publicKey instanceof Uint8Array) {
      this.#publicKey = new CompressedSecp256k1PublicKey(params.publicKey);
    } else {
      this.#publicKey = this.#secretKey!.computePublicKey();
    }

    this.#publicKeyMultibase = this.#publicKey.multibase.encoded;
    this.#secretKeyMultibase = this.#secretKey ? this.#secretKey.multibase : '';
  }

  /**
   * Get the Secp256k1SecretKey.
   * @returns {Secp256k1SecretKey} The Secp256k1SecretKey object
   * @throws {KeyPairError} If the secret key is not available
   */
  get secretKey(): Secp256k1SecretKey {
    // If the secret key is not available, throw an error
    if(!this.#secretKey) {
      throw new KeyPairError('Secret key not available', 'SECRET_KEY_ERROR');
    }
    // If the secret key is not valid, throw an error
    if(!this.#secretKey.isValid()) {
      throw new KeyPairError('Secret key is not valid', 'SECRET_KEY_ERROR');
    }
    // Return a copy of the secret key
    const secret = this.#secretKey;
    return secret;
  }

  /**
   * Set the CompressedSecp256k1PublicKey.
   * @param {CompressedSecp256k1PublicKey} publicKey The CompressedSecp256k1PublicKey object
   * @throws {KeyPairError} If the public key is not a valid pair with the secret key.
   */
  set publicKey(publicKey: CompressedSecp256k1PublicKey) {
    // If the public key is not a valid pair with the secret key, throw an error
    if(this.secretKey) {
      if(!this.secretKey.hasValidPublicKey()) {
        throw new KeyPairError('Secret key is not valid', 'SECRET_KEY_ERROR');
      }
      const cPk = this.secretKey.computePublicKey();
      if(!publicKey.equals(cPk))
        throw new KeyPairError('Public key is not a valid pair with the secret key', 'PUBLIC_KEY_ERROR');
    }
    this.#publicKey = publicKey;
    this.#publicKeyMultibase = publicKey.multibase.encoded;
    this.#secretKeyMultibase = this.#secretKey ? this.#secretKey.multibase : '';
  }

  /**
   * Get the CompressedSecp256k1PublicKey.
   * @returns {CompressedSecp256k1PublicKey} The CompressedSecp256k1PublicKey object
   */
  get publicKey(): CompressedSecp256k1PublicKey {
    const publicKey = this.#publicKey;
    return publicKey;
  }

  /**
   * Get the `raw` bytes of each key in the SchnorrKeyPair.
   * @returns {RawSchnorrKeyPair} JSON object with the SchnorrKeyPair raw bytes.
   */
  get raw(): RawSchnorrKeyPair {
    return {
      public : this.publicKey.x,
      secret : this.secretKey ? this.secretKey.bytes : undefined
    };
  }

  /**
   * Get the Keys in hex format.
   * @returns {object} The Keys in hex format
   */
  get hex(): HexSchnorrKeyPair {
    return {
      public : this.publicKey.hex,
      secret : this.#secretKey ? this.secretKey.hex : undefined
    };
  }

  /**
   * Get the Keys in multibase format.
   * @returns {MultibaseKeys} The Secp256k1SecretKey in multibase format
   */
  get multibase(): MultibaseKeys {
    return {
      publicKeyMultibase : this.#publicKeyMultibase,
      secretKeyMultibase : this.#secretKeyMultibase,
    };
  }

  /**
   * JSON representation of a Keys.
   * @returns {SchnorrKeyPairObject} The Keys as a JSON object
   */
  public json(): SchnorrKeyPairObject {
    return {
      secretKey : this.secretKey.json(),
      publicKey : this.publicKey.json()
    };
  }

  /**
   * Static method creates a new Keys from a JSON object.
   * @param {SchnorrKeyPairObject} keys The JSON object to initialize the Keys.
   * @returns {SchnorrKeyPair} The initialized Keys object.
   */
  public static fromJSON(keys: SchnorrKeyPairObject): SchnorrKeyPair {
    return new SchnorrKeyPair({
      secretKey : Secp256k1SecretKey.fromJSON(keys.secretKey),
      publicKey : CompressedSecp256k1PublicKey.fromJSON(keys.publicKey)
    });
  }

  /**
   * Static method creates a new SchnorrKeyPair from a Secp256k1SecretKey object or secret key bytes.
   * @param {Secp256k1SecretKey | KeyBytes} data The secret key bytes
   * @returns {SchnorrKeyPair} A new SchnorrKeyPair object
   */
  public static fromSecret(data: KeyBytes | HexString): SchnorrKeyPair {

    // If the data is Secp256k1SecretKey object, get the raw bytes
    // Else if data is string, convert to byte array
    // Else must be bytes, use them
    const secret = typeof data === 'string'
      ? Buffer.from(data, 'hex')
      : data;

    // Check the lenth
    if(secret.length !== 32) {
      throw new KeyPairError('Invalid arg: must be 32 byte secret key', 'FROM_SECRET_KEY_ERROR');
    }

    // If pk Uint8Array, construct Secp256k1SecretKey object else use the object
    const secretKey = new Secp256k1SecretKey(secret);
    const publicKey = secretKey.computePublicKey();

    // Return a new Keys object
    return new SchnorrKeyPair({ secretKey, publicKey });
  }

  /**
   * Static method creates a new Keys (Secp256k1SecretKey/CompressedSecp256k1PublicKey) from bigint entropy.
   * @param {bigint} entropy The entropy in bigint form
   * @returns {SchnorrKeyPair} A new SchnorrKeyPair object
   */
  public static fromEntropy(entropy: bigint): SchnorrKeyPair {
    const secretKey = Secp256k1SecretKey.fromEntropy(entropy);
    const publicKey = secretKey.computePublicKey();
    return new SchnorrKeyPair({ secretKey, publicKey });
  }

  /**
   * Converts key bytes to a hex string.
   * @param {KeyBytes} keyBytes The key bytes (secret or public).
   * @returns {Hex} The key bytes as a hex string.
   */
  public static toHex(keyBytes: KeyBytes): Hex {
    return Buffer.from(keyBytes).toString('hex');
  }

  /**
   * Compares two Keys objects for equality.
   * @param {SchnorrKeyPair} kp The main keys.
   * @param {SchnorrKeyPair} otherKp The other keys to compare.
   * @returns {boolean} True if the public key and secret key are equal, false otherwise.
   */
  public static equals(kp: SchnorrKeyPair, otherKp: SchnorrKeyPair): boolean {
    // Deconstruct the public keys from the key pairs
    const pk = kp.publicKey;
    const otherPk = otherKp.publicKey;

    // If publicKeys present, use to compare as hex strings.
    if(pk && otherPk) {
      return pk.hex === otherPk.hex;
    }

    // Deconstruct the secret keys from the key pairs
    const sk = kp.secretKey;
    const otherSk = otherKp.secretKey;
    if(sk && otherSk) {
      // Get the public key hex strings for both key pair publicKeys
      return sk.hex === otherSk.hex;
    }

    throw new KeyPairError('Cannot compare invalid key pair(s)', 'KEYPAIR_EQUALS_ERROR');
  }

  /**
   * Static method to generate a new random SchnorrKeyPair instance.
   * @returns {SchnorrKeyPair} A new Secp256k1SecretKey object.
   */
  public static generate(): SchnorrKeyPair {
    // Generate random secret key bytes
    const sk = Secp256k1SecretKey.random();

    // Construct a new Secp256k1SecretKey object
    const secretKey = new Secp256k1SecretKey(sk);

    // Compute the public key from the secret key
    const publicKey = secretKey.computePublicKey();

    // Return a new Keys object
    return new SchnorrKeyPair({ secretKey, publicKey });
  }
}
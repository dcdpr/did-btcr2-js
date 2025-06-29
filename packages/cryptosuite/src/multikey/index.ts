import { Bytes, Hex, MultikeyError, SignatureBytes, VERIFICATION_METHOD_ERROR } from '@did-btcr2/common';
import { CompressedSecp256k1PublicKey, SchnorrKeyPair, Secp256k1SecretKey } from '@did-btcr2/keypair';
import { schnorr, secp256k1 } from '@noble/curves/secp256k1';
import { DidVerificationMethod } from '@web5/dids';
import { randomBytes } from 'crypto';
import { base58btc } from 'multiformats/bases/base58';
import { Cryptosuite } from '../cryptosuite/index.js';
import {
  DidParams,
  FromPublicKey,
  FromPublicKeyMultibaseParams,
  FromSecretKey,
  Multikey,
  MultikeyObject
} from './interface.js';

type CryptoOptions = { scheme: 'ecdsa' | 'schnorr' }
interface MultikeyParams extends DidParams {
  keys?: SchnorrKeyPair;
}
/**
 * SchnorrMultikey is an implementation of {@link https://dcdpr.github.io/data-integrity-schnorr-secp256k1/#multikey | 2.1.1 Multikey}.
 * The publicKeyMultibase value of the verification method MUST be a base-58-btc Multibase encoding of a Multikey encoded secp256k1 public key.
 * The secretKeyMultibase value of the verification method MUST be a Multikey encoding of a secp256k1 secret key.
 * @class SchnorrMultikey
 * @type {SchnorrMultikey}
 */
export class SchnorrMultikey implements Multikey {
  /** @type {string} The verification metod type */
  public static readonly type: string = 'Multikey';

  /** @type {string} The id references which key to use for various operations in the DID Document */
  public readonly id: string;

  /** @type {string} The controller is the DID that controls the keys and information in the DID DOcument */
  public readonly controller: string;

  /** @type {Keys} The private key bytes for the multikey (optional) */
  private readonly _keys: SchnorrKeyPair;

  /**
   * Creates an instance of SchnorrMultikey.
   * @param {MultikeyParams} params The parameters to create the multikey
   * @param {string} params.id The id of the multikey (required)
   * @param {string} params.controller The controller of the multikey (required)
   * @param {Keys} params.keys The Keys of the multikey (optional, required if no publicKey)
   * @param {CompressedSecp256k1PublicKey} params.keys.publicKey The public key of the multikey (optional, required if no privateKey)
   * @param {Secp256k1SecretKey} params.keys.privateKey The private key of the multikey (optional)
   * @throws {MultikeyError} if neither a publicKey nor a privateKey is provided
   */
  constructor({ id, controller, keys }: MultikeyParams) {
    // If no Keys passed, throw an error
    if (!keys) {
      throw new MultikeyError('Argument missing: "keys" required', 'CONSTRUCTOR_ERROR');
    }

    // If the Keys does not have a public key, throw an error
    if(!keys.publicKey) {
      throw new MultikeyError('Argument missing: "keys" must contain a "publicKey"', 'CONSTRUCTOR_ERROR');
    }

    // Set the class variables
    this.id = id;
    this.controller = controller;
    this._keys = keys;
  }

  /** @type {SchnorrKeyPair} @readonly Get the SchnorrKeyPair. */
  get keys(): SchnorrKeyPair {
    // Return a copy of the Keys
    const keys = this._keys;
    return keys;
  }

  /** @type {CompressedSecp256k1PublicKey} @readonly Get the Multikey CompressedSecp256k1PublicKey. */
  get publicKey(): CompressedSecp256k1PublicKey {
    // Create and return a copy of the Keys.publicKey
    const publicKey = this._keys.publicKey;
    return publicKey;
  }

  /** @type {PrivateKey} @readonly Get the Multikey PrivateKey. */
  get secretKey(): Secp256k1SecretKey {
    // Create and return a copy of the Keys.secretKey
    const secretKey = this._keys.secretKey;
    // If there is no private key, throw an error
    if(!this.signer) {
      throw new MultikeyError('Cannot get: no secretKey', 'PRIVATE_KEY_ERROR');
    }
    return secretKey;
  }

  /**
   * Constructs an instance of Cryptosuite from the current Multikey instance.
   * @public
   * @param {('bip340-jcs-2025' | 'bip340-rdfc-2025')} [cryptosuite='bip340-rdfc-2025']
   * @returns {Cryptosuite}
   */
  public toCryptosuite(cryptosuite: 'bip340-jcs-2025' | 'bip340-rdfc-2025' = 'bip340-jcs-2025'): Cryptosuite {
    return new Cryptosuite({ cryptosuite, multikey: this });
  }

  /**
   * Produce a signature over arbitrary data using schnorr or ecdsa.
   * @param {MessageBytes} data Data to be signed.
   * @param {CryptoOptions} opts Options for signing.
   * @param {('ecdsa' | 'schnorr')} opts.scheme The signature scheme to use. Default is 'schnorr'.
   * @returns {SignatureBytes} Signature byte array.
   * @throws {MultikeyError} if no private key is provided.
   */
  public sign(data: Hex, opts?: CryptoOptions): SignatureBytes {
    // Set default options if not provided
    opts ??= { scheme: 'schnorr' };

    // If there is no private key, throw an error
    if (!this.signer) {
      throw new MultikeyError(`Cannot sign ${opts.scheme}: no secretKey`, 'SIGN_ERROR');
    }

    // Sign ecdsa and return
    if(opts.scheme === 'ecdsa') {
      return secp256k1.sign(data, this.secretKey.bytes, { lowS: true }).toCompactRawBytes();
    }

    // Sign schnorr and return
    if(opts.scheme === 'schnorr') {
      return schnorr.sign(data, this.secretKey.bytes, randomBytes(32));
    }

    throw new MultikeyError(`Invalid scheme: ${opts.scheme}.`, 'SIGN_ERROR', opts);
  }

  /**
   * Verify a signature using schnorr or ecdsa.
   * @param {SignatureBytes} signature Signature for verification.
   * @param {string} data Data for verification.
   * @param {CryptoOptions} opts Options for signing.
   * @param {('ecdsa' | 'schnorr')} opts.scheme The signature scheme to use. Default is 'schnorr'.
   * @returns {boolean} If the signature is valid against the public key.
   */
  public verify(signature: Hex, data: Hex, opts?: CryptoOptions): boolean {
    opts ??= { scheme: 'schnorr' };
    // Verify the signature depending on the scheme and return the result
    if(opts.scheme === 'ecdsa') {
      return secp256k1.verify(signature as Bytes, data as Bytes, this.publicKey.compressed); }
    else if(opts.scheme === 'schnorr') {
      return schnorr.verify(signature, data, this.publicKey.x);
    }

    throw new MultikeyError(`Invalid scheme: ${opts.scheme}.`, 'VERIFY_SIGNATURE_ERROR', opts);
  }

  /**
   * Get the full id of the multikey
   * @returns {string} The full id of the multikey
   */
  public fullId(): string {
    // If the id starts with "#", return concat(controller, id); else return id
    return `${this.controller}${this.id}`;
  }

  /**
   * Convert the multikey to a verification method.
   * @returns {DidVerificationMethod} The verification method.
   */
  public toVerificationMethod(): DidVerificationMethod {
    // Construct and return the verification method
    return {
      id                 : this.id,
      type               : SchnorrMultikey.type,
      controller         : this.controller,
      publicKeyMultibase : this.publicKey.multibase.encoded
    };
  }

  /**
   * Convert a verification method to a multikey.
   * @param {DidVerificationMethod} verificationMethod The verification method to convert.
   * @returns {Multikey} Multikey instance.
   * @throws {MultikeyError}
   * if the verification method is missing required fields.
   * if the verification method has an invalid type.
   * if the publicKeyMultibase has an invalid prefix.
   */
  public fromVerificationMethod(verificationMethod: DidVerificationMethod): Multikey {
    // Destructure the verification method
    const { id, controller, publicKeyMultibase, type } = verificationMethod;

    // Check if the required field id is missing
    if (!id) {
      throw new MultikeyError(
        'Missing "id" in verificationMethod',
        VERIFICATION_METHOD_ERROR, { verificationMethod }
      );
    }

    // Check if the required field controller is missing
    if (!controller) {
      throw new MultikeyError(
        'Missing "controller" in verificationMethod',
        VERIFICATION_METHOD_ERROR, { verificationMethod }
      );
    }

    // Check if the required field publicKeyMultibase is missing
    if (!publicKeyMultibase) {
      throw new MultikeyError(
        'Missing "publicKeyMultibase" in verificationMethod',
        VERIFICATION_METHOD_ERROR, { verificationMethod }
      );
    }

    // Check if the type is not Multikey
    if (type !== 'Multikey') {
      throw new MultikeyError(
        'Invalid "type" in verificationMethod',
        VERIFICATION_METHOD_ERROR, { verificationMethod }
      );
    }

    // Decode the public key multibase
    const decoded = this.publicKey.decode();

    // Get the 32 byte public key from the multibase
    const publicKey = decoded.slice(2, decoded.length);

    // Construct a new CompressedSecp256k1PublicKey from the publicKey and a new Keys from the CompressedSecp256k1PublicKey
    const keys = new SchnorrKeyPair({ publicKey: new CompressedSecp256k1PublicKey(publicKey) });

    // Return a new Multikey instance
    return new SchnorrMultikey({ id, controller, keys });
  }

  /** @type {boolean} @readonly Get signing ability of the Multikey (i.e. is there a valid Secp256k1SecretKey). */
  get signer(): boolean {
    return !!this.keys.secretKey;
  }

  /**
   * Convert the multikey to a JSON object.
   * @returns {MultikeyObject} The multikey as a JSON object.
   */
  public json(): MultikeyObject {
    return {
      id                 : this.id,
      controller         : this.controller,
      fullId             : this.fullId(),
      signer             : this.signer,
      keys               : this.keys.json(),
      verificationMethod : this.toVerificationMethod()
    };
  }

  /**
   * Static convenience method to create a new Multikey instance.
   * @param {MultikeyParams} params The parameters to create the multikey
   * @param {string} params.id The id of the multikey (required)
   * @param {string} params.controller The controller of the multikey (required)
   * @param {Keys} params.Keys The Keys of the multikey (optional, required if no publicKey)
   * @param {KeyBytes} params.keys.publicKey The public key of the multikey (optional, required if no privateKey)
   * @param {KeyBytes} params.keys.privateKey The private key of the multikey (optional)
   * @throws {MultikeyError} if neither a publicKey nor a privateKey is provided
   * @returns {SchnorrMultikey} A new Multikey instance
   */
  public static create({ id, controller, keys }: MultikeyParams): SchnorrMultikey {
    return new SchnorrMultikey({ id, controller, keys });
  }

  /**
   * Creates a `Multikey` instance from a private key
   * @param {FromPublicKey} params The parameters to create the multikey
   * @param {string} params.id The id of the multikey
   * @param {string} params.controller The controller of the multikey
   * @param {KeyBytes} params.entropy The private key bytes for the multikey
   * @returns {SchnorrMultikey} The new multikey instance
   */
  public static fromPrivateKey({ id, controller, entropy }: FromSecretKey): SchnorrMultikey {
    // Create a new PrivateKey from the private key bytes
    const secretKey = new Secp256k1SecretKey(entropy);

    // Create a new Keys from the private key
    const keys = new SchnorrKeyPair(secretKey);

    // Return a new Multikey instance
    return new SchnorrMultikey({ id, controller, keys });
  }

  /**
   * Creates a `Multikey` instance from a public key
   * @param {FromPublicKey} params The parameters to create the multikey
   * @param {string} params.id The id of the multikey
   * @param {string} params.controller The controller of the multikey
   * @param {KeyBytes} params.publicKeyBytes The public key bytes for the multikey
   * @returns {Multikey} The new multikey instance
   */
  public static fromPublicKey({ id, controller, publicKeyBytes }: FromPublicKey): Multikey {
    // Create a new CompressedSecp256k1PublicKey from the public key bytes
    const keys = new SchnorrKeyPair({ publicKey: new CompressedSecp256k1PublicKey(publicKeyBytes) });

    // Return a new Multikey instance
    return new SchnorrMultikey({ id, controller, keys });
  }

  /**
   * Creates a `Multikey` instance from a public key multibase.
   * @param {FromPublicKeyMultibaseParams} params See {@link FromPublicKeyMultibaseParams} for details.
   * @param {string} params.id The id of the multikey.
   * @param {string} params.controller The controller of the multikey.
   * @param {string} params.publicKeyMultibase The public key multibase for the multikey.
   * @returns {Multikey} The new multikey instance.
   */
  public static fromPublicKeyMultibase({
    id,
    controller,
    publicKeyMultibase
  }: FromPublicKeyMultibaseParams): SchnorrMultikey {
    // Decode the public key multibase using base58btc
    const publicKeyMultibaseBytes = base58btc.decode(publicKeyMultibase);

    // Check if the publicKeyMultibase is not a valid multikey
    if(publicKeyMultibaseBytes.length !== 35) {
      throw new MultikeyError(
        `Invalid publicKeyMultibase length: ${publicKeyMultibaseBytes.length}`,
        VERIFICATION_METHOD_ERROR, { publicKeyMultibase }
      );
    }

    // Get the 33 byte public key
    const publicKey = publicKeyMultibaseBytes.slice(2);

    // Construct a new Keys from the public key
    const keys = new SchnorrKeyPair(undefined, publicKey);

    // Return a new Multikey instance
    return new SchnorrMultikey({ id, controller, keys });
  }
}
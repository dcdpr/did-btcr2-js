import type { Bytes, SignatureBytes } from '@did-btcr2/common';
import { MultikeyError, VERIFICATION_METHOD_ERROR } from '@did-btcr2/common';
import type { Signer } from '@did-btcr2/keypair';
import { CompressedSecp256k1PublicKey, SchnorrKeyPair, Secp256k1SecretKey } from '@did-btcr2/keypair';
import { schnorr } from '@noble/curves/secp256k1';
import type { DidVerificationMethod } from '@web5/dids';
import { randomBytes } from '@noble/hashes/utils';
import { base58btc } from 'multiformats/bases/base58';
import { BIP340Cryptosuite } from '../cryptosuite/index.js';
import type {
  DidParams,
  FromPublicKey,
  Multikey,
  MultikeyObject
} from './interface.js';

interface MultikeyParams extends DidParams {
  keyPair?: SchnorrKeyPair;
  /**
   * External {@link Signer} used to produce signatures. When set, the multikey
   * delegates {@link SchnorrMultikey.sign} to this signer instead of using the
   * keyPair's secret key. This lets a multikey carry a public-key-only keyPair
   * while still being able to sign: the secret material lives outside the
   * multikey, in a KMS / HSM / hardware wallet.
   */
  externalSigner?: Signer;
}

/**
 * SchnorrMultikey is an implementation of {@link https://dcdpr.github.io/data-integrity-schnorr-secp256k1/#multikey | 2.1.1 Multikey}.
 * The publicKeyMultibase value of the verification method MUST be a base-58-btc Multibase encoding of a Multikey encoded secp256k1 public key.
 * The secretKeyMultibase value of the verification method MUST be a Multikey encoding of a secp256k1 secret key.
 * @implements {Multikey}
 * @class SchnorrMultikey
 * @type {SchnorrMultikey}
 */
export class SchnorrMultikey implements Multikey {
  /**
   * The verification metod type.
   */
  static readonly type: string = 'Multikey';

  /**
   * The id references which key to use for various operations in the DID Document.
   */
  readonly id: string;

  /**
   * The controller is the DID that controls the keys and information in the DID DOcument.
   */
  readonly controller: string;

  /**
   * The schnorr key pair used for the schnorr multikey.
   */
  readonly #keyPair: SchnorrKeyPair;

  /**
   * Optional external signer. When set, {@link SchnorrMultikey.sign} delegates
   * here instead of using {@link #keyPair}'s secret key. Lets the multikey
   * carry only a public key while signing through a KMS / HSM / wallet.
   */
  readonly #externalSigner?: Signer;

  /**
   * Creates an instance of SchnorrMultikey.
   * @param {MultikeyParams} params The parameters to create the multikey
   * @param {string} params.id The id of the multikey (required)
   * @param {string} params.controller The controller of the multikey (required)
   * @param {SchnorrKeyPair} params.keyPair The key pair of the multikey (optional, required if no publicKey)
   * @param {Signer} params.externalSigner Optional external signer (KMS / HSM / wallet)
   * @throws {MultikeyError} if neither a publicKey nor a privateKey is provided
   */
  constructor({ id, controller, keyPair, externalSigner }: MultikeyParams) {
    // If no Keys passed, throw an error
    if (!keyPair) {
      throw new MultikeyError('Argument missing: "keyPair" required', 'CONSTRUCTOR_ERROR');
    }

    // If the Keys does not have a public key, throw an error
    if(!keyPair.publicKey) {
      throw new MultikeyError('Argument missing: "keyPair" must contain a "publicKey"', 'CONSTRUCTOR_ERROR');
    }

    // When both a keyPair and an externalSigner are provided, their compressed
    // public keys must match. Without this check, `sign()` would delegate to
    // the externalSigner while `verify()` reads from `#keyPair.publicKey`,
    // producing signatures that fail verification against the multikey's own
    // declared pubkey. Fail-fast at construction is cheaper than debugging an
    // invalid proof later.
    if(externalSigner) {
      const signerPk = externalSigner.publicKey;
      const keyPairPk = keyPair.publicKey.compressed;
      if(signerPk.length !== keyPairPk.length || !signerPk.every((b, i) => b === keyPairPk[i])) {
        throw new MultikeyError(
          'externalSigner.publicKey does not match keyPair.publicKey.compressed',
          'CONSTRUCTOR_ERROR'
        );
      }
    }

    // Set the class variables
    this.id = id;
    this.controller = controller;
    this.#keyPair = keyPair;
    this.#externalSigner = externalSigner;
  }

  /**
   * @readonly
   * Get the SchnorrKeyPair.
   */
  get keyPair(): SchnorrKeyPair {
    // Return a copy of the Keys
    const keyPair = this.#keyPair;
    return keyPair;
  }

  /**
   * @readonly
   * Get the Multikey CompressedSecp256k1PublicKey
   */
  get publicKey(): CompressedSecp256k1PublicKey {
    // Create and return a copy of the Keys.publicKey
    const publicKey = this.#keyPair.publicKey;
    return publicKey;
  }

  /** @type {PrivateKey} @readonly Get the Multikey PrivateKey. */
  get secretKey(): Secp256k1SecretKey {
    // The `signer` boolean is also true when an external signer is set, which
    // does not imply a local secret key is available. Dispatch on the keyPair's
    // own getter instead and wrap its throw as a MultikeyError.
    try {
      return this.#keyPair.secretKey;
    } catch {
      throw new MultikeyError('Cannot get: no secretKey', 'PRIVATE_KEY_ERROR');
    }
  }

  /**
   * Constructs an instance of Cryptosuite from the current Multikey instance.
   * @returns {BIP340Cryptosuite}
   */
  toCryptosuite(): BIP340Cryptosuite {
    return new BIP340Cryptosuite(this);
  }

  /**
   * Produce a BIP-340 Schnorr signature over the given data. Per the
   * {@link https://dcdpr.github.io/data-integrity-schnorr-secp256k1/#multikey | BIP340 Multikey spec},
   * a SchnorrMultikey produces Schnorr signatures only.
   * @param {Bytes} data Data to be signed.
   * @returns {SignatureBytes} 64-byte BIP-340 Schnorr signature.
   * @throws {MultikeyError} if no signing material is available.
   */
  public sign(data: Bytes): SignatureBytes {
    // External signer (KMS, HSM, wallet) takes precedence over the local keyPair
    if(this.#externalSigner) {
      return this.#externalSigner.sign(data, 'bip340');
    }

    if(!this.signer) {
      throw new MultikeyError('Cannot sign: no secretKey', 'SIGN_ERROR');
    }

    return schnorr.sign(data, this.secretKey.bytes, randomBytes(32));
  }

  /**
   * Verify a BIP-340 Schnorr signature.
   * @param {Bytes} signature 64-byte BIP-340 Schnorr signature.
   * @param {Bytes} data Data the signature was produced over.
   * @returns {boolean} True if the signature is valid for this multikey's public key.
   */
  public verify(signature: Bytes, data: Bytes): boolean {
    return schnorr.verify(signature, data, this.publicKey.x);
  }

  /**
   * Get the full id of the multikey
   * @returns {string} The full id of the multikey
   */
  public fullId(): string {
    // If the id starts with "#", return concat(controller, id); else return id
    return this.id.startsWith('#') ? `${this.controller}${this.id}` : this.id;
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
   * @readonly
   * Get signing ability of the Multikey: true if a local Secp256k1SecretKey
   * is present (note: the SchnorrKeyPair.secretKey getter throws when absent;
   * that throw is the historical error contract - see multikey tests) or if
   * an external signer is available.
   */
  get signer(): boolean {
    return !!this.#externalSigner || !!this.#keyPair.secretKey;
  }

  /**
   * Convert the multikey to a JSON object.
   * @returns {MultikeyObject} The multikey as a JSON object.
   */
  public toJSON(): MultikeyObject {
    return {
      id                 : this.id,
      controller         : this.controller,
      fullId             : this.fullId(),
      signer             : this.signer,
      keyPair            : this.keyPair.exportJSON(),
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
  public static create({ id, controller, keyPair }: MultikeyParams): SchnorrMultikey {
    return new SchnorrMultikey({ id, controller, keyPair });
  }

  /**
   * Creates a `Multikey` instance from a private key.
   * @param id The id of the multikey
   * @param controller The controller of the multikey
   * @param secretKeyb The private key bytes for the multikey
   * @returns The new multikey instance
   */
  public static fromSecretKey(
    id: string,
    controller: string,
    secretKeyb: Bytes
  ): SchnorrMultikey {
    // Create a new SecretKey from the secret key bytes
    const secretKey = new Secp256k1SecretKey(secretKeyb);

    // Compute the public key from the secret key
    const publicKey = secretKey.computePublicKey();

    // Create a new Keys from the secret key
    const keyPair = new SchnorrKeyPair({ publicKey, secretKey });

    // Return a new Multikey instance
    return new SchnorrMultikey({ id, controller, keyPair });
  }

  /**
   * Creates a `Multikey` instance backed by an external {@link Signer}. The
   * signer's public key seeds the multikey's keyPair; signing delegates to the
   * signer rather than to local key material. Use this when secret keys are
   * managed outside the JS process (KMS, HSM, hardware wallet).
   *
   * @param id The id of the multikey.
   * @param controller The controller of the multikey.
   * @param externalSigner The signer that will produce signatures.
   * @returns A new multikey instance.
   */
  public static fromSigner(
    id: string,
    controller: string,
    externalSigner: Signer,
  ): SchnorrMultikey {
    const publicKey = new CompressedSecp256k1PublicKey(externalSigner.publicKey);
    const keyPair = new SchnorrKeyPair({ publicKey });
    return new SchnorrMultikey({ id, controller, keyPair, externalSigner });
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
    // Construct a new CompressedSecp256k1PublicKey from the public key bytes
    const publicKey = new CompressedSecp256k1PublicKey(publicKeyBytes);

    // Construct a new keyPair from the public key bytes
    const keyPair = new SchnorrKeyPair({ publicKey });

    // Return a new Multikey instance
    return new SchnorrMultikey({ id, controller, keyPair });
  }

  /**
   * Creates a `Multikey` instance from a public key multibase.
   * @param {DidVerificationMethod} vm The verification method containing the public key multibase.
   * @param {string} vm.id The id of the multikey.
   * @param {string} vm.controller The controller of the multikey.
   * @param {string} vm.publicKeyMultibase The public key multibase of the multikey.
   * @returns {Multikey} The new multikey instance.
   */
  public static fromVerificationMethod({
    id,
    controller,
    publicKeyMultibase
  }: DidVerificationMethod): SchnorrMultikey {
    if(!publicKeyMultibase) {
      throw new MultikeyError(
        'Invalid publicKeyMultibase: cannot be undefined',
        VERIFICATION_METHOD_ERROR, { publicKeyMultibase }
      );
    }

    // Decode the public key multibase using base58btc
    const publicKeyMultibaseBytes = base58btc.decode(publicKeyMultibase);

    // Check if the publicKeyMultibase is not a valid multikey
    if(publicKeyMultibaseBytes.length !== 35) {
      throw new MultikeyError(
        `Invalid publicKeyMultibase length: ${publicKeyMultibaseBytes.length}`,
        VERIFICATION_METHOD_ERROR, { publicKeyMultibase }
      );
    }

    // The first two bytes are the multicodec prefix for secp256k1 compressed
    // public key (0xe7 varint-encoded as [0xe7, 0x01]). Without this check, a
    // 35-byte multibase carrying a different codec (e.g. ed25519, P-256) would
    // be silently sliced and used as a secp256k1 key, producing nonsense
    // verification results rather than a clear failure.
    if(publicKeyMultibaseBytes[0] !== 0xe7 || publicKeyMultibaseBytes[1] !== 0x01) {
      throw new MultikeyError(
        `Invalid publicKeyMultibase prefix: expected secp256k1 multicodec [0xe7, 0x01], got [0x${
          publicKeyMultibaseBytes[0]?.toString(16) ?? '??'
        }, 0x${publicKeyMultibaseBytes[1]?.toString(16) ?? '??'}]`,
        VERIFICATION_METHOD_ERROR, { publicKeyMultibase }
      );
    }

    // Get the 33 byte public key
    const publicKey = publicKeyMultibaseBytes.slice(2);

    // Construct a new keyPair from the public key
    const keyPair = new SchnorrKeyPair({ publicKey });

    // Return a new Multikey instance
    return new SchnorrMultikey({ id, controller, keyPair });
  }
}
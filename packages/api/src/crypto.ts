import type { Bytes, Entropy, HexString, KeyBytes, SchnorrKeyPairObject, SignatureBytes } from '@did-btcr2/common';
import type {
  BTCR2Update,
  DataIntegrityConfig,
  DataIntegrityProofObject,
  SignedBTCR2Update,
  UnsignedBTCR2Update,
  VerificationResult
} from '@did-btcr2/cryptosuite';
import {
  BIP340Cryptosuite,
  BIP340DataIntegrityProof,
  type FromPublicKey,
  type Multikey,
  SchnorrMultikey
} from '@did-btcr2/cryptosuite';
import { CompressedSecp256k1PublicKey, SchnorrKeyPair, Secp256k1SecretKey } from '@did-btcr2/keypair';
import type { KeyIdentifier } from '@did-btcr2/kms';
import type { DidVerificationMethod } from '@web5/dids';
import type { KeyManagerApi } from './kms.js';

/**
 * Schnorr keypair operations.
 * @public
 */
export class KeyPairApi {
  /**
   * Generate a new Schnorr keypair.
   * @returns The generated Schnorr keypair.
   */
  generate(): SchnorrKeyPair {
    return SchnorrKeyPair.generate();
  }

  /**
   * Create a Schnorr keypair from secret key bytes or hex string.
   * @param data The secret key bytes or hex string.
   * @returns The created Schnorr keypair.
   */
  fromSecret(data: KeyBytes | HexString): SchnorrKeyPair {
    return SchnorrKeyPair.fromSecret(data);
  }

  /** Create a secret key from entropy (bytes or bigint). */
  secretKeyFrom(ent: Entropy): Secp256k1SecretKey {
    return new Secp256k1SecretKey(ent);
  }

  /** Create a compressed public key from bytes. */
  publicKeyFrom(byt: Bytes): CompressedSecp256k1PublicKey {
    return new CompressedSecp256k1PublicKey(byt);
  }

  /** Deserialize a keypair from a JSON object. */
  fromJSON(obj: SchnorrKeyPairObject): SchnorrKeyPair {
    return SchnorrKeyPair.fromJSON(obj);
  }

  /** Serialize a keypair to a JSON object. */
  toJSON(kp: SchnorrKeyPair): SchnorrKeyPairObject {
    return kp.exportJSON();
  }

  /** Compare two keypairs for equality. */
  equals(kp1: SchnorrKeyPair, kp2: SchnorrKeyPair): boolean {
    return SchnorrKeyPair.equals(kp1, kp2);
  }
}

/**
 * Schnorr cryptosuite operations.
 *
 * Optionally stateful: call {@link use} to set a current cryptosuite, then
 * call {@link createProof}, {@link verifyProof}, or {@link toDataIntegrityProof}
 * without passing an explicit instance. Pass an explicit instance to any
 * method to override the current one for that call.
 * @public
 */
export class CryptosuiteApi {
  #current?: BIP340Cryptosuite;

  /** The currently active cryptosuite, or `undefined` if none is set. */
  get current(): BIP340Cryptosuite | undefined {
    return this.#current;
  }

  /**
   * Set the current cryptosuite for subsequent operations.
   * @param cs The cryptosuite to activate.
   * @returns `this` for chaining.
   */
  use(cs: BIP340Cryptosuite): this {
    this.#current = cs;
    return this;
  }

  /** Clear the current cryptosuite. */
  clear(): void {
    this.#current = undefined;
  }

  /**
   * Create a new Schnorr cryptosuite from a multikey.
   * @param multikey The Schnorr multikey to use.
   * @returns The created Schnorr cryptosuite.
   */
  create(multikey: SchnorrMultikey): BIP340Cryptosuite {
    return new BIP340Cryptosuite(multikey);
  }

  /**
   * Convenience: resolve a key from the KMS and create a cryptosuite in one step.
   * @param id The multikey ID (e.g. '#initialKey').
   * @param controller The DID that controls this key.
   * @param keyId The KMS key identifier to resolve.
   * @param kms The KeyManagerApi instance holding the key.
   * @returns The created Schnorr cryptosuite.
   */
  createFromKms(
    id: string,
    controller: string,
    keyId: KeyIdentifier,
    kms: KeyManagerApi
  ): BIP340Cryptosuite {
    const pubBytes = kms.getPublicKey(keyId);
    const mk = SchnorrMultikey.fromPublicKey({ id, controller, publicKeyBytes: pubBytes });
    return new BIP340Cryptosuite(mk as SchnorrMultikey);
  }

  /**
   * Convert a cryptosuite to a Data Integrity Proof instance.
   * Uses the current cryptosuite when `cryptosuite` is omitted.
   * @param cryptosuite Optional explicit cryptosuite to convert.
   * @returns The Data Integrity Proof instance.
   */
  toDataIntegrityProof(cryptosuite?: BIP340Cryptosuite): BIP340DataIntegrityProof {
    const cs = cryptosuite ?? this.#requireCurrent();
    return cs.toDataIntegrityProof();
  }

  /**
   * Create a proof for a document.
   * Uses the current cryptosuite when `cryptosuite` is omitted.
   * @param document The document to create the proof for.
   * @param config Configuration for the proof creation.
   * @param cryptosuite Optional explicit cryptosuite; defaults to current.
   * @returns The created proof.
   */
  createProof(
    document: BTCR2Update,
    config: DataIntegrityConfig,
    cryptosuite?: BIP340Cryptosuite
  ): DataIntegrityProofObject {
    const cs = cryptosuite ?? this.#requireCurrent();
    return cs.createProof(document, config);
  }

  /**
   * Verify a proof for a document.
   * Uses the current cryptosuite when `cryptosuite` is omitted.
   * @param document The document to verify the proof for.
   * @param cryptosuite Optional explicit cryptosuite; defaults to current.
   * @returns The full verification result.
   */
  verifyProof(document: SignedBTCR2Update, cryptosuite?: BIP340Cryptosuite): VerificationResult {
    const cs = cryptosuite ?? this.#requireCurrent();
    return cs.verifyProof(document);
  }

  #requireCurrent(): BIP340Cryptosuite {
    if (!this.#current) {
      throw new Error(
        'No current cryptosuite set. Call cryptosuite.use(cs) first, or pass an explicit instance.'
      );
    }
    return this.#current;
  }
}

/**
 * Data Integrity Proof operations.
 *
 * Optionally stateful: call {@link use} to set a current proof instance, then
 * call {@link addProof} or {@link verifyProof} without passing an explicit
 * instance. Pass an explicit instance to override for that call.
 * @public
 */
export class DataIntegrityProofApi {
  #current?: BIP340DataIntegrityProof;

  /** The currently active proof instance, or `undefined` if none is set. */
  get current(): BIP340DataIntegrityProof | undefined {
    return this.#current;
  }

  /**
   * Set the current proof instance for subsequent operations.
   * @param p The proof instance to activate.
   * @returns `this` for chaining.
   */
  use(p: BIP340DataIntegrityProof): this {
    this.#current = p;
    return this;
  }

  /** Clear the current proof instance. */
  clear(): void {
    this.#current = undefined;
  }

  /**
   * Create a BIP340DataIntegrityProof instance with the given cryptosuite.
   * @param cryptosuite The cryptosuite to use for proof operations.
   * @returns The created BIP340DataIntegrityProof instance.
   */
  create(cryptosuite: BIP340Cryptosuite): BIP340DataIntegrityProof {
    return new BIP340DataIntegrityProof(cryptosuite);
  }

  /**
   * Add a proof to a document.
   * Uses the current proof instance when `proof` is omitted.
   * @param document The document to add the proof to.
   * @param config Configuration for adding the proof.
   * @param proof Optional explicit proof instance; defaults to current.
   * @returns A document with a proof added.
   */
  addProof(
    document: UnsignedBTCR2Update,
    config: DataIntegrityConfig,
    proof?: BIP340DataIntegrityProof
  ): SignedBTCR2Update {
    const p = proof ?? this.#requireCurrent();
    return p.addProof(document, config);
  }

  /**
   * Convenience: create a cryptosuite, proof instance, and sign a document
   * in one call. Requires a multikey with signing capability.
   * @param multikey The Schnorr multikey (must include secret key).
   * @param document The unsigned document to sign.
   * @param config The Data Integrity proof configuration.
   * @returns The signed document with proof attached.
   */
  signDocument(
    multikey: SchnorrMultikey,
    document: UnsignedBTCR2Update,
    config: DataIntegrityConfig
  ): SignedBTCR2Update {
    const cs = new BIP340Cryptosuite(multikey);
    const proofInst = new BIP340DataIntegrityProof(cs);
    return proofInst.addProof(document, config);
  }

  /**
   * Verify a proof using a BIP340DataIntegrityProof instance.
   * Uses the current proof instance when `proof` is omitted.
   * @param document The document to verify the proof for.
   * @param expectedPurpose The expected proof purpose.
   * @param mediaType The media type of the document.
   * @param expectedDomain The expected domain for the proof.
   * @param expectedChallenge The expected challenge for the proof.
   * @param proof Optional explicit proof instance; defaults to current.
   * @returns The result of verifying the proof.
   */
  verifyProof(
    document: string,
    expectedPurpose: string,
    mediaType?: string,
    expectedDomain?: string,
    expectedChallenge?: string,
    proof?: BIP340DataIntegrityProof,
  ): VerificationResult {
    const p = proof ?? this.#requireCurrent();
    return p.verifyProof(
      document,
      expectedPurpose,
      mediaType,
      expectedDomain,
      expectedChallenge
    );
  }

  #requireCurrent(): BIP340DataIntegrityProof {
    if (!this.#current) {
      throw new Error(
        'No current proof instance set. Call proof.use(p) first, or pass an explicit instance.'
      );
    }
    return this.#current;
  }
}

/**
 * Schnorr multikey operations.
 *
 * Optionally stateful: call {@link use} to set a current multikey, then
 * call {@link sign}, {@link verify}, or {@link toVerificationMethod} without
 * passing an explicit instance. Pass an explicit instance to any method to
 * override the current one for that call.
 * @public
 */
export class MultikeyApi {
  #current?: SchnorrMultikey;

  /** The currently active multikey, or `undefined` if none is set. */
  get current(): SchnorrMultikey | undefined {
    return this.#current;
  }

  /**
   * Set the current multikey for subsequent operations.
   * @param mk The multikey to activate.
   * @returns `this` for chaining.
   */
  use(mk: SchnorrMultikey): this {
    this.#current = mk;
    return this;
  }

  /** Clear the current multikey. */
  clear(): void {
    this.#current = undefined;
  }

  /**
   * Create a new Schnorr multikey from a keypair.
   * @param id The multikey ID.
   * @param controller The multikey controller.
   * @param keyPair The Schnorr keypair to use.
   * @returns The created Schnorr multikey.
   */
  create(id: string, controller: string, keyPair: SchnorrKeyPair): SchnorrMultikey {
    return new SchnorrMultikey({ id, controller, keyPair });
  }

  /**
   * Create a Schnorr multikey from raw secret key bytes.
   * @param id The multikey ID.
   * @param controller The multikey controller.
   * @param secretKeyBytes The secret key bytes.
   * @returns The created Schnorr multikey.
   */
  fromSecretKey(id: string, controller: string, secretKeyBytes: Bytes): SchnorrMultikey {
    return SchnorrMultikey.fromSecretKey(id, controller, secretKeyBytes);
  }

  /**
   * Create a verification-only multikey from public key bytes.
   * @param params The id, controller, and publicKeyBytes.
   * @returns The created Multikey.
   */
  fromPublicKey(params: FromPublicKey): Multikey {
    return SchnorrMultikey.fromPublicKey(params);
  }

  /**
   * Convenience: resolve a key from the KMS and create a multikey in one step.
   * @param id The multikey ID.
   * @param controller The multikey controller DID.
   * @param keyId The KMS key identifier to resolve.
   * @param kms The KeyManagerApi instance holding the key.
   * @returns The created Multikey (verification-only; public key from KMS).
   */
  fromKms(id: string, controller: string, keyId: KeyIdentifier, kms: KeyManagerApi): Multikey {
    const pubBytes = kms.getPublicKey(keyId);
    return SchnorrMultikey.fromPublicKey({ id, controller, publicKeyBytes: pubBytes });
  }

  /**
   * Reconstruct a multikey from a DID document's verification method.
   * @param verificationMethod The verification method to convert.
   * @returns The reconstructed multikey.
   */
  fromVerificationMethod(verificationMethod: DidVerificationMethod): SchnorrMultikey {
    return SchnorrMultikey.fromVerificationMethod(verificationMethod);
  }

  /**
   * Produce a DID Verification Method JSON from a multikey.
   * Uses the current multikey when `mk` is omitted.
   * @param mk Optional explicit multikey; defaults to current.
   */
  toVerificationMethod(mk?: SchnorrMultikey): DidVerificationMethod {
    const m = mk ?? this.#requireCurrent();
    return m.toVerificationMethod();
  }

  /**
   * Sign bytes via the multikey (requires secret).
   * Uses the current multikey when `mk` is omitted.
   * @param data The data to sign.
   * @param mk Optional explicit multikey; defaults to current.
   */
  sign(data: Bytes, mk?: SchnorrMultikey): SignatureBytes {
    const m = mk ?? this.#requireCurrent();
    return m.sign(data);
  }

  /**
   * Verify signature via multikey.
   * Uses the current multikey when `mk` is omitted.
   * @param data The data that was signed.
   * @param signature The signature to verify.
   * @param mk Optional explicit multikey; defaults to current.
   */
  verify(data: Bytes, signature: SignatureBytes, mk?: SchnorrMultikey): boolean {
    const m = mk ?? this.#requireCurrent();
    return m.verify(signature, data);
  }

  #requireCurrent(): SchnorrMultikey {
    if (!this.#current) {
      throw new Error(
        'No current multikey set. Call multikey.use(mk) first, or pass an explicit instance.'
      );
    }
    return this.#current;
  }
}

/**
 * Aggregated cryptographic operations sub-facade.
 *
 * Provides direct access to the four sub-facades ({@link keypair},
 * {@link multikey}, {@link cryptosuite}, {@link proof}) plus top-level
 * convenience methods that orchestrate the full signing/verification
 * pipeline using their stateful defaults.
 *
 * @example Stateful pipeline
 * ```ts
 * const api = createApi();
 * const kp  = api.crypto.keypair.generate();
 * const mk  = api.crypto.multikey.create('#key-1', 'did:btcr2:test', kp);
 *
 * // Set the active multikey — flows through to cryptosuite and proof
 * api.crypto.activate(mk);
 *
 * // Now sign without threading instances
 * const signed = api.crypto.signDocument(unsignedDoc, proofConfig);
 * ```
 * @public
 */
export class CryptoApi {
  /** Schnorr keypair operations. */
  readonly keypair = new KeyPairApi();

  /** Schnorr Multikey operations (optionally stateful). */
  readonly multikey = new MultikeyApi();

  /** Schnorr Cryptosuite operations (optionally stateful). */
  readonly cryptosuite = new CryptosuiteApi();

  /** Data Integrity Proof operations (optionally stateful). */
  readonly proof = new DataIntegrityProofApi();

  /**
   * Activate a multikey and propagate through the full pipeline.
   * Sets the current multikey, creates a cryptosuite from it, and creates
   * a proof instance from the cryptosuite — all three sub-facades become
   * ready for stateful operations.
   * @param mk The multikey to activate (must include a secret key for signing).
   * @returns `this` for chaining.
   */
  activate(mk: SchnorrMultikey): this {
    this.multikey.use(mk);
    const cs = this.cryptosuite.create(mk);
    this.cryptosuite.use(cs);
    const p = this.proof.create(cs);
    this.proof.use(p);
    return this;
  }

  /**
   * Clear stateful defaults from all sub-facades.
   */
  deactivate(): void {
    this.multikey.clear();
    this.cryptosuite.clear();
    this.proof.clear();
  }

  /**
   * Sign data using the current multikey.
   * Shorthand for `crypto.multikey.sign(data)`.
   * @param data The data to sign.
   * @returns The signature bytes.
   */
  sign(data: Bytes): SignatureBytes {
    return this.multikey.sign(data);
  }

  /**
   * Verify a signature using the current multikey.
   * Shorthand for `crypto.multikey.verify(data, signature)`.
   * @param data The data that was signed.
   * @param signature The signature to verify.
   * @returns `true` if the signature is valid.
   */
  verify(data: Bytes, signature: SignatureBytes): boolean {
    return this.multikey.verify(data, signature);
  }

  /**
   * Sign a BTCR2 update document using the current proof instance.
   * Shorthand for `crypto.proof.addProof(document, config)`.
   *
   * Requires {@link activate} to have been called first, or the three
   * sub-facades to have been configured individually.
   * @param document The unsigned BTCR2 update document.
   * @param config The Data Integrity proof configuration.
   * @returns The signed document with proof attached.
   */
  signDocument(document: UnsignedBTCR2Update, config: DataIntegrityConfig): SignedBTCR2Update {
    return this.proof.addProof(document, config);
  }

  /**
   * Verify a signed BTCR2 update document using the current cryptosuite.
   * Shorthand for `crypto.cryptosuite.verifyProof(document)`.
   * @param document The signed document to verify.
   * @returns The full verification result.
   */
  verifyDocument(document: SignedBTCR2Update): VerificationResult {
    return this.cryptosuite.verifyProof(document);
  }
}

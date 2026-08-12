import type {
  CanonicalizedProofConfig,
  HashBytes,
  SignatureBytes
} from '@did-btcr2/common';
import {
  canonicalize,
  CryptosuiteError,
  DateUtils,
  JSONUtils,
  MethodError,
  PROOF_GENERATION_ERROR,
  PROOF_SERIALIZATION_ERROR,
  PROOF_VERIFICATION_ERROR
} from '@did-btcr2/common';
import { sha256 } from '@noble/hashes/sha2';
import { concatBytes, utf8ToBytes } from '@noble/hashes/utils';
import { base58btc } from 'multiformats/bases/base58';
import { BIP340DataIntegrityProof } from '../data-integrity-proof/index.js';
import type { DataIntegrityProofObject, DataIntegrityProofOptions, SecuredDocument, UnsecuredDocument } from '../data-integrity-proof/interface.js';
import type { SchnorrMultikey } from '../multikey/index.js';
import type { Cryptosuite, ProofVerificationOptions, VerificationResult } from './interface.js';
import { MAX_PROOF_CLOCK_SKEW_MS } from './interface.js';

/**
 * An implementation of a {@link Cryptosuite} using BIP340 Schnorr signatures and JCS canonicalization.
 * @implements {Cryptosuite}
 * @class BIP340Cryptosuite
 * @type {BIP340Cryptosuite}
 */
export class BIP340Cryptosuite implements Cryptosuite {
  /**
   * The type of the proof
   * @type {'DataIntegrityProof'} The type of proof produced by the Cryptosuite
   */
  type: 'DataIntegrityProof' = 'DataIntegrityProof';

  /**
   * The name of the cryptosuite
   * @type {string} The name of the cryptosuite
   */
  cryptosuite: 'bip340-jcs-2025' = 'bip340-jcs-2025';

  /**
   * The multikey used to sign and verify proofs
   * @type {SchnorrMultikey} The multikey used to sign and verify proofs
   */
  multikey: SchnorrMultikey;

  /**
   * Constructs an instance of Cryptosuite.
   * @param {SchnorrMultikey} multikey The SchnorrMultikey to use for signing and verifying proofs.
   */
  constructor(multikey: SchnorrMultikey) {
    this.multikey = multikey;
  }

  /**
   * Constructs an instance of BIP340DataIntegrityProof from the current Cryptosuite instance.
   * @returns {BIP340DataIntegrityProof} A new BIP340DataIntegrityProof instance.
   */
  toDataIntegrityProof(): BIP340DataIntegrityProof {
    return new BIP340DataIntegrityProof(this);
  }

  /**
   * Create a proof for an insecure document.
   * @param {DidUpdatePayload} document The document to create a proof for.
   * @param {DataIntegrityProofOptions} config The options to use when creating the proof.
   * @returns {DataIntegrityProofObject} The proof for the document.
   */
  createProof(
    document: UnsecuredDocument,
    config: DataIntegrityProofOptions
  ): DataIntegrityProofObject {
    // Build the proof as a fresh deep copy: the caller's config is neither
    // mutated nor aliased into the returned proof (nested values such as a
    // domain array are cloned too), so post-hoc mutation of the caller's
    // config cannot alter the secured document (and vice versa).
    const clonedConfig = JSONUtils.clone(config);
    const proof: DataIntegrityProofObject = {
      ...clonedConfig,
      // Set the context using the document context or the existing config context
      '@context' : JSONUtils.clone((document['@context'] as string | string[] | undefined) ?? clonedConfig['@context']),
    } as DataIntegrityProofObject;

    // Create a canonical form of the proof configuration
    const canonicalConfig = this.proofConfiguration(proof);

    // Transform the document into a canonical form
    const canonicalDocument = this.transformDocument(document, proof);

    // Generate a hash of the canonical proof configuration and canonical document
    const hash = this.generateHash(canonicalConfig, canonicalDocument);

    // Serialize the proof
    const serialized = this.proofSerialization(hash, proof);

    // Encode the proof bytes to base58btc
    proof.proofValue = base58btc.encode(serialized);

    // Set the proof cryptosuite
    proof.cryptosuite = this.cryptosuite;

    // Set the proof type
    proof.type = this.type;

    // Return the proof
    return proof;
  }

  /**
   * Verify a proof for a secure document. Temporal checks run here, at the
   * shared verification chokepoint, so every caller (Data Integrity wrapper,
   * resolver replay, aggregation intake, api facade) enforces them:
   * `proof.expires` must be a valid XMLSchema DateTime strictly after the
   * reference time, and `proof.created` must be a valid XMLSchema DateTime no
   * more than {@link MAX_PROOF_CLOCK_SKEW_MS} ahead of the reference time.
   * @param {SecuredDocument} secureDocument The secured document to verify.
   * @param {ProofVerificationOptions} [options] Optional verification options.
   *   `referenceTime` defaults to the wall clock; pass an anchoring block time
   *   when replaying anchored history.
   * @returns {VerificationResult} The result of the verification.
   * @throws {CryptosuiteError} if the proof is expired, has a malformed
   *   expires/created, or was created too far in the future of the reference time.
   */
  verifyProof(secureDocument: SecuredDocument, options?: ProofVerificationOptions): VerificationResult {
    // Destructure the proof from the secure document and create an unsecured document without the proof
    const { proof, ...unsecureDocument } = secureDocument;

    // The reference time defaults to the wall clock; historical replays pass
    // the anchoring block time so proofs expired only after their anchor verify.
    const referenceTime = options?.referenceTime ?? new Date();

    // Check if the proof carries an expiry
    if(proof.expires) {
      // Validate the format
      if(!DateUtils.isValidXsdDateTime(proof.expires)) {
        throw new CryptosuiteError(
          'Invalid proof: "expires" must be a valid XMLSchema DateTime string',
          PROOF_VERIFICATION_ERROR, { proof }
        );
      }
      // A proof must not verify at or past its expiry, relative to the reference time
      if(DateUtils.dateStringToTimestamp(proof.expires).getTime() <= referenceTime.getTime()) {
        throw new CryptosuiteError(
          'Proof expired: reference time is at or past proof.expires',
          PROOF_VERIFICATION_ERROR, { proof }
        );
      }
    }

    // Check if the proof carries a creation timestamp
    if(proof.created) {
      // Validate the format
      if(!DateUtils.isValidXsdDateTime(proof.created)) {
        throw new CryptosuiteError(
          'Invalid proof: "created" must be a valid XMLSchema DateTime string',
          PROOF_VERIFICATION_ERROR, { proof }
        );
      }
      // A proof created too far ahead of the reference time is rejected; the
      // tolerance covers ordinary clock skew between signer and verifier.
      if(DateUtils.dateStringToTimestamp(proof.created).getTime() > referenceTime.getTime() + MAX_PROOF_CLOCK_SKEW_MS) {
        throw new CryptosuiteError(
          'Invalid proof: "created" is too far in the future of the reference time',
          PROOF_VERIFICATION_ERROR, { proof }
        );
      }
    }

    // Destructure the proofValue from the proof and create a config without the proofValue
    const { proofValue, ...config } = proof;

    // Transform the newly unsecured document to canonical form
    const canonicalDocument = this.transformDocument(unsecureDocument, config);

    // Canonicalize the proof options to create a proof configuration
    const canonicalConfig = this.proofConfiguration(config);

    // Generate a hash of the canonical insecured document and the canonical proof configuration
    const hash = this.generateHash(canonicalConfig, canonicalDocument);

    // Decode the secure document proofValue from base58btc to bytes
    const signature = base58btc.decode(secureDocument.proof.proofValue);

    // Verify the hashed data against the proof bytes
    const verified = this.proofVerification(hash, signature, config);

    // Return the verification resul
    return { verified, verifiedDocument: verified ? secureDocument : undefined };
  }

  /**
   * Transform a document into canonical form.
   * @param {UnsecuredDocument} document The document to transform.
   * @param {DataIntegrityProofOptions} config The config to use when transforming the document.
   * @returns {string} The canonicalized document.
   * @throws {MethodError} if the document cannot be transformed.
   */
  transformDocument(document: UnsecuredDocument, config: DataIntegrityProofOptions): string {
    // Get the type from the options and check if it matches this type
    if (config.type !== this.type) {
      throw new MethodError(
        'Type mismatch: config.type !== this.type',
        PROOF_VERIFICATION_ERROR, {config, this: this}
      );
    }

    // Get the cryptosuite from the options and if it matches this cryptosuite
    if (config.cryptosuite !== this.cryptosuite) {
      throw new MethodError(
        'Cryptosuite mismatch: config.cryptosuite !== this.cryptosuite',
        PROOF_VERIFICATION_ERROR, {config, this: this}
      );
    }

    // Return the canonicalized document
    return canonicalize(document);
  }

  /**
   * Generate a hash of the canonical proof configuration and document.
   * @param {string} config The canonicalized proof configuration.
   * @param {string} document The canonicalized document.
   * @returns {HashBytes} The hash bytes of the proof configuration and document.
   */
  generateHash(config: string, document: string): HashBytes {
    // Convert the canonical proof config to bytes and sha256 hash it
    const configHash = sha256(utf8ToBytes(config));

    // Convert the canonical document to bytes and sha256 hash it
    const documentHash = sha256(utf8ToBytes(document));

    // Concatenate the hashes
    const combinedHash = concatBytes(configHash, documentHash);

    // sha256 hash the combined hashes and return
    return sha256(combinedHash);
  }

  /**
   * Configure the proof by canonicalzing it.
   * @param {DataIntegrityProofOptions} config The config to use when transforming the proof.
   * @returns {string} The canonicalized proof configuration.
   * @throws {CryptosuiteError} if the proof configuration cannot be canonicalized.
   */
  proofConfiguration(config: DataIntegrityProofOptions): CanonicalizedProofConfig {
    // If the config type does not match the cryptosuite type, throw CryptosuiteError
    if (config.type !== this.type) {
      throw new CryptosuiteError(
        'Type mismatch: config.type !== this.type',
        PROOF_GENERATION_ERROR, {config, this: this}
      );
    }

    // If the cryptosuite does not match the cryptosuite name, throw CryptosuiteError
    if (config.cryptosuite !== this.cryptosuite) {
      throw new CryptosuiteError(
        'Cryptosuite mismatch: config.cryptosuite !== this.cryptosuite',
        PROOF_GENERATION_ERROR, {config, this: this},
      );
    }

    // Check if config.created is defined
    if(config.created) {
      // Check if config.created is a valid XMLSchema DateTime string, if not throw CryptosuiteError
      if(!DateUtils.isValidXsdDateTime(config.created))
        throw new CryptosuiteError(
          'Invalid config: "created" must be a valid XMLSchema DateTime string',
          PROOF_GENERATION_ERROR, config
        );
    }

    // Check if config.expires is defined
    if(config.expires) {
      // Check if config.expires is a valid XMLSchema DateTime string, if not throw CryptosuiteError
      if(!DateUtils.isValidXsdDateTime(config.expires))
        throw new CryptosuiteError(
          'Invalid config: "expires" must be a valid XMLSchema DateTime string',
          PROOF_GENERATION_ERROR, config
        );
    }

    return canonicalize(config);
  }

  /**
   * Serialize the proof into a byte array.
   * @param {HashBytes} hash The canonicalized proof configuration.
   * @param {DataIntegrityProofOptions} config The config to use when serializing the proof.
   * @returns {SignatureBytes} The serialized proof.
   * @throws {CryptosuiteError} if the multikey does not match the verification method.
   */
  proofSerialization(hash: HashBytes, config: DataIntegrityProofOptions): SignatureBytes {
    // Check if the verification method from the config does not match the multikey fullId
    if (config.verificationMethod !== this.multikey.fullId()) {
      // Throw CryptosuiteError
      throw new CryptosuiteError(
        'Id mismatch: config.verificationMethod !== this.multikey.fullId()',
        PROOF_SERIALIZATION_ERROR, {config, this: this}
      );
    }

    // Return the signed hash
    return this.multikey.sign(hash);
  }

  /**
   * Verify the proof by comparing the hash of the proof configuration and document to the proof bytes.
   * @param {HashBytes} hash The canonicalized proof configuration and document hash.
   * @param {SignatureBytes} signature The proof bytes to verify against.
   * @param {DataIntegrityProofOptions} config The config to use when verifying the proof.
   * @returns {boolean} True if the proof is verified, false otherwise.
   * @throws {CryptosuiteError} if the multikey does not match the verification method.
   */
  proofVerification(
    hash: HashBytes,
    signature: SignatureBytes,
    config: DataIntegrityProofOptions
  ): boolean {
    // If the config verification method !== the multikey fullId, throw CryptosuiteError
    if (config.verificationMethod !== this.multikey.fullId()) {
      throw new CryptosuiteError(
        `Id mismatch: config.verificationMethod !== this.multikey.fullId()`,
        PROOF_VERIFICATION_ERROR, {config, this: this}
      );
    }

    // Return the verified hashData and signedProof
    return this.multikey.verify(signature, hash);
  }
}
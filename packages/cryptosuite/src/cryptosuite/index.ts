import {
  Canonicalization,
  CanonicalizedProofConfig,
  CryptosuiteError,
  DateUtils,
  HashBytes,
  MethodError,
  PROOF_GENERATION_ERROR,
  PROOF_SERIALIZATION_ERROR,
  PROOF_VERIFICATION_ERROR,
  SignatureBytes
} from '@did-btcr2/common';
import { sha256 } from '@noble/hashes/sha2';
import { base58btc } from 'multiformats/bases/base58';
import { BIP340DataIntegrityProof } from '../data-integrity-proof/index.js';
import { SignedBTCR2Update, BTCR2Update, DataIntegrityConfig, DataIntegrityProofObject } from '../data-integrity-proof/interface.js';
import { SchnorrMultikey } from '../multikey/index.js';
import { Cryptosuite, VerificationResult } from './interface.js';

const canonicalization = new Canonicalization();

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
   * @param {DataIntegrityConfig} config The options to use when creating the proof.
   * @returns {DataIntegrityProofObject} The proof for the document.
   */
  createProof(
    document: BTCR2Update,
    config: DataIntegrityConfig
  ): DataIntegrityProofObject {
    // Set the context using the document context or the existing config context
    config['@context'] = document['@context'] ?? config['@context'];

    // Create a canonical form of the proof configuration
    const canonicalConfig = this.proofConfiguration(config);

    // Transform the document into a canonical form
    const canonicalDocument = this.transformDocument(document, config);

    // Generate a hash of the canonical proof configuration and canonical document
    const hash = this.generateHash(canonicalConfig, canonicalDocument);

    // Serialize the proof
    const serialized = this.proofSerialization(hash, config);

    // Cast the config to a data integrity proof object
    const proof = config as DataIntegrityProofObject;

    // Encode the proof bytes to base
    proof.proofValue = base58btc.encode(serialized);

    // Set the proof cryptosuite
    proof.cryptosuite = this.cryptosuite;

    // Set the proof type
    proof.type = this.type;

    // Return the proof
    return proof;
  }

  /**
   * Verify a proof for a secure document.
   * @param {SignedBTCR2Update} secureDocument The secure document to verify.
   * @returns {VerificationResult} The result of the verification.
   */
  verifyProof(secureDocument: SignedBTCR2Update): VerificationResult {
    // Destructure the proof from the secure document and create an unsecured document without the proof
    const { proof, ...unsecureDocument } = secureDocument;

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
   * @param {UnsignedBTCR2Update | SignedBTCR2Update} document The document to transform.
   * @param {DataIntegrityConfig} config The config to use when transforming the document.
   * @returns {string} The canonicalized document.
   * @throws {MethodError} if the document cannot be transformed.
   */
  transformDocument(document: BTCR2Update, config: DataIntegrityConfig): string {
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
    return canonicalization.canonicalize(document);
  }

  /**
   * Generate a hash of the canonical proof configuration and document.
   * @param {string} config The canonicalized proof configuration.
   * @param {string} document The canonicalized document.
   * @returns {HashHex} The hash string of the proof configuration and document.
   */
  generateHash(config: string, document: string): HashBytes {
    // Convert the canonical proof config to buffer and sha256 hash it
    const configHash = sha256(Buffer.from(config, 'utf-8'));

    // Convert the canonical document to buffer and sha256 hash it
    const documentHash = sha256(Buffer.from(document, 'utf-8'));

    // Concatenate the hashes
    const combinedHash = Buffer.concat([configHash, documentHash]);

    // sha256 hash the combined hashes and return
    return sha256(combinedHash);
  }

  /**
   * Configure the proof by canonicalzing it.
   * @param {DataIntegrityConfig} config The config to use when transforming the proof.
   * @returns {string} The canonicalized proof configuration.
   * @throws {CryptosuiteError} if the proof configuration cannot be canonicalized.
   */
  proofConfiguration(config: DataIntegrityConfig): CanonicalizedProofConfig {
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

    return canonicalization.canonicalize(config);
  }

  /**
   * Serialize the proof into a byte array.
   * @param {HashBytes} hash The canonicalized proof configuration.
   * @param {DataIntegrityConfig} config The config to use when serializing the proof.
   * @returns {SignatureBytes} The serialized proof.
   * @throws {CryptosuiteError} if the multikey does not match the verification method.
   */
  proofSerialization(hash: HashBytes, config: DataIntegrityConfig): SignatureBytes {
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
   * @param {DataIntegrityConfig} config The config to use when verifying the proof.
   * @returns {boolean} True if the proof is verified, false otherwise.
   * @throws {CryptosuiteError} if the multikey does not match the verification method.
   */
  proofVerification(
    hash: HashBytes,
    signature: SignatureBytes,
    config: DataIntegrityConfig
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
import {
  CanonicalizedProofConfig,
  HashBytes,
  HashHex,
  SignatureBytes
} from '@did-btcr2/common';
import {
  BTCR2SignedUpdate,
  BTCR2UnsignedUpdate,
  BTCR2Update,
  DataIntegrityConfig,
  DataIntegrityProofObject
} from '../data-integrity-proof/interface.js';
import { SchnorrMultikey } from '../multikey/index.js';

export interface VerificationResult {
    verified: boolean;
    verifiedDocument?: BTCR2SignedUpdate;
    mediaType?: string;
}

/**
 * Interface representing a {@link https://www.w3.org/TR/vc-data-integrity/#cryptographic-suites | Cryptographic Suite}
 * from the {@link https://www.w3.org/TR/vc-data-integrity/ | Verifiable Credential Data Integrity 1.0 spec}.
 * @interface Cryptosuite
 * @type {Cryptosuite}
 */
export interface Cryptosuite {
  /**
   * The specific type of proof. Example types include DataIntegrityProof and Ed25519Signature2020
   */
  type: string;

  /**
   * An identifier for the cryptographic suite that can be used to verify the proof.
   */
  cryptosuite: string;

  /**
   * The SchnorrMultikey used by the cryptosuite
   */
  multikey: SchnorrMultikey;

  /**
   * Create a proof for an insecure document.
   * @param {BTCR2UnsignedUpdate} insecureDocument The document to create a proof for.
   * @param {DataIntegrityConfig} config The config to use when creating the proof.
   * @returns {Proof} The proof for the document.
   */
  createProof(insecureDocument: BTCR2UnsignedUpdate, config: DataIntegrityConfig): DataIntegrityProofObject;

  /**
   * Verify a proof for a secure document.
   * @param {BTCR2SignedUpdate} secureDocument The secure document to verify.
   * @returns {VerificationResult} The result of the verification.
   */
  verifyProof(secureDocument: BTCR2SignedUpdate): VerificationResult;

  /**
   * Transform a document (secure didUpdateInvocation or insecure didUpdatePayload) into canonical form.
   * @param {BTCR2UnsignedUpdate | BTCR2SignedUpdate} document The document to transform.
   * @param {DataIntegrityConfig} config The config to use when transforming the document.
   * @returns {string} The canonicalized document.
   * @throws {MethodError} if the document cannot be transformed.
   */
  transformDocument(document: BTCR2Update, config: DataIntegrityConfig): string;

  /**
   * Generate a hash of the canonical proof configuration and document.
   * @param {string} canonicalConfig The canonicalized proof configuration.
   * @param {string} canonicalDocument The canonicalized document.
   * @returns {HashHex} The hash string of the proof configuration and document.
   */
  generateHash(canonicalConfig: string, canonicalDocument: string): HashHex;

  /**
   * Configure the proof by canonicalzing it.
   * @param {DataIntegrityConfig} config The config to use when transforming the proof.
   * @returns {string} The canonicalized proof configuration.
   * @throws {MethodError} if the proof configuration cannot be canonicalized.
   */
  proofConfiguration(config: DataIntegrityConfig): CanonicalizedProofConfig;

  /**
   * Serialize the proof into a byte array.
   * @param {HashBytes} hash The canonicalized proof configuration.
   * @param {DataIntegrityConfig} config The config to use when serializing the proof.
   * @returns {SignatureBytes} The serialized proof.
   * @throws {MethodError} if the multikey does not match the verification method.
   */
  proofSerialization(hash: HashBytes, config: DataIntegrityConfig): SignatureBytes;

  /**
   * Verify the proof by comparing the hash of the proof configuration and document to the proof bytes.
   * @param {HashBytes} hash The canonicalized proof configuration.
   * @param {SignatureBytes} signature The serialized proof.
   * @param {DataIntegrityConfig} config The config to use when verifying the proof.
   * @returns {boolean} True if the proof is verified, false otherwise.
   * @throws {MethodError} if the multikey does not match the verification method.
   */
  proofVerification(
    hash: HashBytes,
    signature: SignatureBytes,
    config: DataIntegrityConfig
  ): boolean;
}
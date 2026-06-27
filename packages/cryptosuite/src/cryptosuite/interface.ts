import type {
  CanonicalizedProofConfig,
  HashBytes,
  SignatureBytes
} from '@did-btcr2/common';
import type {
  DataIntegrityProofObject,
  DataIntegrityProofOptions,
  SecuredDocument,
  UnsecuredDocument
} from '../data-integrity-proof/interface.js';
import type { SchnorrMultikey } from '../multikey/index.js';

export interface VerificationResult {
    verified: boolean;
    verifiedDocument?: SecuredDocument;
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
   * Create a proof for an unsecured document.
   * @param {UnsecuredDocument} insecureDocument The document to create a proof for.
   * @param {DataIntegrityProofOptions} config The proof options to use when creating the proof.
   * @returns {DataIntegrityProofObject} The proof for the document.
   */
  createProof(insecureDocument: UnsecuredDocument, config: DataIntegrityProofOptions): DataIntegrityProofObject;

  /**
   * Verify a proof for a secured document.
   * @param {SecuredDocument} secureDocument The secured document to verify.
   * @returns {VerificationResult} The result of the verification.
   */
  verifyProof(secureDocument: SecuredDocument): VerificationResult;

  /**
   * Transform a document (secured or unsecured) into canonical form.
   * @param {UnsecuredDocument} document The document to transform.
   * @param {DataIntegrityProofOptions} config The proof options to use when transforming the document.
   * @returns {string} The canonicalized document.
   * @throws {MethodError} if the document cannot be transformed.
   */
  transformDocument(document: UnsecuredDocument, config: DataIntegrityProofOptions): string;

  /**
   * Generate a hash of the canonical proof configuration and document.
   * @param {string} canonicalConfig The canonicalized proof configuration.
   * @param {string} canonicalDocument The canonicalized document.
   * @returns {HashBytes} The hash bytes of the proof configuration and document.
   */
  generateHash(canonicalConfig: string, canonicalDocument: string): HashBytes;

  /**
   * Configure the proof by canonicalzing it.
   * @param {DataIntegrityProofOptions} config The config to use when transforming the proof.
   * @returns {string} The canonicalized proof configuration.
   * @throws {MethodError} if the proof configuration cannot be canonicalized.
   */
  proofConfiguration(config: DataIntegrityProofOptions): CanonicalizedProofConfig;

  /**
   * Serialize the proof into a byte array.
   * @param {HashBytes} hash The canonicalized proof configuration.
   * @param {DataIntegrityProofOptions} config The config to use when serializing the proof.
   * @returns {SignatureBytes} The serialized proof.
   * @throws {MethodError} if the multikey does not match the verification method.
   */
  proofSerialization(hash: HashBytes, config: DataIntegrityProofOptions): SignatureBytes;

  /**
   * Verify the proof by comparing the hash of the proof configuration and document to the proof bytes.
   * @param {HashBytes} hash The canonicalized proof configuration.
   * @param {SignatureBytes} signature The serialized proof.
   * @param {DataIntegrityProofOptions} config The config to use when verifying the proof.
   * @returns {boolean} True if the proof is verified, false otherwise.
   * @throws {MethodError} if the multikey does not match the verification method.
   */
  proofVerification(
    hash: HashBytes,
    signature: SignatureBytes,
    config: DataIntegrityProofOptions
  ): boolean;
}
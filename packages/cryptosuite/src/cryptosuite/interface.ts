import type {
  CanonicalizedProofConfig,
  HashBytes,
  ProblemDetails,
  SignatureBytes
} from '@did-btcr2/common';
import type {
  DataIntegrityProofObject,
  DataIntegrityProofOptions,
  SecuredDocument,
  UnsecuredDocument
} from '../data-integrity-proof/interface.js';
import type { SchnorrMultikey } from '../multikey/index.js';

/**
 * The verification result of a cryptosuite: the result of the Verify Proof algorithm of the
 * bip340-jcs-2025 suite.
 */
export interface CryptosuiteVerificationResult {
  /** True if the proof verifies. */
  verified: boolean;
  /** The unsecured document if `verified` is true; else `null`. */
  verifiedDocument: UnsecuredDocument | null;
}

/**
 * The verification result of the
 * {@link https://www.w3.org/TR/vc-data-integrity/#verify-proof | VC Data Integrity, Verify Proof}
 * algorithm.
 */
export interface VerificationResult {
  /** True if the proof verifies. */
  verified: boolean;
  /** The unsecured document if `verified` is true; else `null`. */
  verifiedDocument: UnsecuredDocument | null;
  /** The media type of the document if `verified` is true; else `null`. */
  mediaType: string | null;
  /** The warnings of the verification. */
  warnings: ProblemDetails[];
  /** The errors of the verification. */
  errors: ProblemDetails[];
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
   * @throws {CryptosuiteError} if the document is not a map, if a proof member breaks a rule, or
   * if the document or the proof options have no JCS form.
   */
  createProof(insecureDocument: UnsecuredDocument, config: DataIntegrityProofOptions): DataIntegrityProofObject;

  /**
   * Verify a proof for a secured document.
   * @param {SecuredDocument} secureDocument The secured document to verify.
   * @returns {CryptosuiteVerificationResult} The result of the verification.
   * @throws {CryptosuiteError} if the document or its proof is not a map, if a proof member breaks
   * a rule, or if the document or the proof options have no JCS form.
   */
  verifyProof(secureDocument: SecuredDocument): CryptosuiteVerificationResult;

  /**
   * Transform a document (secured or unsecured) into canonical form.
   * @param {UnsecuredDocument} document The document to transform.
   * @param {DataIntegrityProofOptions} config The proof options to use when transforming the document.
   * @returns {string} The canonicalized document.
   * @throws {CryptosuiteError} `PROOF_VERIFICATION_ERROR` if the type or the cryptosuite of the
   * config is not the one of the suite, or `PROOF_TRANSFORMATION_ERROR` if the document has no JCS
   * form.
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
   * @throws {CryptosuiteError} if the config does not match the suite or has no JCS form.
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
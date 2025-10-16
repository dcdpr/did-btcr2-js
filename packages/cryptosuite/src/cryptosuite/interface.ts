import {
  CanonicalizedProofConfig,
  DidUpdateInvocation,
  DidUpdatePayload,
  HashBytes,
  HashHex,
  Proof,
  ProofOptions,
  SignatureBytes
} from '@did-btcr2/common';
import { SchnorrMultikey } from '../multikey/index.js';

export interface CreateProofParams {
  options: ProofOptions;
  document: DidUpdatePayload;
}

export interface VerificationResult {
    verified: boolean;
    verifiedDocument?: DidUpdateInvocation;
    mediaType?: string;
}

export interface TransformDocumentParams {
  document: DidUpdatePayload | DidUpdateInvocation;
  options: ProofOptions;
}

export interface GenerateHashParams {
  canonicalConfig: string;
  canonicalDocument: string
}

export interface ProofSerializationParams {
  hash: HashBytes;
  options: ProofOptions;
};

export interface ProofVerificationParams {
  hash: HashBytes;
  signature: SignatureBytes;
  options: ProofOptions;
}

/**
 * Interface representing a BIP-340 Cryptosuite.
 * @interface ICryptosuite
 * @type {ICryptosuite}
 */
export interface ICryptosuite {
  /** @type {'DataIntegrityProof'} The type of proof produced by the cryptosuite */
  type: 'DataIntegrityProof';

  /** @type {string} The name of the cryptosuite */
  cryptosuite: string;

  /** @type {SchnorrMultikey} The SchnorrMultikey used by the cryptosuite */
  multikey: SchnorrMultikey;

  /**
   * Create a proof for an insecure document.
   * @param {CreateProofParams} params See {@link CreateProofParams} for details.
   * @param {DidUpdatePayload} params.document The document to create a proof for.
   * @param {ProofOptions} params.options The options to use when creating the proof.
   * @returns {Proof} The proof for the document.
   */
  createProof({ document, options }: CreateProofParams): Promise<Proof>;

  /**
   * Verify a proof for a secure document.
   * @param {DidUpdateInvocation} document The secure document to verify.
   * @returns {VerificationResult} The result of the verification.
   */
  verifyProof(document: DidUpdateInvocation): Promise<VerificationResult>;

  /**
   * Transform a document (secure didUpdateInvocation or insecure didUpdatePayload) into canonical form.
   * @param {TransformDocumentParams} params See {@link TransformDocumentParams} for details.
   * @param {DocumentParams} params.document The document to transform: secure or insecure.
   * @param {ProofOptions} params.options The options to use when transforming the proof.
   * @returns {string} The canonicalized document.
   * @throws {MethodError} if the document cannot be transformed.
   */
  transformDocument({ document, options }: TransformDocumentParams): Promise<string>;

  /**
   * Generate a hash of the canonical proof configuration and document.
   * @param {GenerateHashParams} params See {@link GenerateHashParams} for details.
   * @param {string} params.canonicalConfig The canonicalized proof configuration.
   * @param {string} params.canonicalDocument The canonicalized document.
   * @returns {HashHex} The hash string of the proof configuration and document.
   */
  generateHash({ canonicalConfig, canonicalDocument }: GenerateHashParams): HashHex;

  /**
   * Configure the proof by canonicalzing it.
   * @param {ProofOptions} options The options to use when transforming the proof.
   * @returns {string} The canonicalized proof configuration.
   * @throws {MethodError} if the proof configuration cannot be canonicalized.
   */
  proofConfiguration(options: ProofOptions): Promise<CanonicalizedProofConfig>;

  /**
   * Serialize the proof into a byte array.
   * @param {ProofSerializationParams} params See {@link ProofSerializationParams} for details.
   * @param {HashBytes} params.hash The canonicalized proof configuration.
   * @param {ProofOptions} params.options The options to use when serializing the proof.
   * @returns {SignatureBytes} The serialized proof.
   * @throws {MethodError} if the multikey does not match the verification method.
   */
  proofSerialization({ hash, options }: ProofSerializationParams): SignatureBytes;

  /**
   * Verify the proof by comparing the hash of the proof configuration and document to the proof bytes.
   * @param {ProofVerificationParams} params See {@link ProofVerificationParams} for details.
   * @param {HashBytes} params.hash The canonicalized proof configuration.
   * @param {SignatureBytes} params.signature The serialized proof.
   * @param {ProofOptions} params.options The options to use when verifying the proof.
   * @returns {boolean} True if the proof is verified, false otherwise.
   * @throws {MethodError} if the multikey does not match the verification method.
   */
  proofVerification({ hash, signature, options }: ProofVerificationParams): boolean;
}
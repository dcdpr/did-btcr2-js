import type { Cryptosuite, VerificationResult } from '../cryptosuite/interface.js';

/**
 * An unsecured document: any JSON object to which a Data Integrity proof can be
 * added. This cryptosuite is method-agnostic, so a document is just a JSON
 * record; applications (DID methods, Verifiable Credentials) layer their own
 * concrete document shapes on top.
 */
export type UnsecuredDocument = Record<string, unknown>;

/**
 * A secured document: an unsecured document `T` with a Data Integrity proof
 * attached under `proof`.
 */
export type SecuredDocument<T extends UnsecuredDocument = UnsecuredDocument> = T & {
  proof: DataIntegrityProofObject;
};

/**
 * Data Integrity proof options: the proof configuration without the signature
 * (`proofValue`). Carries the standard Data Integrity proof properties; a
 * cryptosuite or application MAY include further properties (for example a ZCAP
 * `capability`), which are canonicalized into the proof alongside the standard
 * ones.
 *
 * See Verifiable Credential Data Integrity section {@link https://w3c.github.io/vc-data-integrity/#proofs | 2.1 Proofs}
 * or BIP340 Cryptosuite section {@link https://dcdpr.github.io/data-integrity-schnorr-secp256k1/#dataintegrityproof | 2.2.1 DataIntegrityProof}.
 */
export interface DataIntegrityProofOptions {
  /** JSON-LD context for interpreting the proof; usually inherited from the secured document. */
  '@context'?: string | string[];

  /** The proof type, always `"DataIntegrityProof"` for this suite. */
  type: 'DataIntegrityProof';

  /** The cryptographic suite that produced the proof, e.g. `"bip340-jcs-2025"`. */
  cryptosuite: string;

  /** The verification method (key) used to produce and verify the proof. */
  verificationMethod: string;

  /** The reason the proof was created, e.g. `"assertionMethod"` or `"capabilityInvocation"`. */
  proofPurpose: string;

  /** The date and time the proof was created (XML Schema dateTime). */
  created?: string;

  /** The date and time the proof expires (XML Schema dateTime). */
  expires?: string;

  /** One or more security domains in which the proof is meant to be used. */
  domain?: string | string[];

  /** A challenge, used once for a particular domain and window of time. */
  challenge?: string;

  /** Additional proof properties defined by a cryptosuite or application. */
  [key: string]: unknown;
}

/**
 * A Data Integrity proof: the proof options plus the encoded signature.
 *
 * See Verifiable Credential Data Integrity section {@link https://w3c.github.io/vc-data-integrity/#proofs | 2.1 Proofs}
 * or BIP340 Cryptosuite section {@link https://dcdpr.github.io/data-integrity-schnorr-secp256k1/#dataintegrityproof | 2.2.1 DataIntegrityProof}.
 */
export interface DataIntegrityProofObject extends DataIntegrityProofOptions {
  /** The signature value: the encoded BIP340 Schnorr signature over the proof hash. */
  proofValue: string;
}

/**
 * Interface for a Data Integrity proof manager bound to a {@link Cryptosuite}.
 * @interface DataIntegrityProof
 * @type {DataIntegrityProof}
 */
export interface DataIntegrityProof {
  /** The cryptosuite used for proof generation and verification. */
  cryptosuite: Cryptosuite;

  /**
   * Add a Data Integrity proof to a document, returning the secured document.
   * @param {object} document The unsecured document to add the proof to.
   * @param {DataIntegrityProofOptions} options The proof options to use when generating the proof.
   * @returns {SecuredDocument} The document with a `proof` attached.
   */
  addProof<T extends UnsecuredDocument>(document: T, options: DataIntegrityProofOptions): SecuredDocument<T>;

  /**
   * Verify the proof on a secured document.
   * @param {string} document The stringified secured document to verify.
   * @param {string} expectedPurpose The expected proof purpose.
   * @param {string} mediaType The media type of the document.
   * @param {string[]} expectedDomain The expected proof domain.
   * @param {string} expectedChallenge The expected proof challenge.
   * @returns {VerificationResult} The result of verifying the proof.
   */
  verifyProof(
    document: string,
    expectedPurpose: string,
    mediaType?: string,
    expectedDomain?: string[],
    expectedChallenge?: string,
  ): VerificationResult;
}

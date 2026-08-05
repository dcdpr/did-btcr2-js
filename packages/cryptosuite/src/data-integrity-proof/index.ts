import { DataIntegrityProofError, DateUtils, PROOF_GENERATION_ERROR, PROOF_VERIFICATION_ERROR } from '@did-btcr2/common';
import type { BIP340Cryptosuite } from '../cryptosuite/index.js';
import type { VerificationResult } from '../cryptosuite/interface.js';
import type { DataIntegrityProof, DataIntegrityProofOptions, SecuredDocument, UnsecuredDocument } from './interface.js';

/**
 * Implements section {@link https://dcdpr.github.io/data-integrity-schnorr-secp256k1/#dataintegrityproof | 2.2.1 DataIntegrityProof}
 * of the {@link https://dcdpr.github.io/data-integrity-schnorr-secp256k1 | Data Integrity BIP-340 Cryptosuite} spec
 * @implements {DataIntegrityProof}
 * @class BIP340DataIntegrityProof
 * @type {BIP340DataIntegrityProof}
 */
export class BIP340DataIntegrityProof implements DataIntegrityProof {
  /** @type {BIP340Cryptosuite} The cryptosuite to use for proof generation and verification. */
  public cryptosuite: BIP340Cryptosuite;

  /**
   * Creates an instance of BIP340DataIntegrityProof.
   * @param {BIP340Cryptosuite} cryptosuite The cryptosuite to use for proof generation and verification.
   */
  constructor(cryptosuite: BIP340Cryptosuite) {
    this.cryptosuite = cryptosuite;
  }

  /**
   * Add a proof to a document.
   * @param {UnsecuredDocument} unsignedDocument The document to add the proof to.
   * @param {DataIntegrityProofOptions} config The proof options for generating the proof.
   * @returns {SecuredDocument} A document with a proof added.
   */
  addProof<T extends UnsecuredDocument>(unsignedDocument: T, config: DataIntegrityProofOptions): SecuredDocument<T> {
    // Generate the proof
    const proof = this.cryptosuite.createProof(unsignedDocument, config);

    // Check if the proof has required fields: type, verificationMethod, and proofPurpose
    if (!proof.type || !proof.verificationMethod || !proof.proofPurpose) {
      throw new DataIntegrityProofError(
        'Invalid proof: missing proof.type, proof.verificationMethod and/or proof.proofPurpose',
        PROOF_GENERATION_ERROR, {config, proof}
      );
    }

    // TODO: Adjust the domain check to match the spec (domain as a list of urls)
    // Check if the config has a domain
    if (config.domain) {
      // Check that it matches the proof domain Check domain from the proof object and check:
      if(proof.domain !== config.domain)
        throw new DataIntegrityProofError(
          'Domain mismatch: proof.domain !== config.domain',
          PROOF_GENERATION_ERROR, {config, proof}
        );
    }

    // Check if the config has a challenge
    if (config.challenge) {
      // Check that it matches the proof.challenge
      if(proof.challenge !== config.challenge)
        throw new DataIntegrityProofError(
          'Challenge mismatch options and challenge passed',
          PROOF_GENERATION_ERROR, {config, proof}
        );
    }

    // Attach the proof to a fresh copy of the document, securing it. The caller's
    // document is not mutated in place, so a proof object can never be retroactively
    // swapped onto (or off of) a document the caller still holds.
    const signedDocument = { ...unsignedDocument, proof } as SecuredDocument<T>;

    // Return the secured document
    return signedDocument;
  }

  /**
   * Verify a proof.
   * @param {string} mediaType The media type of the document.
   * @param {string} document The stringified document to verify.
   * @param {string} expectedPurpose The expected purpose of the proof.
   * @param {string[]} expectedDomain The expected domain of the proof.
   * @param {string} expectedChallenge The expected challenge of the proof.
   * @returns {VerificationResult} The result of verifying the proof.
   */
  verifyProof(
    document: string,
    expectedPurpose: string,
    mediaType?: string,
    expectedDomain?: string | string[],
    expectedChallenge?: string,
  ): VerificationResult {
    // Parse the document
    const signedDocument = JSON.parse(document) as SecuredDocument;

    // Parse the proof from the document
    const proof = signedDocument.proof;

    // Check if the type, proofPurpose, and verificationMethod are defined
    if (!proof.type || !proof.verificationMethod || !proof.proofPurpose) {
      throw new DataIntegrityProofError(
        'Invalid proof: missing proof.type, proof.verificationMethod and/or proof.proofPurpose',
        PROOF_VERIFICATION_ERROR, signedDocument
      );
    }

    // Check if the expectedPurpose is defined
    if (expectedPurpose)
    // Check if expectedPurpose !== proof.proofPurpose
      if(expectedPurpose !== proof.proofPurpose)
      // Else throw DataIntegrityProofError
        throw new DataIntegrityProofError(
          'Proof purpose mismatch: proof.proofPurpose !== expectedPurpose',
          PROOF_VERIFICATION_ERROR, { proof, expectedPurpose }
        );

    // Check if the expectedChallenge is defined
    if (expectedChallenge)
    // Check if expectedChallenge !== proof.challenge
      if(expectedChallenge !== proof.challenge)
      // Else throw DataIntegrityProofError
        throw new DataIntegrityProofError(
          'Challenge mismatch: proof.challenge !== expectedChallenge',
          'INVALID_CHALLENGE_ERROR', { proof, expectedChallenge, }
        );

    // Check if the expectedDomain is defined
    if(expectedDomain) {
      // Normalize both sides to arrays: proof.domain and expectedDomain may each
      // be a single string or a list of strings.
      const expectedDomains = Array.isArray(expectedDomain) ? expectedDomain : [expectedDomain];
      const proofDomains = Array.isArray(proof.domain) ? proof.domain : (proof.domain ? [proof.domain] : []);

      // Every expected domain must be present in the proof's domain list.
      if(!expectedDomains.every(url => proofDomains.includes(url))) {
        throw new DataIntegrityProofError(
          'Domain mismatch: expectedDomain not present in proof.domain',
          PROOF_VERIFICATION_ERROR, { proof, expectedDomain }
        );
      }
    }

    // Check if the proof carries an expiry
    if(proof.expires) {
      // Validate the format
      if(!DateUtils.isValidXsdDateTime(proof.expires)) {
        throw new DataIntegrityProofError(
          'Invalid proof: "expires" must be a valid XMLSchema DateTime string',
          PROOF_VERIFICATION_ERROR, { proof }
        );
      }
      // A captured proof must not verify past its expiry
      if(DateUtils.dateStringToTimestamp(proof.expires).getTime() <= Date.now()) {
        throw new DataIntegrityProofError(
          'Proof expired: current time is past proof.expires',
          PROOF_VERIFICATION_ERROR, { proof }
        );
      }
    }

    // Verify the proof
    const result = this.cryptosuite.verifyProof(signedDocument);

    // Add the mediaType to the verification result
    result.mediaType = mediaType;

    // Return the verification result
    return result;
  }
}
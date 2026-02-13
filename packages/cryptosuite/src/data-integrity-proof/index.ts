import { DataIntegrityProofError, PROOF_GENERATION_ERROR, PROOF_VERIFICATION_ERROR } from '@did-btcr2/common';
import { BIP340Cryptosuite } from '../cryptosuite/index.js';
import { VerificationResult } from '../cryptosuite/interface.js';
import { SignedBTCR2Update, UnsignedBTCR2Update, DataIntegrityConfig, DataIntegrityProof } from './interface.js';

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
   * @param {UnsignedBTCR2Update} unsignedDocument The document to add the proof to.
   * @param {DataIntegrityConfig} config The configuration for generating the proof.
   * @returns {SignedBTCR2Update} A document with a proof added.
   */
  addProof(unsignedDocument: UnsignedBTCR2Update, config: DataIntegrityConfig): SignedBTCR2Update {
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

    // Cast the unsignedDocument to a SignedBTCR2Update to add the proof
    const signedDocument = unsignedDocument as SignedBTCR2Update;

    // Set the proof in the document and return as a SignedBTCR2Update
    signedDocument.proof = proof;

    // Return the signed document
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
    try {
      // Parse the document
      const signedDocument = JSON.parse(document) as SignedBTCR2Update;

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
        // Check if expectedDomain is an array with at least one entry
        if(Array.isArray(expectedDomain) && expectedDomain.length) {
          // Check that the domain arrays match in length
          if(expectedDomain.length !== proof.domain?.length) {
            // Else throw DataIntegrityProofError
            throw new DataIntegrityProofError(
              'Domain mismatch: expectedDomain length does not match proof.domain length',
              PROOF_VERIFICATION_ERROR, { proof, expectedDomain }
            );
          }
          // Check that each entry in expectedDomain can be found in proof.domain
          else if(expectedDomain.every(url => proof.domain?.includes(url))) {
            // Else throw DataIntegrityProofError
            throw new DataIntegrityProofError(
              'Domain mismatch: expectedDomain and proof.domain do not match',
              PROOF_VERIFICATION_ERROR, { proof, expectedDomain }
            );
          }
        }
        // Else expectedDomain is a string, check that it matches proof.domain
        else if(proof.domain !== expectedDomain) {
          throw new DataIntegrityProofError(
            'Domain mismatch: proof.domain !== expectedDomain',
            PROOF_VERIFICATION_ERROR, { proof, expectedDomain }
          );
        }
      }

      // Verify the proof
      const result = this.cryptosuite.verifyProof(signedDocument);

      // Add the mediaType to the verification result
      result.mediaType = mediaType;

      // Return the verification result
      return result;
    } catch (error) {
      throw new DataIntegrityProofError(
        'Error verifying proof: ' + (error instanceof Error ? error.message : String(error)),
        PROOF_VERIFICATION_ERROR, {document, mediaType, expectedPurpose, expectedDomain, expectedChallenge}
      );
    }
  }
}
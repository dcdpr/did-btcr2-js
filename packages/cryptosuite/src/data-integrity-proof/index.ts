import { MethodError, DidUpdateInvocation, Proof, PROOF_GENERATION_ERROR, PROOF_PARSING_ERROR, JSONUtils } from '@did-btcr2/common';
import { Cryptosuite } from '../cryptosuite/index.js';
import { VerificationResult } from '../cryptosuite/interface.js';
import { AddProofParams, IDataIntegrityProof } from './interface.js';

/**
 * Implements section
 * {@link https://dcdpr.github.io/data-integrity-schnorr-secp256k1/#dataintegrityproof | 2.2.1 DataIntegrityProof}
 * of the {@link https://dcdpr.github.io/data-integrity-schnorr-secp256k1 | Data Integrity BIP-340 Cryptosuite} spec
 * @class DataIntegrityProof
 * @type {DataIntegrityProof}
 */
export class DataIntegrityProof implements IDataIntegrityProof {
  /** @type {Cryptosuite} The cryptosuite to use for proof generation and verification. */
  public cryptosuite: Cryptosuite;

  /**
   * Creates an instance of DataIntegrityProof.
   *
   * @param {Cryptosuite} cryptosuite The cryptosuite to use for proof generation and verification.
   */
  constructor(cryptosuite: Cryptosuite) {
    this.cryptosuite = cryptosuite;
  }

  /**
   * Add a proof to a document.
   * @param {AddProofParams} params Parameters for adding a proof to a document.
   * @param {InsecureDocument} params.document The document to add a proof to.
   * @param {ProofOptions} params.options Options for adding a proof to a document.
   * @returns {SecureDocument} A document with a proof added.
   */
  public async addProof({ document, options }: AddProofParams): Promise<DidUpdateInvocation> {
    // Generate the proof
    const proof = await this.cryptosuite.createProof({ document, options });

    // Deconstruct the proof object
    const { type, verificationMethod, proofPurpose } = proof;

    // Check if the type, verificationMethod, and proofPurpose are defined
    if (!type || !verificationMethod || !proofPurpose) {
      throw new MethodError('Proof missing "type", "verificationMethod" and/or "proofPurpose"', PROOF_GENERATION_ERROR, proof);
    }

    // Deconstruct the domain from the proof object and check:
    // if the options domain is defined, ensure it matches the proof domain
    // Logger.warn('// TODO: Adjust the domain check to match the spec (domain as a list of urls)');
    const { domain } = proof;
    if (options.domain && options.domain !== domain) {
      throw new MethodError('Domain mismatch between options and domain passed', PROOF_GENERATION_ERROR, proof);
    }

    // Deconstruct the challenge from the proof object and check:
    // if options challenge is defined, ensure it matches the proof challenge
    const { challenge } = proof;
    if (options.challenge && options.challenge !== challenge) {
      throw new MethodError('Challenge mismatch options and challenge passed', PROOF_GENERATION_ERROR, proof);
    }

    // Set the proof in the document and return as a DidUpdateInvocation
    return { ...document, proof } as DidUpdateInvocation;
  }

  /**
   * Verify a proof.
   * @param {VerifyProofParams} params Parameters for verifying a proof.
   * @param {string} params.mediaType The media type of the document.
   * @param {string} params.document The document to verify.
   * @param {string} params.expectedPurpose The expected purpose of the proof.
   * @param {string[]} params.expectedDomain The expected domain of the proof.
   * @param {string} params.expectedChallenge The expected challenge of the proof.
   * @returns {VerificationResult} The result of verifying the proof.
   */
  public async verifyProof({
    mediaType,
    document,
    expectedPurpose,
    expectedDomain,
    expectedChallenge
  }: {
    mediaType?: string;
    document: string;
    expectedPurpose: string;
    expectedDomain?: string[];
    expectedChallenge?: string;
  }): Promise<VerificationResult> {
    // Parse the document
    const secure = JSON.parse(document) as DidUpdateInvocation;

    // Deconstruct the secure object to get the proof
    const { proof }: { proof: Proof } = secure;

    // Check if the proof object is an object
    if (typeof secure !== 'object' || typeof proof !== 'object') {
      throw new MethodError('', PROOF_PARSING_ERROR);
    }

    // Deconstruct the proof object
    const { type, proofPurpose, verificationMethod, challenge, domain } = proof;
    // Check if the type, proofPurpose, and verificationMethod are defined
    if (!type || !verificationMethod || !proofPurpose) {
      throw new MethodError('', 'PROOF_VERIFICATION_ERROR');
    }

    // Check if the expectedPurpose is defined and if it matches the proofPurpose
    if (expectedPurpose && expectedPurpose !== proofPurpose) {
      throw new MethodError('', 'PROOF_VERIFICATION_ERROR');
    }

    // Check if the expectedChallenge is defined and if it matches the challenge
    if (expectedChallenge && expectedChallenge !== challenge) {
      throw new MethodError('', 'INVALID_CHALLENGE_ERROR');
    }

    // Check if the expectedDomain length matches the proof.domain length
    if(expectedDomain && expectedDomain?.length !== domain?.length) {
      throw new MethodError('', 'INVALID_DOMAIN_ERROR');
    }

    // If defined, check that each entry in expectedDomain can be found in proof.domain
    if(expectedDomain && !expectedDomain?.every(url => domain?.includes(url))) {
      throw new MethodError('', 'INVALID_DOMAIN_ERROR');
    }

    // Verify the proof
    const { verified, verifiedDocument, mediaType: mt } = await this.cryptosuite.verifyProof(secure);

    // Add the mediaType to the verification result
    mediaType ??= mt;

    // Add the mediaType to the verification result
    mediaType ??= mt;

    const sansProof = JSONUtils.deleteKeys(verifiedDocument as Record<string, any>, ['proof']) as DidUpdateInvocation;

    // Return the verification result
    return {verified, verifiedDocument: verified ? sansProof : undefined, mediaType};
  }
}
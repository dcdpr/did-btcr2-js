import {
  DataIntegrityProofError,
  INVALID_CHALLENGE_ERROR,
  INVALID_DOMAIN_ERROR,
  PARSING_ERROR,
  PROOF_GENERATION_ERROR,
  PROOF_VERIFICATION_ERROR
} from '@did-btcr2/common';
import type { BIP340Cryptosuite } from '../cryptosuite/index.js';
import type { VerificationResult } from '../cryptosuite/interface.js';
import { isMap } from '../cryptosuite/proof-checks.js';
import type { DataIntegrityProof, DataIntegrityProofOptions, SecuredDocument, UnsecuredDocument } from './interface.js';

/**
 * Normalize a `domain` value to a list of urls. A domain is one or more urls, expressed either as a
 * single string or as an array of strings; an absent domain is an empty list. Normalizing before
 * comparison keeps a string domain from being treated as an array (where `length` is the character
 * count and `includes` is a substring test).
 * @param {unknown} domain The domain value to normalize.
 * @returns {unknown[]} The domain as a list of urls.
 */
function toDomainList(domain: unknown): unknown[] {
  return domain === undefined ? [] : Array.isArray(domain) ? domain : [domain];
}

/** The short text of each error type that the Verify Proof algorithm returns. */
const PROBLEM_TITLES = {
  [PARSING_ERROR]            : 'The secured document or its proof is not a map',
  [PROOF_VERIFICATION_ERROR] : 'The proof does not pass a check of Verify Proof',
  [INVALID_DOMAIN_ERROR]     : 'The proof domain is not the expected domain',
  [INVALID_CHALLENGE_ERROR]  : 'The proof challenge is not the expected challenge',
} as const;

/**
 * Make the verification result of a step that raises an error (VC Data Integrity, Verify Proof):
 * `verified` is false, and `errors` holds one ProblemDetails with a type URL of VC Data Integrity,
 * Processing Errors.
 * @param {keyof typeof PROBLEM_TITLES} code The error type.
 * @param {string} detail The text of this error.
 * @returns {VerificationResult} The verification result.
 */
function failure(code: keyof typeof PROBLEM_TITLES, detail: string): VerificationResult {
  return {
    verified         : false,
    verifiedDocument : null,
    mediaType        : null,
    warnings         : [],
    errors           : [{ type: `https://w3id.org/security#${code}`, title: PROBLEM_TITLES[code], detail }]
  };
}

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
   * Add a proof to a document: the
   * {@link https://www.w3.org/TR/vc-data-integrity/#add-proof | VC Data Integrity, Add Proof}
   * algorithm. The function does not change `unsignedDocument` or `config`.
   *
   * This suite adds one proof. As a safeguard (VC Data Integrity, Algorithms), the function refuses
   * a document that already has a proof and options with a `previousProof`. Those inputs need the
   * Add Proof Set/Chain algorithm, which this suite does not implement.
   * @param {UnsecuredDocument} unsignedDocument The document to add the proof to.
   * @param {DataIntegrityProofOptions} config The proof options for generating the proof.
   * @returns {SecuredDocument} A copy of the document with the proof.
   * @throws {DataIntegrityProofError} `PROOF_GENERATION_ERROR` if the document has a `proof`, if
   * the options have a `previousProof`, or if the proof does not pass Add Proof steps 2 to 4.
   * @throws {CryptosuiteError} if the cryptosuite cannot create the proof (see
   * {@link BIP340Cryptosuite.createProof}).
   */
  addProof<T extends UnsecuredDocument>(unsignedDocument: T, config: DataIntegrityProofOptions): SecuredDocument<T> {
    if(isMap(unsignedDocument) && unsignedDocument.proof !== undefined) {
      throw new DataIntegrityProofError(
        'Invalid document: the document already has a proof. This suite adds one proof and does not '
        + 'make proof sets or chains (VC Data Integrity, Add Proof Set/Chain).',
        PROOF_GENERATION_ERROR
      );
    }
    if(isMap(config) && config.previousProof !== undefined) {
      throw new DataIntegrityProofError(
        'Invalid proof options: "previousProof" needs a proof chain (VC Data Integrity, Add Proof '
        + 'Set/Chain), which this suite does not make.',
        PROOF_GENERATION_ERROR
      );
    }

    // Step 1.
    const proof = this.cryptosuite.createProof(unsignedDocument, config);

    // Step 2.
    if(proof.type === undefined || proof.verificationMethod === undefined || proof.proofPurpose === undefined) {
      throw new DataIntegrityProofError(
        'Invalid proof: missing proof.type, proof.verificationMethod and/or proof.proofPurpose',
        PROOF_GENERATION_ERROR
      );
    }

    // Steps 3 and 4.
    if(config.domain !== undefined && config.domain !== null
      && JSON.stringify(proof.domain) !== JSON.stringify(config.domain)) {
      throw new DataIntegrityProofError(
        'Domain mismatch: proof.domain !== config.domain',
        PROOF_GENERATION_ERROR
      );
    }
    if(config.challenge !== undefined && config.challenge !== null && proof.challenge !== config.challenge) {
      throw new DataIntegrityProofError(
        'Challenge mismatch: proof.challenge !== config.challenge',
        PROOF_GENERATION_ERROR
      );
    }

    // Steps 5 to 7.
    return { ...unsignedDocument, proof };
  }

  /**
   * Verify the proof of a secured document: the
   * {@link https://www.w3.org/TR/vc-data-integrity/#verify-proof | VC Data Integrity, Verify Proof}
   * algorithm.
   *
   * A step that raises an error (steps 2 and 4 to 7) gives `verified: false` and one ProblemDetails
   * in `errors`. As a safeguard (VC Data Integrity, Algorithms), the function also gives a
   * `PROOF_VERIFICATION_ERROR` for a proof with a `previousProof`: only the Verify Proof Sets and
   * Chains algorithm can verify it, and this suite does not implement that algorithm.
   * @param {string} document The JSON text of the secured document.
   * @param {string} expectedPurpose The expected purpose of the proof, if given.
   * @param {string} mediaType The media type of the document.
   * @param {string | string[]} expectedDomain The expected domain of the proof, if given.
   * @param {string} expectedChallenge The expected challenge of the proof, if given.
   * @returns {VerificationResult} The result of verifying the proof.
   * @throws {DataIntegrityProofError} `PARSING_ERROR` if `document` is not JSON text (step 1).
   * @throws {CryptosuiteError} if the cryptosuite cannot complete the verification (step 8, see
   * {@link BIP340Cryptosuite.verifyProof}).
   */
  verifyProof(
    document: string,
    expectedPurpose?: string,
    mediaType?: string,
    expectedDomain?: string | string[],
    expectedChallenge?: string,
  ): VerificationResult {
    // Step 1.
    let securedDocument: unknown;
    try {
      securedDocument = JSON.parse(document);
    } catch (error) {
      throw new DataIntegrityProofError(
        `Invalid document: the text is not JSON: ${error instanceof Error ? error.message : 'unknown error'}`,
        PARSING_ERROR
      );
    }

    // Steps 2 and 3.
    if(!isMap(securedDocument) || !isMap(securedDocument.proof)) {
      return failure(PARSING_ERROR, 'Invalid secured document: the document and its proof must be JSON objects.');
    }
    const proof = securedDocument.proof;

    // Step 4.
    if(proof.type === undefined || proof.verificationMethod === undefined || proof.proofPurpose === undefined) {
      return failure(
        PROOF_VERIFICATION_ERROR,
        'Invalid proof: missing proof.type, proof.verificationMethod and/or proof.proofPurpose'
      );
    }
    if(proof.previousProof !== undefined) {
      return failure(
        PROOF_VERIFICATION_ERROR,
        'Invalid proof: "previousProof" needs the verification of a proof chain (VC Data Integrity, '
        + 'Verify Proof Sets and Chains), which this suite does not do.'
      );
    }

    // Step 5.
    if(expectedPurpose !== undefined && expectedPurpose !== proof.proofPurpose) {
      return failure(PROOF_VERIFICATION_ERROR, 'Proof purpose mismatch: proof.proofPurpose !== expectedPurpose');
    }

    // Step 6: a string domain is a set with one string. The two sets must hold the same
    // strings. A repeated string does not change a set, so the step does not compare lengths.
    if(expectedDomain !== undefined) {
      const expectedDomains = toDomainList(expectedDomain);
      const proofDomains = toDomainList(proof.domain);
      if(!expectedDomains.every(url => proofDomains.includes(url))
        || !proofDomains.every(url => expectedDomains.includes(url))) {
        return failure(INVALID_DOMAIN_ERROR, 'Domain mismatch: expectedDomain and proof.domain do not match');
      }
    }

    // Step 7.
    if(expectedChallenge !== undefined && expectedChallenge !== proof.challenge) {
      return failure(INVALID_CHALLENGE_ERROR, 'Challenge mismatch: proof.challenge !== expectedChallenge');
    }

    // Steps 8 and 9.
    const result = this.cryptosuite.verifyProof(securedDocument as SecuredDocument);
    return {
      verified         : result.verified,
      verifiedDocument : result.verifiedDocument,
      mediaType        : result.verified ? (mediaType ?? null) : null,
      warnings         : [],
      errors           : []
    };
  }
}

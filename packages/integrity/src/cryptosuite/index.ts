import type {
  CanonicalizedProofConfig,
  HashBytes,
  SignatureBytes
} from '@did-btcr2/std';
import {
  CanonicalizationError,
  canonicalize,
  CryptosuiteError,
  DateUtils,
  PARSING_ERROR,
  PROOF_GENERATION_ERROR,
  PROOF_SERIALIZATION_ERROR,
  PROOF_TRANSFORMATION_ERROR,
  PROOF_VERIFICATION_ERROR
} from '@did-btcr2/std';
import { sha256 } from '@noble/hashes/sha2';
import { concatBytes, utf8ToBytes } from '@noble/hashes/utils';
import { base58btc } from 'multiformats/bases/base58';
import { BIP340DataIntegrityProof } from '../data-integrity-proof/index.js';
import type { DataIntegrityProofObject, DataIntegrityProofOptions, SecuredDocument, UnsecuredDocument } from '../data-integrity-proof/interface.js';
import type { SchnorrMultikey } from '../multikey/index.js';
import type { Cryptosuite, CryptosuiteVerificationResult } from './interface.js';
import {
  contextStartsWith,
  decodeProofValue,
  isMap,
  proofOptionsProblem,
  securedProofProblem
} from './proof-checks.js';

/**
 * Non-sensitive description of a cryptosuite, attached to error `data` in place
 * of the suite instance itself (which reaches the multikey and its secret key).
 */
type SuiteContext = {
  type: string;
  cryptosuite: string;
  verificationMethod: string;
};

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
   * Describe this suite for an error `data` payload. Errors are routinely logged
   * and shipped to telemetry, and this suite holds a multikey which may hold a
   * secret key, so the suite itself must never be attached to one. This carries
   * only what a caller needs to see what the suite expected.
   * @returns {SuiteContext} The suite's type, name and verification method id.
   */
  #suiteContext(): SuiteContext {
    return {
      type               : this.type,
      cryptosuite        : this.cryptosuite,
      verificationMethod : this.multikey.fullId()
    };
  }

  /**
   * Create a proof for an unsecured document: the Create Proof algorithm of the bip340-jcs-2025
   * suite. The function does not change `document` or `config`.
   *
   * Before the algorithm, the function checks the proof members of VC Data Integrity, Proofs. A
   * `domain` array must not have a repeated string: a domain is "an unordered set of strings". As
   * a safeguard (VC Data Integrity, Algorithms), the function also refuses a proof that can never
   * verify: proof options with an `@context` for a document with no `@context`, and proof options
   * with a `proofValue`.
   * @param {UnsecuredDocument} document The document to create a proof for.
   * @param {DataIntegrityProofOptions} config The proof options.
   * @returns {DataIntegrityProofObject} The proof: a copy of the options with the document
   * `@context` and the `proofValue`.
   * @throws {CryptosuiteError} `PROOF_GENERATION_ERROR` if the document is not a map, if the
   * options have a `proofValue`, if a proof member breaks a rule, if the options have an
   * `@context` and the document has none, if the options or the document `@context` have no JCS
   * form, or if the signer does not give 64 bytes.
   * Else `PROOF_TRANSFORMATION_ERROR` if the document has no JCS form (see
   * {@link BIP340Cryptosuite.proofConfiguration} and {@link BIP340Cryptosuite.transformDocument}).
   * Else `PROOF_SERIALIZATION_ERROR` if `verificationMethod` is not the id of the multikey.
   */
  createProof(
    document: UnsecuredDocument,
    config: DataIntegrityProofOptions
  ): DataIntegrityProofObject {
    if(!isMap(document)) {
      throw new CryptosuiteError(
        'Invalid document: the document must be a JSON object.',
        PROOF_GENERATION_ERROR
      );
    }

    // Step 1: the proof is a copy of the proof options. Proof Configuration signs the copy with a
    // proofValue of the options, and Verify Proof step 2 removes it, so the proof never verifies.
    const proof: Record<string, unknown> = { ...config };
    if(proof.proofValue !== undefined) {
      throw new CryptosuiteError(
        'Invalid proof options: "proofValue" must not be present: Create Proof adds the proofValue.',
        PROOF_GENERATION_ERROR, { proofValue: proof.proofValue }
      );
    }

    // Step 2: the proof gets the document @context. Verify Proof step 4 fails for a proof
    // @context that the document does not start with, so a proof @context alone is refused.
    const documentContext = document['@context'];
    if(documentContext !== undefined) {
      proof['@context'] = Array.isArray(documentContext) ? [...documentContext] : documentContext;
    } else if(proof['@context'] !== undefined) {
      throw new CryptosuiteError(
        'Invalid proof options: "@context" needs a document @context that starts with it.',
        PROOF_GENERATION_ERROR, { '@context': proof['@context'] }
      );
    }

    const problem = proofOptionsProblem(proof);
    if(problem !== undefined) {
      throw new CryptosuiteError(
        `Invalid proof options: "${problem.member}" must be ${problem.rule}.`,
        PROOF_GENERATION_ERROR, { [problem.member]: proof[problem.member] }
      );
    }

    // Steps 3 to 6.
    const proofConfig = this.proofConfiguration(proof as DataIntegrityProofOptions);
    const transformedData = this.transformDocument(document, config);
    const hashData = this.generateHash(proofConfig, transformedData);
    const proofBytes = this.proofSerialization(hashData, config);
    if(proofBytes.length !== 64) {
      throw new CryptosuiteError(
        `Invalid signature: the signer returned ${proofBytes.length} bytes; a BIP340 signature has 64 bytes.`,
        PROOF_GENERATION_ERROR, { length: proofBytes.length }
      );
    }

    // Steps 7 and 8.
    proof.proofValue = base58btc.encode(proofBytes);
    return proof as DataIntegrityProofObject;
  }

  /**
   * Verify the proof of a secured document: the Verify Proof algorithm of the bip340-jcs-2025
   * suite. The function does not change `securedDocument`.
   *
   * Before the algorithm, the function checks the proof members of VC Data Integrity, Proofs. The
   * function does not verify the proofs that a `previousProof` names.
   * @param {SecuredDocument} securedDocument The secured document to verify.
   * @returns {CryptosuiteVerificationResult} `verified` and, if `verified` is true, the unsecured
   * document; else `verifiedDocument` is `null`. If the document does not start with the proof
   * `@context` (step 4), `verified` is false.
   * @throws {CryptosuiteError} `PARSING_ERROR` if the document or its proof is not a map. Else
   * `PROOF_VERIFICATION_ERROR` if a proof member breaks a rule, if the `proofValue` is not the
   * base58btc Multibase text of 64 bytes, if the type or the cryptosuite is not the one of this
   * suite, or if `verificationMethod` is not the id of the multikey. Else
   * `PROOF_TRANSFORMATION_ERROR` if the document has no JCS form, or `PROOF_GENERATION_ERROR` if
   * `created` is not an XML Schema `dateTime` or the proof options have no JCS form. The
   * verification does not complete, so the result is an error and not `verified: false` (VC Data
   * Integrity, Cryptographic Suites).
   */
  verifyProof(securedDocument: SecuredDocument): CryptosuiteVerificationResult {
    if(!isMap(securedDocument) || !isMap(securedDocument.proof)) {
      throw new CryptosuiteError(
        'Invalid secured document: the document and its proof must be JSON objects.',
        PARSING_ERROR
      );
    }

    // Steps 1 and 2: copies without the proof and without the proofValue.
    const { proof, ...unsecuredDocument } = securedDocument;
    const { proofValue, ...proofOptions } = proof;

    const problem = securedProofProblem(proofOptions);
    if(problem !== undefined) {
      throw new CryptosuiteError(
        `Invalid proof: "${problem.member}" must be ${problem.rule}.`,
        PROOF_VERIFICATION_ERROR, { [problem.member]: proofOptions[problem.member] }
      );
    }

    // Step 3.
    const proofBytes = decodeProofValue(proofValue);
    if(proofBytes === undefined) {
      throw new CryptosuiteError(
        'Invalid proofValue: not the base58btc Multibase encoding of a 64-byte BIP340 signature.',
        PROOF_VERIFICATION_ERROR, { proofValue }
      );
    }

    // Step 4.
    if(proofOptions['@context'] !== undefined) {
      if(!contextStartsWith(securedDocument['@context'], proofOptions['@context'])) {
        return { verified: false, verifiedDocument: null };
      }
      unsecuredDocument['@context'] = proofOptions['@context'];
    }

    // Steps 5 to 8.
    const transformedData = this.transformDocument(unsecuredDocument, proofOptions);
    const proofConfig = this.proofConfiguration(proofOptions);
    const hashData = this.generateHash(proofConfig, transformedData);
    const verified = this.proofVerification(hashData, proofBytes, proofOptions);

    // Step 9.
    return { verified, verifiedDocument: verified ? unsecuredDocument : null };
  }

  /**
   * Transform a document into canonical form.
   * @param {UnsecuredDocument} document The document to transform.
   * @param {DataIntegrityProofOptions} config The config to use when transforming the document.
   * @returns {string} The canonicalized document.
   * @throws {CryptosuiteError} `PROOF_VERIFICATION_ERROR` if the type or the cryptosuite of the
   * config is not the one of this suite.
   * @throws {CryptosuiteError} `PROOF_TRANSFORMATION_ERROR` if the document has no JCS form, for
   * example if it holds a lone surrogate or NaN. `data.cause` gives the type and the message of the
   * CanonicalizationError.
   */
  transformDocument(document: UnsecuredDocument, config: DataIntegrityProofOptions): string {
    // Get the type from the options and check if it matches this type
    if (config.type !== this.type) {
      throw new CryptosuiteError(
        'Type mismatch: config.type !== this.type',
        PROOF_VERIFICATION_ERROR, {config, suite: this.#suiteContext()}
      );
    }

    // Get the cryptosuite from the options and if it matches this cryptosuite
    if (config.cryptosuite !== this.cryptosuite) {
      throw new CryptosuiteError(
        'Cryptosuite mismatch: config.cryptosuite !== this.cryptosuite',
        PROOF_VERIFICATION_ERROR, {config, suite: this.#suiteContext()}
      );
    }

    // RFC 8785 section 3.2.2.2: data with no JCS form stops JCS "with an appropriate error".
    // VC Data Integrity section 4.7 names PROOF_TRANSFORMATION_ERROR for the transformation.
    try {
      return canonicalize(document);
    } catch(error) {
      if(!(error instanceof CanonicalizationError)) throw error;
      throw new CryptosuiteError(
        `Invalid document: ${error.message}`,
        PROOF_TRANSFORMATION_ERROR, { cause: { type: error.type, message: error.message } }
      );
    }
  }

  /**
   * Generate a hash of the canonical proof configuration and document.
   * @param {string} config The canonicalized proof configuration.
   * @param {string} document The canonicalized document.
   * @returns {HashBytes} The hash bytes of the proof configuration and document.
   */
  generateHash(config: string, document: string): HashBytes {
    // Convert the canonical proof config to bytes and sha256 hash it
    const configHash = sha256(utf8ToBytes(config));

    // Convert the canonical document to bytes and sha256 hash it
    const documentHash = sha256(utf8ToBytes(document));

    // Concatenate the hashes
    const combinedHash = concatBytes(configHash, documentHash);

    // sha256 hash the combined hashes and return
    return sha256(combinedHash);
  }

  /**
   * Configure the proof by canonicalzing it.
   * @param {DataIntegrityProofOptions} config The config to use when transforming the proof.
   * @returns {string} The canonicalized proof configuration.
   * @throws {CryptosuiteError} `PROOF_GENERATION_ERROR` if the type or the cryptosuite of the config
   * is not the one of this suite, if `created` is set and is not an XML Schema `dateTime`, or if the config
   * has no JCS form. For no JCS form, `data.cause` gives the type and the message of the
   * CanonicalizationError.
   */
  proofConfiguration(config: DataIntegrityProofOptions): CanonicalizedProofConfig {
    // If the config type does not match the cryptosuite type, throw CryptosuiteError
    if (config.type !== this.type) {
      throw new CryptosuiteError(
        'Type mismatch: config.type !== this.type',
        PROOF_GENERATION_ERROR, {config, suite: this.#suiteContext()}
      );
    }

    // If the cryptosuite does not match the cryptosuite name, throw CryptosuiteError
    if (config.cryptosuite !== this.cryptosuite) {
      throw new CryptosuiteError(
        'Cryptosuite mismatch: config.cryptosuite !== this.cryptosuite',
        PROOF_GENERATION_ERROR, {config, suite: this.#suiteContext()},
      );
    }

    // Step 3: a created value that is set must be an XML Schema dateTime (also '' and 5).
    if(config.created !== undefined && !DateUtils.isValidXsdDateTime(config.created)) {
      throw new CryptosuiteError(
        'Invalid config: "created" must be a valid XMLSchema DateTime string',
        PROOF_GENERATION_ERROR, { created: config.created }
      );
    }

    // The other steps of "Proof Configuration" raise PROOF_GENERATION_ERROR; its JCS step does too.
    try {
      return canonicalize(config);
    } catch(error) {
      if(!(error instanceof CanonicalizationError)) throw error;
      throw new CryptosuiteError(
        `Invalid config: ${error.message}`,
        PROOF_GENERATION_ERROR, { cause: { type: error.type, message: error.message } }
      );
    }
  }

  /**
   * Serialize the proof into a byte array.
   * @param {HashBytes} hash The canonicalized proof configuration.
   * @param {DataIntegrityProofOptions} config The config to use when serializing the proof.
   * @returns {SignatureBytes} The serialized proof.
   * @throws {CryptosuiteError} if the multikey does not match the verification method.
   */
  proofSerialization(hash: HashBytes, config: DataIntegrityProofOptions): SignatureBytes {
    // Check if the verification method from the config does not match the multikey fullId
    if (config.verificationMethod !== this.multikey.fullId()) {
      // Throw CryptosuiteError
      throw new CryptosuiteError(
        'Id mismatch: config.verificationMethod !== this.multikey.fullId()',
        PROOF_SERIALIZATION_ERROR, {config, suite: this.#suiteContext()}
      );
    }

    // Return the signed hash
    return this.multikey.sign(hash);
  }

  /**
   * Verify the proof by comparing the hash of the proof configuration and document to the proof bytes.
   * @param {HashBytes} hash The canonicalized proof configuration and document hash.
   * @param {SignatureBytes} signature The proof bytes to verify against.
   * @param {DataIntegrityProofOptions} config The config to use when verifying the proof.
   * @returns {boolean} True if the proof is verified, false otherwise.
   * @throws {CryptosuiteError} if the multikey does not match the verification method.
   */
  proofVerification(
    hash: HashBytes,
    signature: SignatureBytes,
    config: DataIntegrityProofOptions
  ): boolean {
    // If the config verification method !== the multikey fullId, throw CryptosuiteError
    if (config.verificationMethod !== this.multikey.fullId()) {
      throw new CryptosuiteError(
        `Id mismatch: config.verificationMethod !== this.multikey.fullId()`,
        PROOF_VERIFICATION_ERROR, {config, suite: this.#suiteContext()}
      );
    }

    // Return the verified hashData and signedProof
    return this.multikey.verify(signature, hash);
  }
}
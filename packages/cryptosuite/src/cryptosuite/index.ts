import {
  MethodError,
  CanonicalizedProofConfig,
  CryptosuiteError,
  DidUpdateInvocation,
  HashBytes,
  Proof,
  PROOF_GENERATION_ERROR,
  PROOF_SERIALIZATION_ERROR,
  PROOF_VERIFICATION_ERROR,
  ProofOptions,
  SignatureBytes
} from '@did-btcr2/common';
import { sha256 } from '@noble/hashes/sha2';
import { base58btc } from 'multiformats/bases/base58';
import { DataIntegrityProof } from '../data-integrity-proof/index.js';
import { SchnorrMultikey } from '../multikey/index.js';
import {
  CreateProofParams,
  GenerateHashParams,
  ICryptosuite,
  ProofSerializationParams,
  ProofVerificationParams,
  TransformDocumentParams,
  VerificationResult
} from './interface.js';

export interface CryptosuiteParams {
  type?: 'DataIntegrityProof';
  cryptosuite: 'bip340-jcs-2025' | 'bip340-rdfc-2025';
  multikey: SchnorrMultikey;
}

/**
 * Implements {@link https://dcdpr.github.io/data-integrity-schnorr-secp256k1/#instantiate-cryptosuite | 3.1 Instantiate Cryptosuite}
 *
 * The Instantiate Cryptosuite algorithm is used to configure a cryptographic suite to be used by the Add Proof and
 * Verify Proof functions in Verifiable Credential Data Integrity 1.0. The algorithm takes an options object
 * (map options) as input and returns a cryptosuite instance (struct cryptosuite).
 *
 * 1) Initialize cryptosuite to an empty struct.
 * 2) If options.type does not equal DataIntegrityProof, return cryptosuite.
 * 3) If options.cryptosuite is bip340-rdfc-2025:
 *    3.1) Set cryptosuite.createProof to the algorithm in Section 3.2.1 Create Proof (bip340-rdfc-2025).
 *    3.2) Set cryptosuite.verifyProof to the algorithm in Section 3.2.2 Verify Proof (bip340-rdfc-2025).
 * 4) If options.cryptosuite is bip340-jcs-2025:
 *    4.2) Set cryptosuite.createProof to the algorithm in Section 3.3.1 Create Proof (bip340-jcs-2025).
 *    4.3) Set cryptosuite.verifyProof to the algorithm in Section 3.3.2 Verify Proof (bip340-jcs-2025).
 * 5) Return cryptosuite.

 * @class Cryptosuite
 * @type {Cryptosuite}
 */
export class Cryptosuite implements ICryptosuite {
  /**
   * The type of the proof
   * @type {'DataIntegrityProof'} The type of proof produced by the Cryptosuite
   */
  public type: 'DataIntegrityProof' = 'DataIntegrityProof';

  /**
   * The name of the cryptosuite
   * @public
   * @type {string} The name of the cryptosuite
   */
  public cryptosuite: 'bip340-jcs-2025' | 'bip340-rdfc-2025';

  /**
   * The multikey used to sign and verify proofs
   * @public
   * @type {SchnorrMultikey} The multikey used to sign and verify proofs
   */
  public multikey: SchnorrMultikey;

  /**
   * The algorithm used for canonicalization
   * @public
   * @type {string} The algorithm used for canonicalization
   */
  public algorithm: 'rdfc' | 'jcs';

  /**
   * Constructs an instance of Cryptosuite.
   * @param {CryptosuiteParams} params See {@link CryptosuiteParams} for required parameters to create a cryptosuite.
   * @param {string} params.cryptosuite The name of the cryptosuite.
   * @param {SchnorrMultikey} params.multikey The parameters to create the multikey.
   */
  constructor({ cryptosuite, multikey }: CryptosuiteParams) {
    this.cryptosuite = cryptosuite;
    this.multikey = multikey;
    this.algorithm = cryptosuite.includes('rdfc') ? 'rdfc' : 'jcs';
    JSON.canonicalization.algorithm = this.algorithm;
  }

  /**
   * Constructs an instance of DataIntegrityProof from the current Cryptosuite instance.
   * @public
   * @returns {DataIntegrityProof} A new DataIntegrityProof instance.
   */
  public toDataIntegrityProof(): DataIntegrityProof {
    const cryptosuite = new Cryptosuite({
      cryptosuite : this.cryptosuite,
      multikey    : this.multikey
    });
    return new DataIntegrityProof(cryptosuite);
  }

  /**
   * Create a proof for an insecure document.
   * @param {CreateProofParams} params See {@link CreateProofParams} for details.
   * @param {DidUpdatePayload} params.document The document to create a proof for.
   * @param {ProofOptions} params.options The options to use when creating the proof.
   * @returns {Proof} The proof for the document.
   */
  public async createProof({ document, options }: CreateProofParams): Promise<Proof> {
    // Get the context from the document
    const context = document['@context'];

    // If a context exists, add it to the proof
    const proof = (
      context
        ? { ...options, '@context': context }
        : options
    ) as Proof;

    // Create a canonical form of the proof configuration
    const canonicalConfig = await this.proofConfiguration(proof);

    // Transform the document into a canonical form
    const canonicalDocument = await this.transformDocument({ document, options });

    // Generate a hash of the canonical proof configuration and canonical document
    const hash = this.generateHash({ canonicalConfig, canonicalDocument });

    // Serialize the proof
    const serialized = this.proofSerialization({ hash, options });

    // Encode the proof bytes to base
    proof.proofValue = base58btc.encode(serialized);

    // Set the cryptosuite and type in the proof
    if(this.cryptosuite.includes('rdfc')) {
      (proof as any)['@type'] = this.type;
    } else {
      (proof as any).type = this.type;
    }

    // Return the proof
    return proof as Proof;
  }

  /**
   * Verify a proof for a secure document.
   * Implements {@link ICryptosuite.verifyProof | ICryptosuite Method verifyProof}.
   * @param {DidUpdateInvocation} document The secure document to verify.
   * @returns {VerificationResult} The result of the verification.
   */
  public async verifyProof(document: DidUpdateInvocation): Promise<VerificationResult> {
    // Create an insecure document from the secure document by removing the proof
    const payload = { ...document, proof: undefined };

    // Create a copy of the proof options removing the proof value
    const options = { ...document.proof, proofValue: undefined };

    // Transform the newly insecured document to canonical form
    const canonicalDocument = await this.transformDocument({ document: payload, options });

    // Canonicalize the proof options to create a proof configuration
    const canonicalConfig = await this.proofConfiguration(options);

    // Generate a hash of the canonical insecured document and the canonical proof configuration`
    const hash = this.generateHash({ canonicalConfig, canonicalDocument });

    // Decode the secure document proofValue from base58btc to bytes
    const signature = base58btc.decode(document.proof.proofValue);

    // Verify the hashed data against the proof bytes
    const verified = this.proofVerification({ hash, signature, options });

    // Return the verification resul
    return { verified, verifiedDocument: verified ? document : undefined };
  }

  /**
   * Transform a document (secure didUpdateInvocation or insecure didUpdatePayload) into canonical form.
   * @param {TransformDocumentParams} params See {@link TransformDocumentParams} for details.
   * @param {DocumentParams} params.document The document to transform: secure or insecure.
   * @param {ProofOptions} params.options The options to use when transforming the proof.
   * @returns {string} The canonicalized document.
   * @throws {MethodError} if the document cannot be transformed.
   */
  public async transformDocument({ document, options }: TransformDocumentParams): Promise<string> {
    // Get the type from the options and check:
    // If the options type does not match this type, throw error
    const type = options.type;
    if (type !== this.type) {
      throw new MethodError(
        `Type mismatch between config and this: ${type} !== ${this.type}`,
        PROOF_VERIFICATION_ERROR,
        options
      );
    }

    // Get the cryptosuite from the options and check:
    // If the options cryptosuite does not match this cryptosuite, throw error
    const { cryptosuite } = options;
    if (cryptosuite !== this.cryptosuite) {
      throw new MethodError(
        `Cryptosuite mismatch between config and this: ${cryptosuite} !== ${this.cryptosuite}`,
        PROOF_VERIFICATION_ERROR,
        options
      );
    }

    // Return the canonicalized document
    return await JSON.canonicalization.canonicalize(document);
  }

  /**
   * Generate a hash of the canonical proof configuration and document.
   * @param {GenerateHashParams} params See {@link GenerateHashParams} for details.
   * @param {string} params.canonicalConfig The canonicalized proof configuration.
   * @param {string} params.canonicalDocument The canonicalized document.
   * @returns {HashHex} The hash string of the proof configuration and document.
   */
  public generateHash({ canonicalConfig, canonicalDocument }: GenerateHashParams): HashBytes {
    // Convert the canonical proof config to buffer and sha256 hash it
    const configHash = sha256(Buffer.from(canonicalConfig, 'utf-8'));

    // Convert the canonical document to buffer and sha256 hash it
    const documentHash = sha256(Buffer.from(canonicalDocument, 'utf-8'));

    // Concatenate the hashes
    const combinedHash = Buffer.concat([configHash, documentHash]);

    // sha256 hash the combined hashes and return
    return sha256(combinedHash);
  }

  /**
   * Configure the proof by canonicalzing it.
   * @param {ProofOptions} options The options to use when transforming the proof.
   * @returns {string} The canonicalized proof configuration.
   * @throws {MethodError} if the proof configuration cannot be canonicalized.
   */
  public async proofConfiguration(options: ProofOptions): Promise<CanonicalizedProofConfig> {
    // Get the type from the options
    const type = options.type;

    // If the type does not match the cryptosuite type, throw
    if (type !== this.type) {
      throw new CryptosuiteError(`Mismatch "type" between config and this: ${type} !== ${this.type}`, PROOF_GENERATION_ERROR);
    }

    // If the cryptosuite does not match the cryptosuite name, throw
    if (options.cryptosuite !== this.cryptosuite) {
      const message = `Mismatch on "cryptosuite" in config and this: ${options.cryptosuite} !== ${this.cryptosuite}`;
      throw new CryptosuiteError(message, PROOF_GENERATION_ERROR);
    }

    // TODO: check valid XMLSchema DateTime
    if(options.created) {
      console.info('TODO: check valid XMLSchema DateTime');
    }

    return await JSON.canonicalization.canonicalize(options);
  }

  /**
   * Serialize the proof into a byte array.
   * @param {ProofSerializationParams} params See {@link ProofSerializationParams} for details.
   * @param {HashBytes} params.hash The canonicalized proof configuration.
   * @param {ProofOptions} params.options The options to use when serializing the proof.
   * @returns {SignatureBytes} The serialized proof.
   * @throws {MethodError} if the multikey does not match the verification method.
   */
  public proofSerialization({ hash, options }: ProofSerializationParams): SignatureBytes {
    // Get the verification method from the options
    const vm = options.verificationMethod;
    // Get the multikey fullId
    const fullId = this.multikey.fullId();
    // If the verification method does not match the multikey fullId, throw an error
    if (vm !== fullId) {
      throw new CryptosuiteError(`Mismatch on "fullId" in options and multikey: ${fullId} !== ${vm}`, PROOF_SERIALIZATION_ERROR);
    }
    // Return the signed hash
    return this.multikey.sign(hash);
  }

  /**
   * Verify the proof by comparing the hash of the proof configuration and document to the proof bytes.
   * @param {ProofVerificationParams} params See {@link ProofVerificationParams} for details.
   * @param {HashBytes} params.hash The canonicalized proof configuration.
   * @param {SignatureBytes} params.signature The serialized proof.
   * @param {ProofOptions} params.options The options to use when verifying the proof.
   * @returns {boolean} True if the proof is verified, false otherwise.
   * @throws {MethodError} if the multikey does not match the verification method.
   */
  public proofVerification({ hash, signature, options }: ProofVerificationParams): boolean {
    // Get the verification method from the options
    const vm = options.verificationMethod;
    // Get the multikey fullId
    const fullId = this.multikey.fullId();
    // If the verification method does not match the multikey fullId, throw an error
    if (vm !== fullId) {
      throw new CryptosuiteError(`Mismatch on "fullId" in options and multikey: ${fullId} !== ${vm}`, PROOF_VERIFICATION_ERROR);
    }
    // Return the verified hashData and signedProof
    return this.multikey.verify(signature, hash);
  }
}
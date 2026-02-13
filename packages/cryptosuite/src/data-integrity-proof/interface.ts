import { JsonPatch } from '@did-btcr2/common';
import { Cryptosuite, VerificationResult } from '../cryptosuite/interface.js';

export type BTCR2Update = UnsignedBTCR2Update | SignedBTCR2Update;

/**
 * A {@link https://dcdpr.github.io/did-btcr2/terminology.html#btcr2-update | BTCR2 Update} without a data integrity proof.
 * See {@link https://dcdpr.github.io/did-btcr2/data-structures.html#btcr2-unsigned-update | BTCR2 Unsigned Update (data structure)}.
 */
export interface UnsignedBTCR2Update {
    /**
     * JSON-LD context URIs for interpreting this payload, including contexts
     * for ZCAP (capabilities), Data Integrity proofs, and JSON-LD patch ops.
     */
    '@context': string[];

    /**
     * A JSON Patch (or JSON-LD Patch) object defining the mutations to apply to
     * the DID Document. Applying this patch to the current DID Document yields
     * the new DID Document (which must remain valid per DID Core spec).
     */
    patch: JsonPatch;

    /**
     * The multihash of the current (source) DID Document, encoded as a multibase
     * base58-btc string. This is a SHA-256 hash of the canonicalized source DID
     * Document, used to ensure the patch is applied to the correct document state.
     */
    sourceHash: string;

    /**
     * The multihash of the updated (target) DID Document, encoded as multibase
     * base58-btc. This is the SHA-256 hash of the canonicalized
     * DID Document after applying the patch, used to verify the update result.
     */
    targetHash: string;

    /**
     * The version number of the DID Document after this update.
     * It is equal to the previous document version + 1.
     */
    targetVersionId: number;
}

/**
 * A {@link https://dcdpr.github.io/did-btcr2/terminology.html#btcr2-signed-update | BTCR2 Update} with a data integrity proof.
 * See {@link https://dcdpr.github.io/did-btcr2/data-structures.html#btcr2-signed-update | BTCR2 Signed Update (data structure)}.
 */
export interface SignedBTCR2Update extends UnsignedBTCR2Update {
 /**
  * A digital signature added to a BTCR2 Unsigned Update in order to convert to a BTCR2 Signed Update.
  */
  proof: DataIntegrityProofObject;
}

/**
 * A {@link https://dcdpr.github.io/did-btcr2/data-structures.html#data-integrity-config | Data Integrity Config}
 * used when adding a Data Integrity Proof to a BTCR2 Unsigned Update.
 *
 * See Verifiable Credential Data Integrity section {@link https://w3c.github.io/vc-data-integrity/#proofs | 2.1 Proofs}
 * or BIP340 Cryptosuite section {@link https://dcdpr.github.io/data-integrity-schnorr-secp256k1/#dataintegrityproof | 2.2.1 DataIntegrityProof}
 * for more information.
 */
export interface DataIntegrityConfig {
  /**
   * JSON-LD context URIs for interpreting this payload, including contexts
   * for ZCAP (capabilities), Data Integrity proofs, and JSON-LD patch ops.
   */
  '@context': string[];

  /**
   * The proof type, e.g. "DataIntegrityProof".
   */
  type: 'DataIntegrityProof';

  /**
   * The purpose of the proof, which the spec sets to "capabilityInvocation".
   */
  proofPurpose: string;

  /**
   * The means and information needed to verify the proof.
   */
  verificationMethod: string;

  /**
   * The cryptographic suite used, e.g. "bip-340-jcs-2025".
   */
  cryptosuite: string;

  /**
   * The root capability being invoked, e.g. `urn:zcap:root:<urlencoded-did>`
   */
  capability?: string;

  /**
   * The action performed under the capability—set to "Write" in the spec
   * for DID document updates.
   */
  capabilityAction?: string;

  /**
   * The date and time the proof was created
   */
  created?: string;

  /**
   * The date and time the proof expires
   */
  expires?: string;

  /**
   * Conveys one or more security domains in which the proof is meant to be used.
   */
  domain?: string | string[];

  /**
   * Should be included if a domain is included, used once for a particular domain and window of time.
   */
  challenge?: string;
}

/**
 * A {@link https://dcdpr.github.io/did-btcr2/terminology.html#data-integrity-proof | Data Integrity Proof}
 * added to a BTCR2 Unsigned Update.
 *
 * See Verifiable Credential Data Integrity section {@link https://w3c.github.io/vc-data-integrity/#proofs | 2.1 Proofs}
 * or BIP340 Cryptosuite section {@link https://dcdpr.github.io/data-integrity-schnorr-secp256k1/#dataintegrityproof | 2.2.1 DataIntegrityProof}
 * for more information.
 */
export interface DataIntegrityProofObject extends DataIntegrityConfig {
  /**
   * The cryptographic signature value. The exact property name may be defined
   * by the cryptosuite (for instance, `proofValue` for a raw signature) and
   * contains the actual signature bytes in an encoded form.
   */
  proofValue: string;
}

/**
 * Interface representing a BIP-340 DataIntegrityProof.
 * @interface DataIntegrityProof
 * @type {DataIntegrityProof}
 */
export interface DataIntegrityProof {
  /**
   * Cryptosuite class object
   */
  cryptosuite: Cryptosuite;

  /**
   * Add a proof to a document.
   * @param {BTCR2Update} document The document to add a proof to.
   * @param {DataIntegrityConfig} config The config to use when adding the proof.
   * @returns {SignedBTCR2Update} The document with the added proof.
   */
  addProof(document: BTCR2Update,config: DataIntegrityConfig): SignedBTCR2Update;

  /**
   * Verify a proof.
   * @param {string} document The document to verify.
   * @param {string} expectedPurpose The expected purpose of the proof.
   * @param {string} mediaType The media type of the document.
   * @param {string[]} expectedDomain The expected domain of the proof.
   * @param {string} expectedChallenge The expected challenge of the proof.
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
import { JsonPatch, UnixTimestamp } from '@did-btcr2/common';
import { DidResolutionOptions } from '@web5/dids';
import { DidDocument } from '../utils/did-document.js';
import { SidecarData } from './types.js';

export interface RootCapability {
    '@context': string;
    id: string;
    controller: string;
    invocationTarget: string;
}
export interface ReadBlockchainParams {
  contemporaryDidDocument: DidDocument;
  contemporaryBlockHeight: number | 1;
  currentVersionId: number | 1;
  targetVersionId?: number;
  targetBlockHeight: number;
  updateHashHistory: string[];
  sidecar?: SidecarData;
  options?: ResolutionOptions;
}


/**
 * See {@link https://www.w3.org/TR/did-1.0/#did-resolution-options | ResolutionOptions} for the specification details.
 * See {@link https://dcdpr.github.io/did-btcr2/data-structures.html#resolution-options-example-panel-show | Resolution Options}
 * for data structure details.
 */
export interface ResolutionOptions extends DidResolutionOptions {
  /**
   * Optional ASCII string representation of the specific version of a DID document
   * to be resolved.
   */
  versionId?: string

  /**
   * Optional XML Datetime normalized to UTC without sub-second decimal precision.
   * The DID document to be resolved is the most recent version of the DID document
   * that was valid for the DID before the specified versionTime.
   */
  versionTime?: UnixTimestamp;

  /**
   * See {@link https://dcdpr.github.io/did-btcr2/data-structures.html#sidecar-data-example-panel-show | Sidecar (data structure)}.
   */
  sidecar?: SidecarData;
}

/**
 * A {@link https://dcdpr.github.io/did-btcr2/terminology.html#btcr2-update | BTCR2 Update} without a data integrity proof.
 * See {@link https://dcdpr.github.io/did-btcr2/data-structures.html#btcr2-unsigned-update | BTCR2 Unsigned Update (data structure)}.
 */
export interface BTCR2UnsignedUpdate {
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
export interface BTCR2SignedUpdate extends BTCR2UnsignedUpdate {
 /**
  * A digital signature added to a BTCR2 Unsigned Update in order to convert to a BTCR2 Signed Update.
  */
  proof?: DataIntegrityProof;
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
  '@context'?: string[];

  /**
   * The proof type, e.g. "DataIntegrityProof".
   */
  type: string;

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
   * (Optional) Some cryptosuites or proofs may include a timestamp, domain,
   * or challenge. Although not explicitly required in the doc's steps, they
   * often appear in Data Integrity proofs and may be included as needed.
   */
  created?: string;
  domain?: string;
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
export interface DataIntegrityProof extends DataIntegrityConfig {
  /**
   * The cryptographic signature value. The exact property name may be defined
   * by the cryptosuite (for instance, `proofValue` for a raw signature) and
   * contains the actual signature bytes in an encoded form.
   */
  proofValue: string;
}

/**
 * {@link https://dcdpr.github.io/did-btcr2/terminology.html#smt-proof | SMT Proof}
 * a set of SHA-256 hashes for nodes in a Sparse Merkle Tree that together form
 * a path from a leaf in the tree to the Merkle root, proving that the leaf is in the tree.
 * See {@link https://dcdpr.github.io/did-btcr2/data-structures.html#smt-proof | SMT Proof (data structure)}.
 *
 * @example
 * ```json
 * {
 *   "id": "<< Hexadecimal of Root Hash >>",
 *   "nonce": "<< Hexadecimal of Nonce 1101 >>",
 *   "updateId": "<< Hexadecimal of hash(Data Block 1101) >>",
 *   "collapsed": "<< Hexadecimal of 0001 >>",
 *   "hashes": [
 *     "<< Hexadecimal of Hash 1110 >>",
 *     "<< Hexadecimal of Hash 1001 >>",
 *     "<< Hexadecimal of Hash 0 >>"
 *   ]
 * }
 * ```
 */
export interface SMTProof {
  /**
   * The SHA-256 hash of the root node of the Sparse Merkle Tree.
   */
  id: string;
  /**
   * Optional 256-bit nonce generated for each update. MUST be encoded as a string using the "base64url" [RFC4648] encoding.
   */
  nonce?: string;
  /**
   * Optional BTCR2 Signed Update (data structure) hashed with the JSON Document Hashing algorithm.
   */
  updateId?: string;
  /**
   * Bitmap of zero nodes within the path (see: collapsed leaves).
   */
  collapsed: string;
  /**
   * Array of SHA-256 hashes representing the sibling SMT nodes from the leaf, containing the SHA-256 hash of the BTCR2 Signed Update or the “zero identity”, to the root.
   */
  hashes: string[];
}
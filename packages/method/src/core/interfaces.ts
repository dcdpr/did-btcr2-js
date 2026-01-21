import { BitcoinNetworkConnection } from '@did-btcr2/bitcoin';
import { DidResolutionOptions } from '@web5/dids';
import { Sidecar } from './types.js';

export interface RootCapability {
    '@context': string;
    id: string;
    controller: string;
    invocationTarget: string;
}

/**
 * See {@link https://dcdpr.github.io/did-btcr2/data-structures.html#resolution-options-example-panel-show | Resolution Options}
 * for data structure details.
 */
export interface ResolutionOptionsCore extends DidResolutionOptions {
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
  versionTime?: string;

  /**
   * Data transmitted via {@link https://dcdpr.github.io/did-btcr2/data-structures.html#sidecar-data-example-panel-show | Sidecar (data structure)}.
   * Includes Singleton beacon updates, CAS announcements, and SMT proofs.
   */
  sidecar?: Sidecar;
}

/**
 * Full set of resolution options for the did:btcr2 method. See {@link ResolutionOptionsCore}
 * for the resolution options defined by the specification.
 * @extends ResolutionOptionsCore
 */
export interface ResolutionOptions extends ResolutionOptionsCore {
  /**
   * Drivers for interacting with external systems, such as the Bitcoin network.
   */
  drivers: {
    bitcoin?: BitcoinNetworkConnection;
  };

  /**
   * Flag to signal a full blockchain search for beacon signals from genesis
   * block to chain tip during resolution, instead of using an indexer.
   * @type {boolean}
   * @default false
   */
  fullBlockchainTraversal?: boolean;
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
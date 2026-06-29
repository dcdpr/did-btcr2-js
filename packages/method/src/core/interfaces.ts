import type { DidResolutionOptions } from '@web5/dids';
import type { Sidecar } from './types.js';

export interface RootCapability {
    '@context': string;
    id: string;
    controller: string;
    invocationTarget: string;
}

/**
 * See {@link https://dcdpr.github.io/did-btcr2/data-structures.html#resolution-options-example-panel-show | Resolution Options}
 * for data structure details.
 *
 * Resolution is now fully sans-I/O via the {@link Resolver} state machine.
 * External data (Bitcoin signals, CAS data) is provided through the
 * `resolver.resolve()` / `resolver.provide()` protocol.
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
  versionTime?: string;

  /**
   * Data transmitted via {@link https://dcdpr.github.io/did-btcr2/data-structures.html#sidecar-data-example-panel-show | Sidecar (data structure)}.
   * Includes Singleton beacon updates, CAS announcements, and SMT proofs.
   */
  sidecar?: Sidecar;

  /**
   * Opt-in upper bound on multi-round beacon-discovery passes. Each pass applies
   * the updates found so far, then looks for new beacon services those updates
   * added. Discovery is unbounded by default: termination is already guaranteed
   * by de-duplicating already-queried beacon addresses. Set a positive value only
   * to impose a resource guard; a non-positive value or omitting the field means
   * no limit. Exceeding a configured limit surfaces as an INTERNAL_ERROR, the
   * document is well-formed, the resolver simply stopped at the caller's limit.
   */
  maxDiscoveryRounds?: number;
}

/**
 * {@link https://dcdpr.github.io/did-btcr2/terminology.html#smt-proof | SMT Proof}
 * a set of SHA-256 hashes for nodes in a Sparse Merkle Tree that together form
 * a path from a leaf in the tree to the Merkle root, proving that the leaf is in the tree.
 * See {@link https://dcdpr.github.io/did-btcr2/data-structures.html#smt-proof | SMT Proof (data structure)}.
 *
 * All SHA-256 hash fields (`id`, `nonce`, `updateId`, `hashes`) are "base64url"
 * [RFC4648] encoded without padding (43 chars each). `collapsed` is the 256-bit
 * zero-node bitmap, also base64url no-pad (43 chars).
 *
 * @example
 * ```json
 * {
 *   "id": "q1H_iaYG0Oq6gbrycYL-r7FjUsJLnIpHDn49TLeONNA",
 *   "nonce": "99jndCBWHpZfmObXlIvRGHaPMgoQKXIETdD4H-XqryE",
 *   "updateId": "njYNViJq2OmhSw1fLfARPCj12RY3VXKGWdS3-7OQ2BE",
 *   "collapsed": "v_________________________________________8",
 *   "hashes": [
 *     "8JWXL7chPKJXwg-i9O1EFTHan_oOO_RmglDpu_ugax0"
 *   ]
 * }
 * ```
 */
export interface SMTProof {
  /**
   * base64url (no padding) SHA-256 hash of the root node of the Sparse Merkle Tree.
   */
  id: string;
  /**
   * Optional 256-bit nonce generated for each update. base64url, no padding (43 chars).
   */
  nonce?: string;
  /**
   * Optional base64url (no padding) canonical hash of the BTCR2 Signed Update.
   */
  updateId?: string;
  /**
   * base64url (no padding) bitmap of zero nodes within the path (see: collapsed
   * leaves). Bit set = empty/zero sibling; bit clear = a sibling hash is present.
   */
  collapsed: string;
  /**
   * Array of SHA-256 hashes representing the sibling SMT nodes from the leaf, containing the SHA-256 hash of the BTCR2 Signed Update or the “zero identity”, to the root.
   */
  hashes: string[];
}
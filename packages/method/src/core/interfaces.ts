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
   * The version of the DID document to resolve, as an ASCII string of an integer
   * (for example `"2"`). The versions start at `"1"`, the genesis document. The
   * resolver stops before it applies the update that yields the next version, so
   * `"1"` returns the genesis document also when updates exist. A version that the
   * history does not reach, also a version after a deactivation, fails with a
   * `ResolveError` of type `NOT_FOUND`. A value that is not an ASCII string of an
   * integer fails with `INVALID_OPTIONS`. Mutually exclusive with `versionTime`:
   * a request with both fails with `INVALID_OPTIONS`.
   */
  versionId?: string

  /**
   * An XML Datetime in UTC with the `Z` designator and no fraction (for example
   * `"2026-07-01T00:00:00Z"`), the form that DID Resolution v1 requires. The
   * resolver applies each update whose block `mediantime` (median time past) is
   * at or before this instant, and stops at the first update whose block
   * `mediantime` is after it. The boundary is inclusive. Every conformant resolver
   * reads the same `mediantime` from the block chain, so every resolver selects
   * the same version. A value in another form fails with `INVALID_OPTIONS`.
   * Mutually exclusive with `versionId`.
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

  /**
   * Minimum number of Bitcoin block confirmations a Beacon Signal transaction
   * must have before resolution processes it. A positive integer, minimum `1`.
   * Defaults to `6` ({@link DEFAULT_MIN_CONF}), the value the specification
   * mandates. A signal below the threshold is excluded from the resolution
   * as if it did not exist yet; the rest of the signals are processed. A lower
   * value shows a fresh update sooner and raises the exposure to a block
   * reorganization. The `confirmations` field of the resolution metadata
   * reports the depth of the last applied signal, so a consumer can judge it.
   * Any other value (`0`, a negative number, a fraction, `NaN`, a string)
   * fails with a `ResolveError` of type `INVALID_OPTIONS`.
   */
  minConf?: number;
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
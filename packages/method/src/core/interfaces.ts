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
 * a path from a leaf in the tree to the Merkle root. The proof shows the value of
 * the leaf at the index of the DID: an update, no update, or an empty index.
 * See {@link https://dcdpr.github.io/did-btcr2/data-structures.html#smt-proof | SMT Proof (data structure)}.
 *
 * All fields are "base64url" [RFC4648] encoded without padding. `id`, `updateId`,
 * `collapsed`, and the entries of `hashes` decode to 32 bytes (43 chars each).
 * `nonce` has any length. The presence of `nonce` and `updateId` selects the leaf
 * value that the SMT Proof Verification algorithm walks from:
 * `hash(hash(nonce) + updateId)`, `hash(hash(nonce))`, `updateId`, or the value of
 * an empty leaf.
 *
 * @example
 * ```json
 * {
 *   "id": "ZSN-lAyRpXG72aK1xLC9sAuRhFGsILupaQXxpkITJuo",
 *   "nonce": "WYVxNuwz3RBEhnJKM4LvVh2tOdXI9WRUPYqA_qa0klM",
 *   "updateId": "_YDKmjcnIkHDY6rnRwrO86id5H1Onycy7Bz62jYq6GA",
 *   "collapsed": "-_________________________________________8",
 *   "hashes": [
 *     "s-2LV-dfS-x___DBpNeH4KaBBSJj0xCSpn8ZlusZwLo"
 *   ]
 * }
 * ```
 */
export interface SMTProof {
  /**
   * base64url (no padding) SHA-256 hash of the root node of the Sparse Merkle Tree.
   * The resolver compares it to the Signal Bytes of the SMT beacon signal.
   */
  id: string;
  /**
   * Optional nonce, one for each index in each Beacon Signal, of any length.
   * base64url, no padding. Without the nonce that the DID controller used, the
   * proof of that signal cannot be verified. Absent in no-nonce mode.
   */
  nonce?: string;
  /**
   * Optional base64url (no padding) JSON Document Hash of the BTCR2 Signed Update.
   * Present when the signal announces an update for the DID. Absent when it does not.
   */
  updateId?: string;
  /**
   * base64url (no padding) 256-bit bitmap of the empty siblings on the path from
   * the leaf to the root. Bit `i` set = the sibling at level `i` is an empty subtree;
   * bit `i` clear = the next entry of `hashes` is the sibling. Bit `i` is `bitAt(i)`
   * of the decoded value, counted from the left: bit `0` is the root level, bit
   * `255` the leaf level. The number of entries in `hashes` plus the number of set
   * bits is `256`.
   */
  collapsed: string;
  /**
   * Array of the SHA-256 hashes of the non-empty sibling nodes on the path from the
   * leaf to the root, in that order.
   */
  hashes: string[];
}
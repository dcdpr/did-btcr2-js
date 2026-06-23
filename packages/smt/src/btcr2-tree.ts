import { didToIndex, inclusionLeafHash, nonInclusionLeafHash } from './btcr2-leaf.js';
import { serializeProof, type SerializedSMTProof } from './btcr2-proof.js';
import { blockHash } from './hash.js';
import { generateZeroHashProof, zeroHashRoot, type ZeroHashEntry } from './zero-hash.js';

/**
 * A single entry in a {@link BTCR2MerkleTree}.
 */
export interface TreeEntry {
  /** The DID string (used to compute the tree index). */
  did: string;
  /** 32-byte random nonce for privacy. */
  nonce: Uint8Array;
  /** Canonical bytes of the signed BTCR2 update. Absent means non-inclusion. */
  signedUpdate?: Uint8Array;
}

/**
 * did:btcr2 aggregate-beacon Sparse Merkle Tree.
 *
 * Builds the zero-hash SMT defined by the did:btcr2
 * {@link https://dcdpr.github.io/did-btcr2/algorithms.html#smt-proof-verification | SMT Proof Verification}
 * algorithm: each DID maps to a leaf at index `hash(did)`, the leaf value is
 * `hash(hash(nonce) || hash(update))`, and empty siblings contribute precomputed
 * zero-subtree hashes at every level. Produces serialized proofs verifiable by
 * the spec's verifier.
 *
 * Lifecycle: `addEntries()` -> `finalize()` -> `proof(did)`.
 */
export class BTCR2MerkleTree {
  readonly #entries = new Map<bigint, TreeEntry>();
  readonly #indexByDid = new Map<string, bigint>();
  #leaves: ZeroHashEntry[] | null = null;
  #root: Uint8Array | null = null;

  /**
   * @param _allowNonInclusion Retained for API compatibility; non-inclusion
   *   leaves are always supported (an entry without `signedUpdate`).
   */
  constructor(_allowNonInclusion = true) {
    void _allowNonInclusion;
  }

  /**
   * Add entries to the tree. May be called multiple times before
   * {@link finalize}. Duplicate DIDs (same index) throw.
   */
  addEntries(entries: TreeEntry[]): void {
    for (const entry of entries) {
      const index = didToIndex(entry.did);
      if (this.#entries.has(index)) {
        throw new RangeError(`Duplicate DID index for: ${entry.did}`);
      }
      this.#entries.set(index, entry);
      this.#indexByDid.set(entry.did, index);
    }
    this.#leaves = null;
    this.#root = null;
  }

  /**
   * Compute leaf hashes and the zero-hash root.
   * After this call, {@link rootHash} and {@link proof} become available.
   */
  finalize(): void {
    const leaves: ZeroHashEntry[] = [];
    for (const [index, entry] of this.#entries) {
      const leaf = entry.signedUpdate !== undefined
        ? inclusionLeafHash(entry.nonce, entry.signedUpdate)
        : nonInclusionLeafHash(entry.nonce);
      leaves.push({ index, leaf });
    }
    this.#leaves = leaves;
    this.#root = zeroHashRoot(leaves);
  }

  /** Root hash of the finalized tree. Throws if not finalized. */
  get rootHash(): Uint8Array {
    if (this.#root === null) throw new Error('Tree not finalized: call finalize() first');
    return this.#root;
  }

  /**
   * Get the did:btcr2 serialized proof for a DID.
   * Includes `nonce` and `updateId` metadata when available.
   */
  proof(did: string): SerializedSMTProof {
    const index = this.#indexByDid.get(did);
    if (index === undefined) throw new RangeError(`DID not in tree: ${did}`);
    if (this.#leaves === null || this.#root === null) {
      throw new Error('Tree not finalized: call finalize() first');
    }

    const entry    = this.#entries.get(index)!;
    const proof    = generateZeroHashProof(this.#leaves, index);
    const updateId = entry.signedUpdate !== undefined
      ? blockHash(entry.signedUpdate)
      : undefined;

    return serializeProof(this.#root, proof, { nonce: entry.nonce, updateId });
  }

  /** Clear computed leaves and root, keeping entries. */
  reset(): void {
    this.#leaves = null;
    this.#root = null;
  }
}

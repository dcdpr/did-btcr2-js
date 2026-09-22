import { didToIndex, leafValue } from './btcr2-leaf.js';
import { serializeProof, type SerializedSMTProof } from './btcr2-proof.js';
import { validateHash } from './hash.js';
import { generateZeroHashProof, zeroHashRoot, type ZeroHashEntry } from './zero-hash.js';

/**
 * A single entry in a {@link BTCR2MerkleTree}.
 */
export interface TreeEntry {
  /** The DID string. The tree index is `hash(did)`. */
  did: string;
  /** The nonce of this index in this signal, any length. Absent = no-nonce mode. */
  nonce?: Uint8Array;
  /** The 32-byte JSON Document Hash of the signed BTCR2 update. Absent = no update. */
  updateId?: Uint8Array;
}

/**
 * did:btcr2 aggregate-beacon Sparse Merkle Tree.
 *
 * Builds the zero-hash SMT defined by the did:btcr2
 * {@link https://dcdpr.github.io/did-btcr2/algorithms.html#smt-proof-verification | SMT Proof Verification}
 * algorithm: each DID maps to a leaf at index `hash(did)`, the leaf value is one
 * of the four arms of {@link leafValue}, selected by the `nonce` and `updateId`
 * of the entry, and empty siblings contribute precomputed zero-subtree hashes at
 * every level. An entry with no `nonce` and no `updateId` records the DID and
 * adds no leaf: the index stays empty. Produces serialized proofs verifiable by
 * the spec's verifier.
 *
 * Lifecycle: `addEntries()` -> `finalize()` -> `proof(did)`.
 */
export class BTCR2MerkleTree {
  readonly #entries = new Map<bigint, TreeEntry>();
  #leaves: ZeroHashEntry[] | null = null;
  #root: Uint8Array | null = null;

  /**
   * Add entries to the tree. May be called multiple times before
   * {@link finalize}. Duplicate DIDs (same index) throw.
   * @throws {RangeError} for a duplicate DID, or for an `updateId` that is not 32 bytes.
   */
  addEntries(entries: TreeEntry[]): void {
    for (const entry of entries) {
      if (entry.updateId !== undefined) validateHash(entry.updateId);
      const index = didToIndex(entry.did);
      if (this.#entries.has(index)) {
        throw new RangeError(`Duplicate DID index for: ${entry.did}`);
      }
      this.#entries.set(index, entry);
    }
    this.#leaves = null;
    this.#root = null;
  }

  /**
   * Compute leaf values and the zero-hash root.
   * After this call, {@link rootHash} and {@link proof} become available.
   */
  finalize(): void {
    const leaves: ZeroHashEntry[] = [];
    for (const [index, entry] of this.#entries) {
      if (entry.nonce === undefined && entry.updateId === undefined) continue;
      leaves.push({ index, leaf: leafValue(entry.nonce, entry.updateId) });
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
   * The serialized proof of a DID, a member of the tree or not. The proof carries the
   * `nonce` and `updateId` of the entry of the DID. A DID with no entry, or with an
   * entry that has neither field, gets the proof of an empty index: no `nonce`, no
   * `updateId`, and the walk starts at `cachedZero[0]`.
   */
  proof(did: string): SerializedSMTProof {
    if (this.#leaves === null || this.#root === null) {
      throw new Error('Tree not finalized: call finalize() first');
    }
    const index = didToIndex(did);
    const entry = this.#entries.get(index);
    const proof = generateZeroHashProof(this.#leaves, index);
    return serializeProof(this.#root, proof, { nonce: entry?.nonce, updateId: entry?.updateId });
  }

  /** Clear computed leaves and root, keeping entries. */
  reset(): void {
    this.#leaves = null;
    this.#root = null;
  }
}

import { didToIndex, inclusionLeafHash, nonInclusionLeafHash } from './btcr2-leaf.js';
import { serializeProof, type SerializedSMTProof } from './btcr2-proof.js';
import { blockHash } from './hash.js';
import { OptimizedSMT } from './optimized-smt.js';

/**
 * A single entry in a {@link BTCR2MerkleTree}.
 */
export interface TreeEntry {
  /** The DID string (used to compute the tree index). */
  did: string;
  /** 32-byte random nonce for privacy. */
  nonce: Uint8Array;
  /** Canonical bytes of the signed BTCR2 update. Absent → non-inclusion. */
  signedUpdate?: Uint8Array;
}

/**
 * Convenience wrapper around {@link OptimizedSMT} that handles
 * did:btcr2-specific index assignment, leaf hash construction, and proof
 * serialization.
 *
 * Lifecycle: `addEntries()` → `finalize()` → `proof(did)`.
 */
export class BTCR2MerkleTree {
  readonly #smt: OptimizedSMT;
  readonly #entries = new Map<bigint, TreeEntry>();
  readonly #indexByDid = new Map<string, bigint>();

  constructor(allowNonInclusion = true) {
    this.#smt = new OptimizedSMT(allowNonInclusion);
  }

  /**
   * Add entries to the tree. May be called multiple times before
   * {@link finalize}. Duplicate DIDs (same index) throw.
   */
  addEntries(entries: TreeEntry[]): void {
    const indexes: bigint[] = [];

    for (const entry of entries) {
      const index = didToIndex(entry.did);
      if (this.#entries.has(index)) {
        throw new RangeError(`Duplicate DID index for: ${entry.did}`);
      }
      this.#entries.set(index, entry);
      this.#indexByDid.set(entry.did, index);
      indexes.push(index);
    }

    this.#smt.add(indexes);
  }

  /**
   * Compute leaf hashes and finalize the tree.
   * After this call, {@link rootHash} and {@link proof} become available.
   */
  finalize(): void {
    for (const [index, entry] of this.#entries) {
      const leafHash = entry.signedUpdate !== undefined
        ? inclusionLeafHash(entry.nonce, entry.signedUpdate)
        : nonInclusionLeafHash(entry.nonce);
      this.#smt.setHash(index, leafHash);
    }
    this.#smt.finalize();
  }

  /** Root hash of the finalized tree. Throws if not finalized. */
  get rootHash(): Uint8Array {
    return this.#smt.rootHash;
  }

  /**
   * Get the did:btcr2 serialized proof for a DID.
   * Includes `nonce` and `updateId` metadata when available.
   */
  proof(did: string): SerializedSMTProof {
    const index = this.#indexByDid.get(did);
    if (index === undefined) throw new RangeError(`DID not in tree: ${did}`);

    const entry     = this.#entries.get(index)!;
    const smtProof  = this.#smt.proof(index);
    const updateId  = entry.signedUpdate !== undefined
      ? blockHash(entry.signedUpdate)
      : undefined;

    return serializeProof(smtProof, this.#smt.rootHash, { nonce: entry.nonce, updateId });
  }

  /** Clear hashes and proofs, keeping tree structure. Entries are preserved. */
  reset(): void {
    this.#smt.reset();
  }
}

import { BITS, HASH_BIT_LENGTH, NULL_HASH, OUTER_BIT } from './constants.js';
import { blockHash, validateHash } from './hash.js';
import { LeafNode, ParentNode, type Node } from './node.js';
import { SMTProof } from './smt-proof.js';

/**
 * Result of a single step in the finalization process.
 */
interface FinalizeStepResult {
  readonly hash      : Uint8Array;
  readonly saveProofs : (hashes: Uint8Array[]) => void;
}

/**
 * Optimized Sparse Merkle Tree.
 *
 * Lifecycle: `add()` indexes → `setHash()` per leaf → `finalize()` → `proof()`.
 * Call `reset()` to clear hashes and re-finalize with new data.
 */
export class OptimizedSMT {
  /** `2^256` — sentinel bit above the key space. Used by batch validation. */
  static readonly OUTER_BIT = OUTER_BIT;

  /** Pre-computed MSB-first bit masks for tree traversal. */
  static readonly BITS = BITS;

  readonly #allowNonInclusion: boolean;
  #root: Node | null = null;
  #rootHash: Uint8Array | null = null;
  readonly #proofs = new Map<bigint, SMTProof>();

  constructor(allowNonInclusion: boolean) {
    this.#allowNonInclusion = allowNonInclusion;
  }

  get allowNonInclusion(): boolean { return this.#allowNonInclusion; }

  /** Root hash. Throws if tree has not been finalized. */
  get rootHash(): Uint8Array {
    if (this.#rootHash === null) throw new RangeError('SMT not finalized');
    return this.#rootHash;
  }

  // -----------------------------------------------------------------------
  // Build phase
  // -----------------------------------------------------------------------

  /**
   * Add leaf indexes to the tree.
   * May be called multiple times before finalization. Duplicate indexes throw.
   */
  add(indexes: bigint[]): void {
    this.#checkNotFinalized();

    for (const index of indexes) {
      if (index < 0n || index >= OptimizedSMT.OUTER_BIT) {
        throw new RangeError('Index out of range');
      }

      const leaf = new LeafNode(index, HASH_BIT_LENGTH);

      if (this.#root === null) {
        this.#root = leaf;
        continue;
      }

      let replaceNode = (node: Node): void => { this.#root = node; };
      let node = this.#root;
      let commonIndex = 0n;
      let commonDepth = 0;
      let done = false;

      while (!done) {
        const bit = BITS[commonDepth];
        const indexBit = index & bit;
        const isLeft = indexBit === 0n;

        if (commonDepth === node.depth) {
          if (node instanceof ParentNode) {
            const parent = node;
            if (isLeft) {
              node = parent.left;
              replaceNode = (n) => { parent.left = n; };
            } else {
              node = parent.right;
              replaceNode = (n) => { parent.right = n; };
            }
          } else {
            throw new RangeError('Duplicate index');
          }
        } else if ((node.index & bit) === indexBit) {
          commonIndex |= indexBit;
          commonDepth++;
        } else {
          replaceNode(new ParentNode(
            commonIndex, commonDepth,
            isLeft ? leaf : node,
            isLeft ? node : leaf
          ));
          done = true;
        }
      }
    }
  }

  /**
   * Set the hash for a leaf at the given index.
   * The index must have been previously added via {@link add}.
   * Each leaf's hash can only be set once (until {@link reset}).
   */
  setHash(index: bigint, hash: Uint8Array): void {
    this.#checkNotFinalized();
    validateHash(hash);

    let node = this.#root;
    if (node === null) throw new RangeError('Empty SMT');

    while (node instanceof ParentNode) {
      node = (index & BITS[node.depth]) === 0n ? node.left : node.right;
    }
    if (node.index !== index) throw new RangeError('Index not found');
    node.hash = hash; // throws if already set
  }

  // -----------------------------------------------------------------------
  // Finalize phase
  // -----------------------------------------------------------------------

  /**
   * Compute root hash and generate all proofs in a single recursive pass.
   * Must be called after all hashes are set.
   */
  finalize(): void {
    if (this.#root === null) {
      this.#rootHash = NULL_HASH;
      return;
    }

    const result = this.#finalizeStep(this.#root, 0n, 0);
    this.#rootHash = result.hash;
    result.saveProofs([]);
  }

  /** Retrieve the proof for an index. Only valid after {@link finalize}. */
  proof(index: bigint): SMTProof {
    const p = this.#proofs.get(index);
    if (p === undefined) throw new RangeError('Proof not found');
    return p;
  }

  /** Clear hashes and proofs, keeping the tree structure for reuse. */
  reset(): void {
    this.#root?.reset();
    this.#rootHash = null;
    this.#proofs.clear();
  }

  /**
   * Check if the SMT has not been finalized yet.
   * @throws {Error} If the SMT has already been finalized.
   */
  #checkNotFinalized(): void {
    if (this.#rootHash !== null) throw new Error('SMT already finalized');
  }

  /**
   * Perform a single step of finalization on the given node.
   * @param {Node} node The node to finalize.
   * @param {bigint} parentConverge The convergence value from the parent node.
   * @param {number} depth The current depth in the tree.
   * @returns {FinalizeStepResult} The result of the finalization step.
   */
  #finalizeStep(node: Node, parentConverge: bigint, depth: number): FinalizeStepResult {
    const converge = parentConverge | BITS[HASH_BIT_LENGTH - depth];

    let hash: Uint8Array;
    let saveProofs: (hashes: Uint8Array[]) => void;

    if (node instanceof ParentNode) {
      const childDepth = node.depth + 1;
      const leftResult  = this.#finalizeStep(node.left, converge, childDepth);
      const rightResult = this.#finalizeStep(node.right, converge, childDepth);

      hash = blockHash(leftResult.hash, rightResult.hash);

      saveProofs = (hashes) => {
        const leftHashes  = hashes;
        const rightHashes = hashes.slice();
        leftHashes.unshift(rightResult.hash);
        rightHashes.unshift(leftResult.hash);
        leftResult.saveProofs(leftHashes);
        rightResult.saveProofs(rightHashes);
      };
    } else {
      if (node.hash === null) {
        if (!this.#allowNonInclusion) throw new RangeError('Hash missing');
        node.hash = NULL_HASH;
      }

      hash = node.hash;

      saveProofs = (hashes) => {
        this.#proofs.set(node.index, new SMTProof(converge, hashes));
      };
    }

    // Depth-byte padding when the node doesn't sit at the expected depth.
    if (node.depth !== depth) {
      const leftPad: number[]  = [];
      const rightPad: number[] = [];

      for (let i = node.depth - 1; i >= depth; i--) {
        if ((node.index & BITS[i]) === 0n) {
          rightPad.push(i);
        } else {
          leftPad.unshift(i);
        }
      }

      hash = blockHash(new Uint8Array(leftPad), hash, new Uint8Array(rightPad));
    }

    return { hash, saveProofs };
  }
}

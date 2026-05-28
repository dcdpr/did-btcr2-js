import { BITS, HASH_BIT_LENGTH, NULL_HASH, OUTER_BIT } from './constants.js';
import { blockHash, validateHash } from './hash.js';
import { LeafNode, ParentNode, type Node } from './node.js';
import { SMTProof } from './smt-proof.js';

/** Per-leaf proof data accumulated during finalization. */
interface LeafProofData {
  readonly hashes       : Uint8Array[];
  readonly parentDepths : number[];
}

/** Returned by {@link OptimizedSMT.#finalizeStep}: subtree root + per-leaf proof scaffolds. */
interface FinalizeStepResult {
  readonly hash      : Uint8Array;
  readonly proofData : Map<bigint, LeafProofData>;
}

/**
 * Optimized Sparse Merkle Tree, implementing the algorithm specified in the
 * {@link https://dcdpr.github.io/did-btcr2/appendix/optimized-smt.html | did:btcr2 spec — Optimized SMT}.
 *
 * Two structural rules (verbatim from the spec):
 * - "Node with one empty and one non-empty child: node value equals the non-empty child's value."
 * - "Node with two non-empty children: `node_value = hash(left_value + right_value)`."
 *
 * The first rule means single-child chains in the tree collapse: a leaf "lifted"
 * past empty-sibling levels keeps its own hash value at every collapsed level.
 *
 * Lifecycle: `add()` indexes → `setHash()` per leaf → `finalize()` → `proof()`.
 * Call `reset()` to clear hashes and re-finalize with new data.
 */
export class OptimizedSMT {
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
      if (index < 0n || index >= OUTER_BIT) {
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
        if (commonDepth === node.depth) {
          // Reached node level. Either descend (ParentNode) or duplicate (LeafNode).
          if (node instanceof ParentNode) {
            const parent = node;
            const isLeft = (index & BITS[commonDepth]!) === 0n;
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
        } else {
          const bit = BITS[commonDepth]!;
          const indexBit = index & bit;
          if ((node.index & bit) === indexBit) {
            commonIndex |= indexBit;
            commonDepth++;
          } else {
            const isLeft = indexBit === 0n;
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
      node = (index & BITS[node.depth]!) === 0n ? node.left : node.right;
    }
    if (node.index !== index) throw new RangeError('Index not found');
    node.hash = hash; // throws if already set
  }

  // -----------------------------------------------------------------------
  // Finalize phase
  // -----------------------------------------------------------------------

  /**
   * Compute the root hash and build per-leaf proofs in a single recursive pass.
   * Must be called after all hashes are set.
   *
   * The collapsed bitmap for each leaf is built LSB-first per the spec:
   * bit `i` corresponds to the i-th merge step from the leaf upward. A bit
   * value of `0` means a ParentNode exists at that level and the corresponding
   * sibling hash is consumed; a bit value of `1` means the level was collapsed
   * via the empty-sibling rule.
   */
  finalize(): void {
    if (this.#root === null) {
      this.#rootHash = NULL_HASH;
      return;
    }

    const result = this.#finalizeStep(this.#root);
    this.#rootHash = result.hash;

    for (const [index, data] of result.proofData) {
      const collapsed = this.#computeCollapsedBitmap(data.parentDepths);
      this.#proofs.set(index, new SMTProof(collapsed, data.hashes));
    }
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

  #checkNotFinalized(): void {
    if (this.#rootHash !== null) throw new Error('SMT already finalized');
  }

  /**
   * Recursive finalization.
   *
   * Returns the subtree root hash plus a map of (leafIndex -> proof scaffold).
   * Each ParentNode visited records itself in every descendant leaf's
   * `parentDepths` list and appends the opposite subtree's hash to that leaf's
   * `hashes` list. The collapsed bitmap is computed once at the top level
   * from each leaf's full `parentDepths` list.
   *
   * No depth-byte padding is applied: when a leaf is "lifted" past empty
   * sibling levels, the spec's "one empty / one non-empty -> non-empty's
   * value" rule means the value propagates upward unchanged.
   */
  #finalizeStep(node: Node): FinalizeStepResult {
    if (node instanceof LeafNode) {
      if (node.hash === null) {
        if (!this.#allowNonInclusion) throw new RangeError('Hash missing');
        node.hash = NULL_HASH;
      }
      const proofData = new Map<bigint, LeafProofData>();
      proofData.set(node.index, { hashes: [], parentDepths: [] });
      return { hash: node.hash, proofData };
    }

    const leftResult  = this.#finalizeStep(node.left);
    const rightResult = this.#finalizeStep(node.right);
    const parentHash  = blockHash(leftResult.hash, rightResult.hash);

    // Every leaf in the left subtree gets the right subtree's hash as a
    // sibling at this ParentNode's depth, and vice versa.
    for (const data of leftResult.proofData.values()) {
      data.hashes.push(rightResult.hash);
      data.parentDepths.push(node.depth);
    }
    for (const data of rightResult.proofData.values()) {
      data.hashes.push(leftResult.hash);
      data.parentDepths.push(node.depth);
    }

    const merged = new Map<bigint, LeafProofData>(leftResult.proofData);
    for (const [k, v] of rightResult.proofData) merged.set(k, v);

    return { hash: parentHash, proofData: merged };
  }

  /**
   * Compute a leaf's collapsed bitmap from the list of ParentNode depths on
   * its path from root.
   *
   * Encoding (LSB-first read order, per spec):
   * - bit `i` corresponds to merge step `i` from the leaf (depth `255 - i` for
   *   a full 256-level tree).
   * - bit `i` = 0 -> a ParentNode exists at depth `255 - i` (consume sibling).
   * - bit `i` = 1 -> level is collapsed (skip).
   *
   * The bitmap extends only up to the highest non-collapsed bit. The spec
   * verifier's loop terminates once the bitmap is exhausted and all siblings
   * consumed, so trailing zero bits would be redundant.
   */
  #computeCollapsedBitmap(parentDepths: number[]): bigint {
    if (parentDepths.length === 0) return 0n; // single-leaf tree -> no merges

    let maxPosition = 0;
    for (const d of parentDepths) {
      const pos = (HASH_BIT_LENGTH - 1) - d;
      if (pos > maxPosition) maxPosition = pos;
    }

    // Start with all bits set to 1 (all skip) up to and including maxPosition.
    let bitmap = (1n << BigInt(maxPosition + 1)) - 1n;
    // Clear (set to 0) each ParentNode position.
    for (const d of parentDepths) {
      const pos = (HASH_BIT_LENGTH - 1) - d;
      bitmap ^= 1n << BigInt(pos);
    }
    return bitmap;
  }
}

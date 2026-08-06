import { HASH_BIT_LENGTH, HASH_BYTE_LENGTH } from './constants.js';
import { blockHash, hashesEqual } from './hash.js';

/**
 * Zero-hash Sparse Merkle Tree, per the did:btcr2 SMT Proof Verification
 * algorithm (https://dcdpr.github.io/did-btcr2/algorithms.html#smt-proof-verification).
 *
 * This is a full-depth (256-level) SMT where empty siblings contribute a
 * precomputed "zero" subtree hash and EVERY level is hashed, distinct from a
 * collapsing/path-compressing SMT, which skips empty siblings and yields a
 * different root. The authoritative verifier walks MSB-first (`i = 255 - n`),
 * selecting `cachedZero[n]` for a set `collapsed[i]` bit or the next provided
 * sibling otherwise.
 *
 * Spec ambiguity (flagged for the spec owner): the spec's `cachedZero` seed is
 * written `z = 0` with no byte width, and the page gives the verification but not
 * the tree-construction algorithm. We seed `z` with 32 zero bytes (matching the
 * project's {@link NULL_HASH} convention) and derive a build that is provably
 * consistent with the authoritative verifier (round-trip validated). If the spec
 * later pins a different seed/encoding, only {@link CACHED_ZERO}'s seed changes.
 */

/** Tree depth: 256 levels, one per SHA-256 bit. */
const TREE_DEPTH = HASH_BIT_LENGTH;

/** Bit `position` (LSB = 0) of a 256-bit index. */
function bitAt(index: bigint, position: number): number {
  return Number((index >> BigInt(position)) & 1n);
}

/**
 * Precomputed empty-subtree ("zero") hashes by height.
 * `z = 0` (32 zero bytes); `cachedZero[h] = hash(z||z)` applied `h + 1` times.
 * Index range `[0, 256]`: `[0, 255]` are consumed by the verifier walk
 * (`cachedZero[n]`), and `[256]` is the all-empty tree root used by the builder.
 */
export const CACHED_ZERO: readonly Uint8Array[] = (() => {
  const arr: Uint8Array[] = new Array(TREE_DEPTH + 1);
  // Explicit `Uint8Array` annotation: TS 5.9+ would otherwise infer
  // `Uint8Array<ArrayBuffer>` from the initializer and reject reassignment
  // from `blockHash` (typed `Uint8Array<ArrayBufferLike>`).
  let z: Uint8Array = new Uint8Array(HASH_BYTE_LENGTH);
  for (let h = 0; h <= TREE_DEPTH; h++) {
    z = blockHash(z, z);
    arr[h] = z;
  }
  return arr;
})();

/** A leaf: a 256-bit index (from `didToIndex`) and its 32-byte leaf hash. */
export interface ZeroHashEntry {
  readonly index: bigint;
  readonly leaf: Uint8Array;
}

/** A zero-hash inclusion proof: the empty-sibling bitmap plus the real siblings. */
export interface ZeroHashProof {
  /** Bit `i` set = the sibling at level `i` is empty (use `cachedZero`). */
  readonly collapsed: bigint;
  /** Real sibling hashes, in leaf-to-root order (one per clear `collapsed` bit). */
  readonly hashes: readonly Uint8Array[];
}

/**
 * A compressed-trie branch node. Only divergence points are materialized:
 * levels where a subtree has a single occupant contribute `CACHED_ZERO`
 * siblings and are lifted through on demand, so the structure holds at most
 * `2n - 1` branches for `n` leaves instead of all `256n` path nodes.
 */
interface TrieBranch {
  /** Subtree height spanned by this branch; it splits on bit `TREE_DEPTH - height`. */
  height : number;
  /** Representative leaf index: every leaf in this subtree shares its bits below `TREE_DEPTH - height`. */
  rep    : bigint;
  left   : TrieNode;
  right  : TrieNode;
  /** Memoized subtree hash at this branch's own height. */
  hash?  : Uint8Array;
}

type TrieNode = ZeroHashEntry | TrieBranch;

function isBranch(node: TrieNode): node is TrieBranch {
  return (node as TrieBranch).left !== undefined;
}

/**
 * The lowest bit position at which `a` and `b` differ (the first divergence
 * in root-to-leaf order, since the root splits on the LSB). Returns
 * `TREE_DEPTH` when the indices are equal.
 */
function lowestDifferingBit(a: bigint, b: bigint): number {
  let x = a ^ b;
  let p = 0;
  while (x !== 0n && (x & 1n) === 0n) { x >>= 1n; p++; }
  return x === 0n ? TREE_DEPTH : p;
}

/**
 * Hash of `node`'s subtree viewed at `slotHeight`, lifting through the empty
 * sibling chain for any compressed solo levels. Branch hashes are computed
 * once and memoized; lifts are cheap chains of `blockHash(x, CACHED_ZERO[h])`
 * with the side determined by the shared prefix bits (audit M12).
 */
function nodeHash(node: TrieNode, slotHeight: number): Uint8Array {
  let acc: Uint8Array;
  let rep: bigint;
  let fromHeight: number;
  if (isBranch(node)) {
    node.hash ??= blockHash(
      nodeHash(node.left, node.height - 1),
      nodeHash(node.right, node.height - 1),
    );
    acc = node.hash;
    rep = node.rep;
    fromHeight = node.height;
  } else {
    acc = node.leaf;
    rep = node.index;
    fromHeight = 0;
  }
  for (let h = fromHeight + 1; h <= slotHeight; h++) {
    const bit = TREE_DEPTH - h;
    acc = bitAt(rep, bit) === 1
      ? blockHash(CACHED_ZERO[h - 1]!, acc)
      : blockHash(acc, CACHED_ZERO[h - 1]!);
  }
  return acc;
}

/** Insert `entry` into the subtree rooted at `node`. */
function insertNode(node: TrieNode | undefined, entry: ZeroHashEntry): TrieNode {
  if (node === undefined) return entry;
  const rep = isBranch(node) ? node.rep : node.index;
  if (entry.index === rep) throw new RangeError('Duplicate leaf index');
  const nodeHeight = isBranch(node) ? node.height : 0;
  const p = lowestDifferingBit(entry.index, rep);
  if (p < TREE_DEPTH - nodeHeight) {
    // The entry diverges above this node's own split: fork a new branch here.
    const branch: TrieBranch = {
      height : TREE_DEPTH - p,
      rep    : entry.index,
      left   : bitAt(entry.index, p) === 0 ? entry : node,
      right  : bitAt(entry.index, p) === 0 ? node : entry,
    };
    return branch;
  }
  // The entry belongs inside this branch (a leaf with a distinct index always
  // diverges below TREE_DEPTH and takes the fork path above).
  const branch = node as TrieBranch;
  const bit = TREE_DEPTH - branch.height;
  if (bitAt(entry.index, bit) === 0) {
    branch.left = insertNode(branch.left, entry);
  } else {
    branch.right = insertNode(branch.right, entry);
  }
  return branch;
}

/**
 * A persistent zero-hash Sparse Merkle Tree (audit M12).
 *
 * The naive formulation recomputed the sibling set of every level from
 * scratch per proof: O(256^2 * n) bit operations plus full subtree rehashing
 * for each of the 256 levels of each proof. This structure builds a
 * compressed trie once (O(256 * n) hashes, dominated by the unavoidable
 * full-depth zero-hash chains) and then answers proofs by a single 256-level
 * walk with memoized subtree hashes, so generating proofs for every member
 * of a large cohort is no longer quadratic in the tree depth per proof.
 *
 * Construct with {@link ZeroHashTree.fromLeaves}; read {@link root} and call
 * {@link proof} as needed.
 */
export class ZeroHashTree {
  readonly #rootNode: TrieNode | undefined;
  readonly #rootHash: Uint8Array;

  private constructor(rootNode: TrieNode | undefined) {
    this.#rootNode = rootNode;
    this.#rootHash = rootNode === undefined
      ? CACHED_ZERO[TREE_DEPTH]!
      : nodeHash(rootNode, TREE_DEPTH);
  }

  /** Build a tree from a set of leaves, hashing every subtree once. */
  static fromLeaves(leaves: readonly ZeroHashEntry[]): ZeroHashTree {
    let root: TrieNode | undefined;
    for (const entry of leaves) {
      root = insertNode(root, entry);
    }
    return new ZeroHashTree(root);
  }

  /** The zero-hash Merkle root. */
  get root(): Uint8Array {
    return this.#rootHash;
  }

  /**
   * Generate the inclusion (or non-inclusion) proof for `targetIndex` by
   * walking the compressed trie once: at each level the sibling is the
   * off-path child of a materialized branch, or `CACHED_ZERO` across
   * compressed solo levels. `targetIndex` need not be present in the tree.
   */
  proof(targetIndex: bigint): ZeroHashProof {
    // sibling[h] is the sibling hash at level h, or null when the sibling is
    // empty (the collapsed bit). Collected root-to-leaf, emitted leaf-to-root.
    const siblings: (Uint8Array | null)[] = new Array(TREE_DEPTH + 1).fill(null);
    let node = this.#rootNode;
    let slotHeight = TREE_DEPTH;
    while (slotHeight > 0 && node !== undefined) {
      const top = isBranch(node) ? node.height : 0;
      if (top < slotHeight) {
        // Compressed solo levels above this node's top: check whether the
        // target follows the same solo path or forks off inside the gap.
        const rep = isBranch(node) ? node.rep : node.index;
        const p = lowestDifferingBit(targetIndex, rep);
        const matchHeight = TREE_DEPTH - p;
        const stop = Math.max(top + 1, matchHeight + 1);
        for (let h = slotHeight; h >= stop; h--) siblings[h] = null;
        if (matchHeight > top) {
          // The target diverges from this subtree at matchHeight: the whole
          // subtree is the sibling there, and everything below is empty.
          siblings[matchHeight] = nodeHash(node, matchHeight - 1);
          break;
        }
        slotHeight = top;
        continue;
      }
      // A materialized branch at exactly this height: real sibling off-path.
      const branch = node as TrieBranch;
      const bit = TREE_DEPTH - branch.height;
      const goLeft = bitAt(targetIndex, bit) === 0;
      siblings[branch.height] = nodeHash(goLeft ? branch.right : branch.left, branch.height - 1);
      node = goLeft ? branch.left : branch.right;
      slotHeight = branch.height - 1;
    }

    let collapsed = 0n;
    const hashes: Uint8Array[] = [];
    for (let h = 1; h <= TREE_DEPTH; h++) {
      const sibling = siblings[h];
      if (sibling == null) {
        collapsed |= (1n << BigInt(TREE_DEPTH - h));
      } else {
        hashes.push(sibling);
      }
    }
    return { collapsed, hashes };
  }
}

/** Compute the zero-hash Merkle root for a set of leaves. */
export function zeroHashRoot(leaves: ZeroHashEntry[]): Uint8Array {
  return ZeroHashTree.fromLeaves(leaves).root;
}

/**
 * Generate the inclusion proof for `targetIndex`. At each level the sibling is
 * the subtree of leaves sharing the target's lower-bit path but diverging at this
 * level; an empty sibling sets the `collapsed` bit, a non-empty one emits a hash.
 *
 * Builds a fresh {@link ZeroHashTree} internally; callers generating more
 * than one proof over the same leaves should hold a `ZeroHashTree` instead.
 */
export function generateZeroHashProof(leaves: ZeroHashEntry[], targetIndex: bigint): ZeroHashProof {
  return ZeroHashTree.fromLeaves(leaves).proof(targetIndex);
}

/**
 * Verify an inclusion proof, exactly per the spec's SMT Proof Verification
 * pseudocode: walk `n` from 0 to 255 (`i = 255 - n`), take `cachedZero[n]` for a
 * set `collapsed[i]` or the next provided sibling, and combine by `index[i]`.
 *
 * @param candidate The leaf hash `hash(hash(nonce) || updateId)`.
 */
export function verifyZeroHash(
  collapsed: bigint,
  hashes: readonly Uint8Array[],
  index: bigint,
  candidate: Uint8Array,
  root: Uint8Array,
): boolean {
  let acc = candidate;
  let hashPtr = 0;
  for (let n = 0; n < TREE_DEPTH; n++) {
    const i = TREE_DEPTH - 1 - n;
    let sibling: Uint8Array;
    if (((collapsed >> BigInt(i)) & 1n) === 1n) {
      sibling = CACHED_ZERO[n]!;
    } else {
      if (hashPtr >= hashes.length) return false;
      sibling = hashes[hashPtr++]!;
    }
    acc = bitAt(index, i) === 1 ? blockHash(sibling, acc) : blockHash(acc, sibling);
  }
  return hashPtr === hashes.length && hashesEqual(acc, root);
}

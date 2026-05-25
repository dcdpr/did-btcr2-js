import { HASH_BIT_LENGTH, HASH_BYTE_LENGTH } from './constants.js';
import { blockHash, hashesEqual } from './hash.js';

/**
 * Zero-hash Sparse Merkle Tree, per the did:btcr2 SMT Proof Verification
 * algorithm (https://dcdpr.github.io/did-btcr2/algorithms.html#smt-proof-verification).
 *
 * This is a full-depth (256-level) SMT where empty siblings contribute a
 * precomputed "zero" subtree hash and EVERY level is hashed — distinct from a
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
  let z = new Uint8Array(HASH_BYTE_LENGTH);
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
 * Hash of the subtree spanning `height` levels (whole tree = 256, a leaf = 0).
 * An empty subtree contributes its precomputed zero hash; a single leaf is its
 * own leaf hash; otherwise split on the level's index bit and hash `left||right`.
 */
function subtreeHash(leaves: ZeroHashEntry[], height: number): Uint8Array {
  if (leaves.length === 0) return CACHED_ZERO[height];
  if (height === 0) return leaves[0]!.leaf;
  const bit = TREE_DEPTH - height;
  const left: ZeroHashEntry[] = [];
  const right: ZeroHashEntry[] = [];
  for (const e of leaves) (bitAt(e.index, bit) === 0 ? left : right).push(e);
  return blockHash(subtreeHash(left, height - 1), subtreeHash(right, height - 1));
}

/** Compute the zero-hash Merkle root for a set of leaves. */
export function zeroHashRoot(leaves: ZeroHashEntry[]): Uint8Array {
  return subtreeHash(leaves, TREE_DEPTH);
}

/**
 * Generate the inclusion proof for `targetIndex`. At each level the sibling is
 * the subtree of leaves sharing the target's lower-bit path but diverging at this
 * level; an empty sibling sets the `collapsed` bit, a non-empty one emits a hash.
 */
export function generateZeroHashProof(leaves: ZeroHashEntry[], targetIndex: bigint): ZeroHashProof {
  let collapsed = 0n;
  const hashes: Uint8Array[] = [];
  for (let height = 1; height <= TREE_DEPTH; height++) {
    const bit = TREE_DEPTH - height;
    const siblingLeaves: ZeroHashEntry[] = [];
    for (const e of leaves) {
      if (e.index === targetIndex) continue;
      let sharesLowerPath = true;
      for (let lower = 0; lower < bit; lower++) {
        if (bitAt(e.index, lower) !== bitAt(targetIndex, lower)) { sharesLowerPath = false; break; }
      }
      if (sharesLowerPath && bitAt(e.index, bit) !== bitAt(targetIndex, bit)) siblingLeaves.push(e);
    }
    if (siblingLeaves.length === 0) {
      collapsed |= (1n << BigInt(bit));
    } else {
      hashes.push(subtreeHash(siblingLeaves, height - 1));
    }
  }
  return { collapsed, hashes };
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

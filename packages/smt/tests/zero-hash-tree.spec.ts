import { expect } from 'chai';
import { randomBytes } from 'node:crypto';
import { blockHash, hashesEqual } from '../src/hash.js';
import {
  CACHED_ZERO,
  verifyZeroHash,
  ZeroHashTree,
  zeroHashRoot,
  type ZeroHashEntry,
  type ZeroHashProof,
} from '../src/zero-hash.js';

/**
 * Differential tests for the persistent {@link ZeroHashTree} (audit M12).
 *
 * The naive O(256^2 * n) formulation is reproduced here verbatim as a
 * reference oracle: every tree/proof produced by the optimized implementation
 * must be byte-for-byte identical to the oracle's output.
 */

const TREE_DEPTH = 256;

function bitAt(index: bigint, position: number): number {
  return Number((index >> BigInt(position)) & 1n);
}

/** Naive reference: per-level array partitioning with full rehashing. */
function naiveSubtreeHash(leaves: ZeroHashEntry[], height: number): Uint8Array {
  if (leaves.length === 0) return CACHED_ZERO[height]!;
  if (height === 0) return leaves[0]!.leaf;
  const bit = TREE_DEPTH - height;
  const left: ZeroHashEntry[] = [];
  const right: ZeroHashEntry[] = [];
  for (const e of leaves) (bitAt(e.index, bit) === 0 ? left : right).push(e);
  return blockHash(naiveSubtreeHash(left, height - 1), naiveSubtreeHash(right, height - 1));
}

/** Naive reference: proof by scanning all leaves at every level. */
function naiveGenerateProof(leaves: ZeroHashEntry[], targetIndex: bigint): ZeroHashProof {
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
      hashes.push(naiveSubtreeHash(siblingLeaves, height - 1));
    }
  }
  return { collapsed, hashes };
}

/** A random set of `n` distinct leaves. */
function randomLeaves(n: number): ZeroHashEntry[] {
  const leaves: ZeroHashEntry[] = [];
  const seen = new Set<bigint>();
  while (leaves.length < n) {
    const index = BigInt(`0x${randomBytes(32).toString('hex')}`);
    if (seen.has(index)) continue;
    seen.add(index);
    leaves.push({ index, leaf: randomBytes(32) });
  }
  return leaves;
}

/** Two leaves that share exactly their lowest `sharedBits` bits (stressing deep forks). */
function forkedLeaves(sharedBits: number): [ZeroHashEntry, ZeroHashEntry] {
  const a = BigInt(`0x${randomBytes(32).toString('hex')}`);
  const mask = (1n << BigInt(sharedBits)) - 1n;
  const b = (a & mask) | (~a & ~mask & ((1n << 256n) - 1n));
  if (a === b) throw new Error('degenerate');
  return [
    { index: a, leaf: randomBytes(32) },
    { index: b, leaf: randomBytes(32) },
  ];
}

describe('ZeroHashTree (audit M12)', () => {
  describe('oracle equivalence', () => {
    // [leaf count, inclusion targets to check]: the naive oracle is itself
    // quadratic per proof (that is the defect being fixed), so large sets
    // sample a few members instead of exhausting all of them.
    const cases: Array<[number, number]> = [[1, 1], [2, 2], [3, 3], [5, 5], [17, 17], [64, 64], [200, 4]];
    for (const [n, samples] of cases) {
      it(`matches the naive root and proofs for n=${n}`, () => {
        const leaves = randomLeaves(n);
        const tree = ZeroHashTree.fromLeaves(leaves);
        expect(hashesEqual(tree.root, naiveSubtreeHash(leaves, TREE_DEPTH))).to.equal(true);
        expect(hashesEqual(tree.root, zeroHashRoot(leaves))).to.equal(true);

        // Inclusion targets, sampled for large n.
        for (const e of leaves.slice(0, samples)) {
          const expected = naiveGenerateProof(leaves, e.index);
          const proof = tree.proof(e.index);
          expect(proof.collapsed).to.equal(expected.collapsed);
          expect(proof.hashes.map(h => Buffer.from(h).toString('hex')))
            .to.deep.equal(expected.hashes.map(h => Buffer.from(h).toString('hex')));
          expect(verifyZeroHash(proof.collapsed, proof.hashes, e.index, e.leaf, tree.root)).to.equal(true);
        }

        // Non-inclusion targets: random indices outside the tree.
        for (let i = 0; i < 2; i++) {
          const target = BigInt(`0x${randomBytes(32).toString('hex')}`);
          const expected = naiveGenerateProof(leaves, target);
          const proof = tree.proof(target);
          expect(proof.collapsed).to.equal(expected.collapsed);
          expect(proof.hashes.map(h => Buffer.from(h).toString('hex')))
            .to.deep.equal(expected.hashes.map(h => Buffer.from(h).toString('hex')));
        }
      });
    }

    it('matches the naive oracle for deep shared prefixes', () => {
      // Pairs sharing long prefixes exercise the compressed-gap fork logic.
      for (const sharedBits of [1, 7, 64, 128, 200, 250]) {
        const [a, b] = forkedLeaves(sharedBits);
        const leaves = [a, b];
        const tree = ZeroHashTree.fromLeaves(leaves);
        expect(hashesEqual(tree.root, naiveSubtreeHash(leaves, TREE_DEPTH))).to.equal(true);
        for (const e of leaves) {
          const expected = naiveGenerateProof(leaves, e.index);
          const proof = tree.proof(e.index);
          expect(proof.collapsed).to.equal(expected.collapsed);
          expect(proof.hashes.map(h => Buffer.from(h).toString('hex')))
            .to.deep.equal(expected.hashes.map(h => Buffer.from(h).toString('hex')));
        }
      }
    });

    it('matches the naive oracle for an empty tree', () => {
      const tree = ZeroHashTree.fromLeaves([]);
      expect(hashesEqual(tree.root, CACHED_ZERO[TREE_DEPTH]!)).to.equal(true);
      const target = BigInt(`0x${randomBytes(32).toString('hex')}`);
      const proof = tree.proof(target);
      const expected = naiveGenerateProof([], target);
      expect(proof.collapsed).to.equal(expected.collapsed);
      expect(proof.hashes).to.have.length(0);
    });

    it('throws on a duplicate leaf index', () => {
      const index = BigInt(`0x${randomBytes(32).toString('hex')}`);
      const leaves = [
        { index, leaf: randomBytes(32) },
        { index, leaf: randomBytes(32) },
      ];
      expect(() => ZeroHashTree.fromLeaves(leaves)).to.throw(RangeError, /Duplicate/);
    });

    it('rejects a proof for a different leaf at the same index', () => {
      const leaves = randomLeaves(4);
      const tree = ZeroHashTree.fromLeaves(leaves);
      const target = leaves[0]!;
      const proof = tree.proof(target.index);
      const wrongLeaf = randomBytes(32);
      expect(verifyZeroHash(proof.collapsed, proof.hashes, target.index, wrongLeaf, tree.root)).to.equal(false);
    });
  });

  describe('performance (audit M12)', () => {
    it('builds and proves a 500-member cohort well under the naive per-proof cost', () => {
      const leaves = randomLeaves(500);
      const start = performance.now();
      const tree = ZeroHashTree.fromLeaves(leaves);
      for (const e of leaves) {
        const proof = tree.proof(e.index);
        expect(verifyZeroHash(proof.collapsed, proof.hashes, e.index, e.leaf, tree.root)).to.equal(true);
      }
      const elapsed = performance.now() - start;
      // The naive formulation costs O(256^2 * n) per proof; one naive proof at
      // this size already exceeds this budget. Generous bound to stay CI-safe.
      expect(elapsed).to.be.lessThan(10_000);
    });
  });
});

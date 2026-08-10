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
 * Differential tests for the persistent {@link ZeroHashTree}.
 *
 * The naive formulation is reproduced here as a reference oracle: every
 * tree/proof produced by the optimized implementation must be byte-for-byte
 * identical to the oracle's output. The oracle memoizes subtree hashes (a
 * pure function of the leaf set and height) so the suite runs in linear
 * rather than quadratic time.
 */

const TREE_DEPTH = 256;

function bitAt(index: bigint, position: number): number {
  return Number((index >> BigInt(position)) & 1n);
}

interface NaiveOracle {
  subtreeHash(leaves: ZeroHashEntry[], height: number): Uint8Array;
  generateProof(leaves: ZeroHashEntry[], targetIndex: bigint): ZeroHashProof;
}

/** Naive reference oracle: per-level array partitioning, memoized per test. */
function makeNaiveOracle(): NaiveOracle {
  const memo = new Map<string, Uint8Array>();
  function subtreeHash(leaves: ZeroHashEntry[], height: number): Uint8Array {
    if (leaves.length === 0) return CACHED_ZERO[height]!;
    if (height === 0) return leaves[0]!.leaf;
    const key = `${height}:${leaves.map(e => e.index.toString(16).padStart(64, '0')).sort().join(',')}`;
    const cached = memo.get(key);
    if (cached) return cached;
    const bit = TREE_DEPTH - height;
    const left: ZeroHashEntry[] = [];
    const right: ZeroHashEntry[] = [];
    for (const e of leaves) (bitAt(e.index, bit) === 0 ? left : right).push(e);
    const hash = blockHash(subtreeHash(left, height - 1), subtreeHash(right, height - 1));
    memo.set(key, hash);
    return hash;
  }
  function generateProof(leaves: ZeroHashEntry[], targetIndex: bigint): ZeroHashProof {
    let collapsed = 0n;
    const hashes: Uint8Array[] = [];
    for (let height = 1; height <= TREE_DEPTH; height++) {
      const bit = TREE_DEPTH - height;
      const lowMask = (1n << BigInt(bit)) - 1n;
      const targetLow = targetIndex & lowMask;
      const targetBit = bitAt(targetIndex, bit);
      const siblingLeaves: ZeroHashEntry[] = [];
      for (const e of leaves) {
        if (e.index === targetIndex) continue;
        if ((e.index & lowMask) === targetLow && bitAt(e.index, bit) !== targetBit) siblingLeaves.push(e);
      }
      if (siblingLeaves.length === 0) {
        collapsed |= (1n << BigInt(bit));
      } else {
        hashes.push(subtreeHash(siblingLeaves, height - 1));
      }
    }
    return { collapsed, hashes };
  }
  return { subtreeHash, generateProof };
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

describe('ZeroHashTree', () => {
  describe('oracle equivalence', () => {
    // [leaf count, inclusion targets to check]: larger sets sample a subset
    // of members to bound the per-test proof count.
    const cases: Array<[number, number]> = [[1, 1], [2, 2], [3, 3], [5, 5], [17, 17], [64, 64], [200, 16]];
    for (const [n, samples] of cases) {
      it(`matches the naive root and proofs for n=${n}`, () => {
        const oracle = makeNaiveOracle();
        const leaves = randomLeaves(n);
        const tree = ZeroHashTree.fromLeaves(leaves);
        expect(hashesEqual(tree.root, oracle.subtreeHash(leaves, TREE_DEPTH))).to.equal(true);
        expect(hashesEqual(tree.root, zeroHashRoot(leaves))).to.equal(true);

        // Inclusion targets, sampled for large n.
        for (const e of leaves.slice(0, samples)) {
          const expected = oracle.generateProof(leaves, e.index);
          const proof = tree.proof(e.index);
          expect(proof.collapsed).to.equal(expected.collapsed);
          expect(proof.hashes.map(h => Buffer.from(h).toString('hex')))
            .to.deep.equal(expected.hashes.map(h => Buffer.from(h).toString('hex')));
          expect(verifyZeroHash(proof.collapsed, proof.hashes, e.index, e.leaf, tree.root)).to.equal(true);
        }

        // Non-inclusion targets: random indices outside the tree.
        for (let i = 0; i < 2; i++) {
          const target = BigInt(`0x${randomBytes(32).toString('hex')}`);
          const expected = oracle.generateProof(leaves, target);
          const proof = tree.proof(target);
          expect(proof.collapsed).to.equal(expected.collapsed);
          expect(proof.hashes.map(h => Buffer.from(h).toString('hex')))
            .to.deep.equal(expected.hashes.map(h => Buffer.from(h).toString('hex')));
        }
      });
    }

    it('matches the naive oracle for deep shared prefixes', () => {
      // Pairs sharing long prefixes exercise the compressed-gap fork logic.
      const oracle = makeNaiveOracle();
      for (const sharedBits of [1, 7, 64, 128, 200, 250]) {
        const [a, b] = forkedLeaves(sharedBits);
        const leaves = [a, b];
        const tree = ZeroHashTree.fromLeaves(leaves);
        expect(hashesEqual(tree.root, oracle.subtreeHash(leaves, TREE_DEPTH))).to.equal(true);
        for (const e of leaves) {
          const expected = oracle.generateProof(leaves, e.index);
          const proof = tree.proof(e.index);
          expect(proof.collapsed).to.equal(expected.collapsed);
          expect(proof.hashes.map(h => Buffer.from(h).toString('hex')))
            .to.deep.equal(expected.hashes.map(h => Buffer.from(h).toString('hex')));
        }
      }
    });

    it('matches the naive oracle for an empty tree', () => {
      const oracle = makeNaiveOracle();
      const tree = ZeroHashTree.fromLeaves([]);
      expect(hashesEqual(tree.root, CACHED_ZERO[TREE_DEPTH]!)).to.equal(true);
      const target = BigInt(`0x${randomBytes(32).toString('hex')}`);
      const proof = tree.proof(target);
      const expected = oracle.generateProof([], target);
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

  describe('performance', () => {
    it('builds and proves a 500-member cohort well under the naive per-proof cost', () => {
      const leaves = randomLeaves(500);
      const calibBlock = randomBytes(64);
      const calibIterations = 10_000;
      blockHash(calibBlock);
      const calibStart = performance.now();
      for (let i = 0; i < calibIterations; i++) blockHash(calibBlock);
      const perHashMs = (performance.now() - calibStart) / calibIterations;
      const budgetMs = perHashMs * leaves.length * TREE_DEPTH * 6;
      const start = performance.now();
      const tree = ZeroHashTree.fromLeaves(leaves);
      for (const e of leaves) {
        const proof = tree.proof(e.index);
        expect(verifyZeroHash(proof.collapsed, proof.hashes, e.index, e.leaf, tree.root)).to.equal(true);
      }
      const elapsed = performance.now() - start;
      // The budget is calibrated to this machine's measured blockHash
      // throughput: the optimized path (build + one proof + one verify per
      // member) costs O(leaves * TREE_DEPTH) hash operations, so the bound is
      // per-hash time * leaves * TREE_DEPTH with a 6x safety factor. The naive
      // formulation costs O(256^2 * n) per proof, roughly 40x this budget at
      // n=500, so an algorithmic regression still fails the test.
      expect(elapsed).to.be.lessThan(budgetMs);
    });
  });
});

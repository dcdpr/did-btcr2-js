import { randomBytes } from '@noble/hashes/utils';
import { expect } from 'chai';
import {
  HASH_BYTE_LENGTH,
  OptimizedSMT, SMTProof, hashToBigInt,
} from '../src/index.js';

function randomHash(): Uint8Array {
  return randomBytes(HASH_BYTE_LENGTH);
}

function randomBigInt(): bigint {
  return hashToBigInt(randomHash());
}

/** Flip the index bit at the lowest collapsed=0 (consume) position. */
function flipLowestConsumeBit(index: bigint, collapsed: bigint): bigint {
  let pos = 0n;
  let bitmap = collapsed;
  while ((bitmap & 1n) === 1n) {
    bitmap >>= 1n;
    pos++;
  }
  return index ^ (1n << pos);
}

/** Build a small tree and return an index, its hash, root hash, and proof. */
function buildSmallTree(size = 5) {
  const smt = new OptimizedSMT(false);
  const indexes: bigint[] = [];
  const hashes: Uint8Array[] = [];
  const indexSet = new Set<bigint>();
  while (indexSet.size < size) indexSet.add(randomBigInt());
  indexes.push(...indexSet);
  smt.add(indexes);
  for (const idx of indexes) {
    const h = randomHash();
    hashes.push(h);
    smt.setHash(idx, h);
  }
  smt.finalize();
  return { smt, indexes, hashes };
}

describe('SMTProof', () => {

  describe('isValid', () => {
    it('returns true for a valid proof', () => {
      const { smt, indexes, hashes } = buildSmallTree();
      const proof = smt.proof(indexes[0]);
      expect(proof.isValid(indexes[0], hashes[0], smt.rootHash)).to.be.true;
    });

    it('returns false for tampered candidate hash', () => {
      const { smt, indexes } = buildSmallTree();
      const proof = smt.proof(indexes[0]);
      expect(proof.isValid(indexes[0], randomHash(), smt.rootHash)).to.be.false;
    });

    it('returns false for index that differs at a consume position', () => {
      // Per spec, the verifier only consults index bits at collapsed-bit-0
      // positions; bits at skip positions are ignored. So we flip a known
      // consume bit to construct a guaranteed-wrong index.
      const { smt, indexes, hashes } = buildSmallTree();
      const proof = smt.proof(indexes[0]);
      const wrong = flipLowestConsumeBit(indexes[0], proof.collapsed);
      expect(proof.isValid(wrong, hashes[0], smt.rootHash)).to.be.false;
    });

    it('returns false for wrong root hash', () => {
      const { smt, indexes, hashes } = buildSmallTree();
      const proof = smt.proof(indexes[0]);
      expect(proof.isValid(indexes[0], hashes[0], randomHash())).to.be.false;
    });
  });

  describe('JSON serialization', () => {
    it('round-trips with hex encoding', () => {
      const { smt, indexes, hashes } = buildSmallTree();
      const proof = smt.proof(indexes[0]);
      const json = proof.toJSON(false);
      const restored = SMTProof.fromJSON(json, false);
      expect(restored.isValid(indexes[0], hashes[0], smt.rootHash)).to.be.true;
      expect(restored.collapsed).to.equal(proof.collapsed);
      expect(restored.hashes).to.have.lengthOf(proof.hashes.length);
    });

    it('round-trips with base64 encoding', () => {
      const { smt, indexes, hashes } = buildSmallTree();
      const proof = smt.proof(indexes[0]);
      const json = proof.toJSON(true);
      const restored = SMTProof.fromJSON(json, true);
      expect(restored.isValid(indexes[0], hashes[0], smt.rootHash)).to.be.true;
    });

    it('fromJSON throws on invalid input', () => {
      expect(() => SMTProof.fromJSON('{}')).to.throw(RangeError);
      expect(() => SMTProof.fromJSON('{"collapsed":"ff"}')).to.throw(RangeError);
    });
  });

  describe('binary serialization', () => {
    it('round-trips via toBinary / fromBinary', async () => {
      const { smt, indexes, hashes } = buildSmallTree();
      const proof = smt.proof(indexes[0]);
      const binary = proof.toBinary();
      const restored = await SMTProof.fromBinary(binary);
      expect(restored.isValid(indexes[0], hashes[0], smt.rootHash)).to.be.true;
      expect(restored.collapsed).to.equal(proof.collapsed);
      expect(restored.hashes).to.have.lengthOf(proof.hashes.length);
    });

    it('binary is compact (leading zero compression)', () => {
      // 2-leaf tree where the indices diverge well below the MSB so the
      // collapsed bitmap has many leading zero bytes that get compressed out.
      const smt = new OptimizedSMT(false);
      const idxA = 1n;
      const idxB = 3n;
      smt.add([idxA, idxB]);
      smt.setHash(idxA, randomHash());
      smt.setHash(idxB, randomHash());
      smt.finalize();
      const proof = smt.proof(idxA);
      const binary = proof.toBinary();
      expect(binary.length).to.be.lessThan(2 + HASH_BYTE_LENGTH + 1 + proof.hashes.length * HASH_BYTE_LENGTH);
    });
  });
});

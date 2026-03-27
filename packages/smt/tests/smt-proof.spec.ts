import { expect } from 'chai';
import {
  OptimizedSMT, SMTProof, hashToBigInt,
  HASH_BYTE_LENGTH,
} from '../src/index.js';

function randomHash(): Uint8Array {
  const buf = new Uint8Array(HASH_BYTE_LENGTH);
  crypto.getRandomValues(buf);
  return buf;
}

function randomBigInt(): bigint {
  return hashToBigInt(randomHash());
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

    it('returns false for wrong index', () => {
      const { smt, indexes, hashes } = buildSmallTree();
      const proof = smt.proof(indexes[0]);
      expect(proof.isValid(randomBigInt(), hashes[0], smt.rootHash)).to.be.false;
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
      expect(restored.converge).to.equal(proof.converge);
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
      expect(() => SMTProof.fromJSON('{"converge":"ff"}')).to.throw(RangeError);
    });
  });

  describe('binary serialization', () => {
    it('round-trips via toBinary / fromBinary', async () => {
      const { smt, indexes, hashes } = buildSmallTree();
      const proof = smt.proof(indexes[0]);
      const binary = proof.toBinary();
      const restored = await SMTProof.fromBinary(binary);
      expect(restored.isValid(indexes[0], hashes[0], smt.rootHash)).to.be.true;
      expect(restored.converge).to.equal(proof.converge);
      expect(restored.hashes).to.have.lengthOf(proof.hashes.length);
    });

    it('binary is compact (leading zero compression)', () => {
      const { smt, indexes } = buildSmallTree(2);
      const proof = smt.proof(indexes[0]);
      const binary = proof.toBinary();
      // For a 2-leaf tree, converge bitmap has very few bits set,
      // so most of the 32 bytes are zero and get compressed.
      expect(binary.length).to.be.lessThan(2 + HASH_BYTE_LENGTH + 1 + proof.hashes.length * HASH_BYTE_LENGTH);
    });
  });

  describe('isValidBatch', () => {
    it('validates all proofs correctly', () => {
      const { smt, indexes, hashes } = buildSmallTree(10);
      const candidates = indexes.map((idx, i) => ({
        index : idx,
        hash  : hashes[i],
        proof : smt.proof(idx),
      }));
      const results = [...SMTProof.isValidBatch(candidates, smt.rootHash)];
      expect(results).to.have.lengthOf(10);
      for (const r of results) {
        expect(r.valid).to.be.true;
      }
    });

    it('detects a single corrupted candidate', () => {
      const { smt, indexes, hashes } = buildSmallTree(10);
      const candidates = indexes.map((idx, i) => ({
        index      : idx,
        hash       : i === 5 ? randomHash() : hashes[i],
        proof      : smt.proof(idx),
        additional : i,
      }));
      const results = [...SMTProof.isValidBatch(candidates, smt.rootHash)];
      for (const r of results) {
        if (r.additional === 5) {
          expect(r.valid).to.be.false;
        } else {
          expect(r.valid).to.be.true;
        }
      }
    });

    it('passes through additional data', () => {
      const { smt, indexes, hashes } = buildSmallTree(3);
      const candidates = indexes.map((idx, i) => ({
        index      : idx,
        hash       : hashes[i],
        proof      : smt.proof(idx),
        additional : `entry-${i}`,
      }));
      const results = [...SMTProof.isValidBatch(candidates, smt.rootHash)];
      expect(results[0].additional).to.equal('entry-0');
      expect(results[1].additional).to.equal('entry-1');
      expect(results[2].additional).to.equal('entry-2');
    });
  });
});

import { expect } from 'chai';
import {
  OptimizedSMT,
  serializeProof, deserializeProof, verifySerializedProof,
  hashToBigInt, hashToHex,
  HASH_BYTE_LENGTH, HASH_HEX_LENGTH,
} from '../src/index.js';

function randomHash(): Uint8Array {
  const buf = new Uint8Array(HASH_BYTE_LENGTH);
  crypto.getRandomValues(buf);
  return buf;
}

function randomBigInt(): bigint {
  return hashToBigInt(randomHash());
}

/** Build a tree and return everything needed for proof tests. */
function buildTree(size = 5) {
  const smt = new OptimizedSMT(false);
  const indexes: bigint[] = [];
  const hashes: Uint8Array[] = [];
  const set = new Set<bigint>();
  while (set.size < size) set.add(randomBigInt());
  indexes.push(...set);
  smt.add(indexes);
  for (const idx of indexes) {
    const h = randomHash();
    hashes.push(h);
    smt.setHash(idx, h);
  }
  smt.finalize();
  return { smt, indexes, hashes };
}

describe('btcr2-proof', () => {

  describe('serializeProof / deserializeProof', () => {
    it('round-trips correctly', () => {
      const { smt, indexes } = buildTree();
      const proof = smt.proof(indexes[0]);
      const nonce = randomHash();
      const updateId = randomHash();

      const serialized = serializeProof(proof, smt.rootHash, { nonce, updateId });
      const result = deserializeProof(serialized);

      expect(result.proof.converge).to.equal(proof.converge);
      expect(result.proof.hashes).to.have.lengthOf(proof.hashes.length);
      expect(result.rootHash).to.deep.equal(smt.rootHash);
      expect(result.nonce).to.deep.equal(nonce);
      expect(result.updateId).to.deep.equal(updateId);
    });

    it('handles missing nonce and updateId', () => {
      const { smt, indexes } = buildTree();
      const proof = smt.proof(indexes[0]);
      const serialized = serializeProof(proof, smt.rootHash);
      const result = deserializeProof(serialized);

      expect(result.nonce).to.be.undefined;
      expect(result.updateId).to.be.undefined;
    });
  });

  describe('serialized format', () => {
    it('id field is 64-char padded hex', () => {
      const { smt, indexes } = buildTree();
      const proof = smt.proof(indexes[0]);
      const serialized = serializeProof(proof, smt.rootHash);
      expect(serialized.id).to.have.lengthOf(HASH_HEX_LENGTH);
      expect(serialized.id).to.match(/^[0-9a-f]{64}$/);
    });

    it('collapsed field uses unpadded hex (minimal)', () => {
      const { smt, indexes } = buildTree(2);
      const proof = smt.proof(indexes[0]);
      const serialized = serializeProof(proof, smt.rootHash);
      // For a 2-leaf tree the converge bitmap is sparse,
      // so collapsed should be shorter than 64 chars.
      expect(serialized.collapsed.length).to.be.lessThan(HASH_HEX_LENGTH);
      expect(serialized.collapsed).to.match(/^[0-9a-f]+$/);
    });

    it('hashes are 64-char padded hex', () => {
      const { smt, indexes } = buildTree();
      const proof = smt.proof(indexes[0]);
      const serialized = serializeProof(proof, smt.rootHash);
      for (const h of serialized.hashes) {
        expect(h).to.have.lengthOf(HASH_HEX_LENGTH);
        expect(h).to.match(/^[0-9a-f]{64}$/);
      }
    });

    it('nonce and updateId are 64-char hex when present', () => {
      const { smt, indexes } = buildTree();
      const proof = smt.proof(indexes[0]);
      const serialized = serializeProof(proof, smt.rootHash, {
        nonce    : randomHash(),
        updateId : randomHash(),
      });
      expect(serialized.nonce).to.have.lengthOf(HASH_HEX_LENGTH);
      expect(serialized.updateId).to.have.lengthOf(HASH_HEX_LENGTH);
    });
  });

  describe('verifySerializedProof', () => {
    it('returns true for valid proof', () => {
      const { smt, indexes, hashes } = buildTree();
      const proof = smt.proof(indexes[0]);
      const serialized = serializeProof(proof, smt.rootHash);
      expect(verifySerializedProof(serialized, indexes[0], hashes[0])).to.be.true;
    });

    it('returns false for tampered hash', () => {
      const { smt, indexes } = buildTree();
      const proof = smt.proof(indexes[0]);
      const serialized = serializeProof(proof, smt.rootHash);
      expect(verifySerializedProof(serialized, indexes[0], randomHash())).to.be.false;
    });

    it('returns false for wrong index', () => {
      const { smt, indexes, hashes } = buildTree();
      const proof = smt.proof(indexes[0]);
      const serialized = serializeProof(proof, smt.rootHash);
      expect(verifySerializedProof(serialized, randomBigInt(), hashes[0])).to.be.false;
    });

    it('returns false for tampered root hash', () => {
      const { smt, indexes, hashes } = buildTree();
      const proof = smt.proof(indexes[0]);
      const serialized = serializeProof(proof, smt.rootHash);
      serialized.id = hashToHex(randomHash());
      expect(verifySerializedProof(serialized, indexes[0], hashes[0])).to.be.false;
    });
  });
});

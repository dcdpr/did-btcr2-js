import { randomBytes } from '@noble/curves/utils.js';
import { expect } from 'chai';
import {
  deserializeProof,
  hashToBase64Url,
  HASH_BYTE_LENGTH,
  hashToBigInt,
  OptimizedSMT,
  serializeProof,
  verifySerializedProof,
} from '../src/index.js';

function randomHash(): Uint8Array {
  return randomBytes(HASH_BYTE_LENGTH);
}

function randomBigInt(): bigint {
  return hashToBigInt(randomHash());
}

/**
 * Flip the index bit at the lowest collapsed=0 (consume) position.
 * Guarantees the resulting index will fail verification: the verifier
 * consults that bit to choose merge direction, and a flip changes the
 * resulting candidate hash.
 */
function flipLowestConsumeBit(index: bigint, collapsed: bigint): bigint {
  let pos = 0n;
  let bitmap = collapsed;
  while ((bitmap & 1n) === 1n) {
    bitmap >>= 1n;
    pos++;
  }
  return index ^ (1n << pos);
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

// Per did:btcr2 spec, all SHA-256 hashes in proof structures are base64url
// without padding. A 32-byte hash encodes to 43 chars.
const HASH_B64URL_LENGTH = 43;
const B64URL_RE = /^[A-Za-z0-9_-]+$/;

describe('btcr2-proof', () => {

  describe('serializeProof / deserializeProof', () => {
    it('round-trips correctly', () => {
      const { smt, indexes } = buildTree();
      const proof = smt.proof(indexes[0]!);
      const nonce = randomHash();
      const updateId = randomHash();

      const serialized = serializeProof(proof, smt.rootHash, { nonce, updateId });
      const result = deserializeProof(serialized);

      expect(result.proof.collapsed).to.equal(proof.collapsed);
      expect(result.proof.hashes).to.have.lengthOf(proof.hashes.length);
      expect(result.rootHash).to.deep.equal(smt.rootHash);
      expect(result.nonce).to.deep.equal(nonce);
      expect(result.updateId).to.deep.equal(updateId);
    });

    it('handles missing nonce and updateId', () => {
      const { smt, indexes } = buildTree();
      const proof = smt.proof(indexes[0]!);
      const serialized = serializeProof(proof, smt.rootHash);
      const result = deserializeProof(serialized);

      expect(result.nonce).to.be.undefined;
      expect(result.updateId).to.be.undefined;
    });
  });

  describe('serialized format', () => {
    it('id field is 43-char base64urlnopad', () => {
      const { smt, indexes } = buildTree();
      const proof = smt.proof(indexes[0]!);
      const serialized = serializeProof(proof, smt.rootHash);
      expect(serialized.id).to.have.lengthOf(HASH_B64URL_LENGTH);
      expect(serialized.id).to.match(B64URL_RE);
    });

    it('collapsed field is base64urlnopad (variable length)', () => {
      const { smt, indexes } = buildTree();
      const proof = smt.proof(indexes[0]!);
      const serialized = serializeProof(proof, smt.rootHash);
      expect(serialized.collapsed).to.match(B64URL_RE);
    });

    it('hashes are 43-char base64urlnopad', () => {
      const { smt, indexes } = buildTree();
      const proof = smt.proof(indexes[0]!);
      const serialized = serializeProof(proof, smt.rootHash);
      for (const h of serialized.hashes) {
        expect(h).to.have.lengthOf(HASH_B64URL_LENGTH);
        expect(h).to.match(B64URL_RE);
      }
    });

    it('nonce and updateId are 43-char base64urlnopad when present', () => {
      const { smt, indexes } = buildTree();
      const proof = smt.proof(indexes[0]!);
      const serialized = serializeProof(proof, smt.rootHash, {
        nonce    : randomHash(),
        updateId : randomHash(),
      });
      expect(serialized.nonce).to.have.lengthOf(HASH_B64URL_LENGTH);
      expect(serialized.updateId).to.have.lengthOf(HASH_B64URL_LENGTH);
    });
  });

  describe('verifySerializedProof', () => {
    it('returns true for valid proof', () => {
      const { smt, indexes, hashes } = buildTree();
      const proof = smt.proof(indexes[0]!);
      const serialized = serializeProof(proof, smt.rootHash);
      expect(verifySerializedProof(serialized, indexes[0]!, hashes[0]!)).to.be.true;
    });

    it('returns false for tampered hash', () => {
      const { smt, indexes } = buildTree();
      const proof = smt.proof(indexes[0]!);
      const serialized = serializeProof(proof, smt.rootHash);
      expect(verifySerializedProof(serialized, indexes[0]!, randomHash())).to.be.false;
    });

    it('returns false for index that differs at a consume position', () => {
      // Per spec, the verifier only consults index bits at collapsed-bit-0
      // (consume) positions; bits at skip positions are ignored. So we must
      // flip a known-consume bit to construct a guaranteed-wrong index.
      const { smt, indexes, hashes } = buildTree();
      const proof = smt.proof(indexes[0]!);
      const serialized = serializeProof(proof, smt.rootHash);
      const wrong = flipLowestConsumeBit(indexes[0]!, proof.collapsed);
      expect(verifySerializedProof(serialized, wrong, hashes[0]!)).to.be.false;
    });

    it('returns false for tampered root hash', () => {
      const { smt, indexes, hashes } = buildTree();
      const proof = smt.proof(indexes[0]!);
      const serialized = serializeProof(proof, smt.rootHash);
      serialized.id = hashToBase64Url(randomHash());
      expect(verifySerializedProof(serialized, indexes[0]!, hashes[0]!)).to.be.false;
    });
  });
});

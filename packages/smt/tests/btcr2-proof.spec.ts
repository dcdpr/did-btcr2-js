import { randomBytes } from '@noble/curves/utils.js';
import { expect } from 'chai';
import {
  deserializeProof,
  generateZeroHashProof,
  HASH_BYTE_LENGTH,
  hashToBase64Url, hashToBigInt,
  serializeProof,
  verifySerializedProof,
  zeroHashRoot,
  type ZeroHashEntry,
} from '../src/index.js';

/** base64url (no padding) length of a 32-byte hash, and its charset. */
const HASH_B64URL_LENGTH = 43;
const B64URL_RE = /^[A-Za-z0-9_-]+$/;

function randomHash(): Uint8Array {
  return randomBytes(HASH_BYTE_LENGTH);
}

function randomBigInt(): bigint {
  return hashToBigInt(randomHash());
}

/** Build a zero-hash tree with `size` random leaves and return its parts. */
function buildTree(size = 5): { entries: ZeroHashEntry[]; root: Uint8Array } {
  const seen = new Set<bigint>();
  const entries: ZeroHashEntry[] = [];
  while (entries.length < size) {
    const index = randomBigInt();
    if (seen.has(index)) continue;
    seen.add(index);
    entries.push({ index, leaf: randomHash() });
  }
  return { entries, root: zeroHashRoot(entries) };
}

describe('btcr2-proof (zero-hash)', () => {

  describe('serializeProof / deserializeProof', () => {
    it('round-trips collapsed, hashes, root, nonce, updateId', () => {
      const { entries, root } = buildTree();
      const proof = generateZeroHashProof(entries, entries[0]!.index);
      const nonce = randomHash();
      const updateId = randomHash();

      const serialized = serializeProof(root, proof, { nonce, updateId });
      const result = deserializeProof(serialized);

      expect(result.collapsed).to.equal(proof.collapsed);
      expect(result.hashes).to.have.lengthOf(proof.hashes.length);
      expect(result.rootHash).to.deep.equal(root);
      expect(result.nonce).to.deep.equal(nonce);
      expect(result.updateId).to.deep.equal(updateId);
    });

    it('handles missing nonce and updateId', () => {
      const { entries, root } = buildTree();
      const proof = generateZeroHashProof(entries, entries[0]!.index);
      const result = deserializeProof(serializeProof(root, proof));

      expect(result.nonce).to.be.undefined;
      expect(result.updateId).to.be.undefined;
    });
  });

  describe('serialized format', () => {
    it('id field is 43-char base64url', () => {
      const { entries, root } = buildTree();
      const serialized = serializeProof(root, generateZeroHashProof(entries, entries[0]!.index));
      expect(serialized.id).to.have.lengthOf(HASH_B64URL_LENGTH);
      expect(serialized.id).to.match(B64URL_RE);
    });

    it('collapsed field is a full 256-bit bitmap (43-char base64url)', () => {
      const { entries, root } = buildTree(2);
      const serialized = serializeProof(root, generateZeroHashProof(entries, entries[0]!.index));
      // collapsed is the empty-sibling bitmap, encoded as a full 32-byte value.
      expect(serialized.collapsed).to.have.lengthOf(HASH_B64URL_LENGTH);
      expect(serialized.collapsed).to.match(B64URL_RE);
    });

    it('hashes are 43-char base64url', () => {
      const { entries, root } = buildTree();
      const serialized = serializeProof(root, generateZeroHashProof(entries, entries[0]!.index));
      for (const h of serialized.hashes) {
        expect(h).to.have.lengthOf(HASH_B64URL_LENGTH);
        expect(h).to.match(B64URL_RE);
      }
    });

    it('nonce and updateId are 43-char base64url when present', () => {
      const { entries, root } = buildTree();
      const serialized = serializeProof(root, generateZeroHashProof(entries, entries[0]!.index), {
        nonce    : randomHash(),
        updateId : randomHash(),
      });
      expect(serialized.nonce).to.have.lengthOf(HASH_B64URL_LENGTH);
      expect(serialized.updateId).to.have.lengthOf(HASH_B64URL_LENGTH);
    });
  });

  describe('verifySerializedProof (authoritative zero-hash walk)', () => {
    it('returns true for a valid proof', () => {
      const { entries, root } = buildTree();
      const serialized = serializeProof(root, generateZeroHashProof(entries, entries[0]!.index));
      expect(verifySerializedProof(serialized, entries[0]!.index, entries[0]!.leaf)).to.be.true;
    });

    it('returns false for a tampered candidate leaf', () => {
      const { entries, root } = buildTree();
      const serialized = serializeProof(root, generateZeroHashProof(entries, entries[0]!.index));
      expect(verifySerializedProof(serialized, entries[0]!.index, randomHash())).to.be.false;
    });

    it('returns false for the wrong index', () => {
      const { entries, root } = buildTree();
      const serialized = serializeProof(root, generateZeroHashProof(entries, entries[0]!.index));
      expect(verifySerializedProof(serialized, randomBigInt(), entries[0]!.leaf)).to.be.false;
    });

    it('returns false for a tampered root hash', () => {
      const { entries, root } = buildTree();
      const serialized = serializeProof(root, generateZeroHashProof(entries, entries[0]!.index));
      serialized.id = hashToBase64Url(randomHash());
      expect(verifySerializedProof(serialized, entries[0]!.index, entries[0]!.leaf)).to.be.false;
    });
  });
});

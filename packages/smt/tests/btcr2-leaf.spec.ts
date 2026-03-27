import { expect } from 'chai';
import { createHash } from 'node:crypto';
import {
  didToIndex, inclusionLeafHash, nonInclusionLeafHash,
  HASH_BYTE_LENGTH,
} from '../src/index.js';

function sha256(data: Uint8Array): Uint8Array {
  return new Uint8Array(createHash('sha256').update(data).digest());
}

describe('btcr2-leaf', () => {

  describe('didToIndex', () => {
    it('returns a bigint', () => {
      const idx = didToIndex('did:btcr2:k1qtest');
      expect(typeof idx).to.equal('bigint');
    });

    it('produces consistent results for the same DID', () => {
      const a = didToIndex('did:btcr2:k1qtest');
      const b = didToIndex('did:btcr2:k1qtest');
      expect(a).to.equal(b);
    });

    it('produces different indexes for different DIDs', () => {
      const a = didToIndex('did:btcr2:k1qaaa');
      const b = didToIndex('did:btcr2:k1qbbb');
      expect(a).to.not.equal(b);
    });

    it('matches hand-computed SHA-256(encode(did)) → bigint', () => {
      const did = 'did:btcr2:k1qtest';
      const hash = sha256(new TextEncoder().encode(did));
      let expected = 0n;
      for (const byte of hash) expected = (expected << 8n) | BigInt(byte);
      expect(didToIndex(did)).to.equal(expected);
    });
  });

  describe('inclusionLeafHash', () => {
    it('returns 32 bytes', () => {
      const nonce  = new Uint8Array(32).fill(0x01);
      const update = new Uint8Array(64).fill(0x02);
      const result = inclusionLeafHash(nonce, update);
      expect(result).to.have.lengthOf(HASH_BYTE_LENGTH);
    });

    it('matches SHA-256(SHA-256(nonce) || SHA-256(update))', () => {
      const nonce  = new Uint8Array(32).fill(0xAA);
      const update = new Uint8Array(48).fill(0xBB);

      const nonceHash  = sha256(nonce);
      const updateHash = sha256(update);
      const expected   = sha256(Buffer.concat([nonceHash, updateHash]));

      expect(inclusionLeafHash(nonce, update)).to.deep.equal(expected);
    });

    it('different nonces produce different leaf hashes', () => {
      const update = new Uint8Array(32).fill(0x01);
      const a = inclusionLeafHash(new Uint8Array(32).fill(0xAA), update);
      const b = inclusionLeafHash(new Uint8Array(32).fill(0xBB), update);
      expect(a).to.not.deep.equal(b);
    });
  });

  describe('nonInclusionLeafHash', () => {
    it('returns 32 bytes', () => {
      const nonce = new Uint8Array(32).fill(0x01);
      expect(nonInclusionLeafHash(nonce)).to.have.lengthOf(HASH_BYTE_LENGTH);
    });

    it('matches SHA-256(SHA-256(nonce))', () => {
      const nonce    = new Uint8Array(32).fill(0xCC);
      const expected = sha256(sha256(nonce));
      expect(nonInclusionLeafHash(nonce)).to.deep.equal(expected);
    });

    it('differs from inclusionLeafHash for the same nonce', () => {
      const nonce  = new Uint8Array(32).fill(0xDD);
      const update = new Uint8Array(32).fill(0xEE);
      const incl   = inclusionLeafHash(nonce, update);
      const nonIncl = nonInclusionLeafHash(nonce);
      expect(incl).to.not.deep.equal(nonIncl);
    });
  });
});

import { expect } from 'chai';
import { createHash } from 'node:crypto';
import {
  CACHED_ZERO, didToIndex, leafValue,
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

    it('matches hand-computed SHA-256(encode(did)) to bigint', () => {
      const did = 'did:btcr2:k1qtest';
      const hash = sha256(new TextEncoder().encode(did));
      let expected = 0n;
      for (const byte of hash) expected = (expected << 8n) | BigInt(byte);
      expect(didToIndex(did)).to.equal(expected);
    });
  });

  describe('leafValue: the four arms of SMT Proof Verification', () => {
    const nonce    = new Uint8Array(32).fill(0xAA);
    const updateId = new Uint8Array(32).fill(0xBB);

    it('nonce and updateId: SHA-256(SHA-256(nonce) || updateId)', () => {
      const expected = sha256(Buffer.concat([sha256(nonce), updateId]));
      expect(leafValue(nonce, updateId)).to.deep.equal(expected);
      expect(leafValue(nonce, updateId)).to.have.lengthOf(HASH_BYTE_LENGTH);
    });

    it('nonce only: SHA-256(SHA-256(nonce))', () => {
      expect(leafValue(nonce)).to.deep.equal(sha256(sha256(nonce)));
    });

    it('updateId only: the updateId bytes', () => {
      expect(leafValue(undefined, updateId)).to.deep.equal(updateId);
    });

    it('neither: cachedZero[0] = SHA-256(64 zero bytes)', () => {
      expect(leafValue()).to.deep.equal(sha256(new Uint8Array(64)));
      expect(leafValue()).to.deep.equal(CACHED_ZERO[0]);
    });

    it('the four arms give four different values', () => {
      const values = [leafValue(nonce, updateId), leafValue(nonce), leafValue(undefined, updateId), leafValue()];
      const distinct = new Set(values.map(v => Buffer.from(v).toString('hex')));
      expect(distinct.size).to.equal(4);
    });

    it('accepts a nonce of any length', () => {
      const short = new Uint8Array(16).fill(0x01);
      expect(leafValue(short)).to.deep.equal(sha256(sha256(short)));
      expect(leafValue(short, updateId)).to.deep.equal(sha256(Buffer.concat([sha256(short), updateId])));
    });

    it('throws RangeError for an updateId that is not 32 bytes', () => {
      expect(() => leafValue(nonce, new Uint8Array(31))).to.throw(RangeError);
      expect(() => leafValue(undefined, new Uint8Array(33))).to.throw(RangeError);
    });
  });
});

import { expect } from 'chai';
import { createHash } from 'node:crypto';
import {
  blockHash, hashToBigInt, bigIntToHash,
  hashToHex, hexToHash, bigIntToHex, hexToBigInt,
  hashToBase64, base64ToHash, bigIntToBase64, base64ToBigInt,
  hashesEqual, isValidHash, validateHash,
  HASH_BYTE_LENGTH, NULL_HASH,
} from '../src/index.js';

describe('Hash utilities', () => {

  describe('blockHash', () => {
    it('produces a SHA-256 digest of a single block', () => {
      const input = new Uint8Array([0x01, 0x02, 0x03]);
      const expected = new Uint8Array(createHash('sha256').update(input).digest());
      expect(blockHash(input)).to.deep.equal(expected);
    });

    it('concatenates multiple blocks before hashing', () => {
      const a = new Uint8Array([0xAA]);
      const b = new Uint8Array([0xBB, 0xCC]);
      const expected = new Uint8Array(
        createHash('sha256').update(Buffer.concat([a, b])).digest()
      );
      expect(blockHash(a, b)).to.deep.equal(expected);
    });

    it('returns 32 bytes', () => {
      const result = blockHash(new Uint8Array([0xFF]));
      expect(result).to.have.lengthOf(HASH_BYTE_LENGTH);
    });
  });

  describe('hashToBigInt / bigIntToHash', () => {
    it('round-trips a known hash', () => {
      const hash = blockHash(new Uint8Array([1, 2, 3]));
      const n = hashToBigInt(hash);
      expect(bigIntToHash(n)).to.deep.equal(hash);
    });

    it('handles zero', () => {
      const hash = new Uint8Array(HASH_BYTE_LENGTH);
      expect(hashToBigInt(hash)).to.equal(0n);
      expect(bigIntToHash(0n)).to.deep.equal(hash);
    });

    it('handles max value (2^256 - 1)', () => {
      const max = (1n << 256n) - 1n;
      const hash = bigIntToHash(max);
      expect(hash.every(b => b === 0xFF)).to.be.true;
      expect(hashToBigInt(hash)).to.equal(max);
    });

    it('bigIntToHash throws on overflow', () => {
      expect(() => bigIntToHash(1n << 256n)).to.throw(RangeError);
    });
  });

  describe('hashToHex / hexToHash', () => {
    it('round-trips a hash', () => {
      const hash = blockHash(new Uint8Array([0xDE, 0xAD]));
      const hex = hashToHex(hash);
      expect(hex).to.have.lengthOf(64);
      expect(hexToHash(hex)).to.deep.equal(hash);
    });

    it('produces lowercase hex', () => {
      const hex = hashToHex(new Uint8Array(HASH_BYTE_LENGTH).fill(0xAB));
      expect(hex).to.match(/^[0-9a-f]{64}$/);
    });

    it('hexToHash throws on wrong length', () => {
      expect(() => hexToHash('abcd')).to.throw(RangeError);
    });

    it('hexToHash throws on invalid characters', () => {
      expect(() => hexToHash('g'.repeat(64))).to.throw(RangeError);
    });
  });

  describe('bigIntToHex / hexToBigInt', () => {
    it('padded: produces 64-char hex', () => {
      expect(bigIntToHex(0n, true)).to.have.lengthOf(64);
      expect(bigIntToHex(255n, true)).to.have.lengthOf(64);
    });

    it('unpadded: minimal hex', () => {
      expect(bigIntToHex(0n, false)).to.equal('0');
      expect(bigIntToHex(255n, false)).to.equal('ff');
      expect(bigIntToHex(256n, false)).to.equal('100');
    });

    it('round-trips padded', () => {
      const val = 0xDEADBEEFn;
      expect(hexToBigInt(bigIntToHex(val, true), true)).to.equal(val);
    });

    it('round-trips unpadded', () => {
      const val = 0xCAFEn;
      expect(hexToBigInt(bigIntToHex(val, false), false)).to.equal(val);
    });
  });

  describe('hashToBase64 / base64ToHash', () => {
    it('round-trips a hash', () => {
      const hash = blockHash(new Uint8Array([0x42]));
      const b64 = hashToBase64(hash);
      expect(base64ToHash(b64)).to.deep.equal(hash);
    });

    it('base64ToHash throws on wrong decoded length', () => {
      const short = Buffer.from(new Uint8Array(16)).toString('base64');
      expect(() => base64ToHash(short)).to.throw(RangeError);
    });
  });

  describe('bigIntToBase64 / base64ToBigInt', () => {
    it('round-trips padded', () => {
      const val = 0xDEADn;
      expect(base64ToBigInt(bigIntToBase64(val, true), true)).to.equal(val);
    });

    it('round-trips unpadded', () => {
      const val = 0xBEEFn;
      expect(base64ToBigInt(bigIntToBase64(val, false), false)).to.equal(val);
    });
  });

  describe('hashesEqual', () => {
    it('returns true for equal hashes', () => {
      const a = blockHash(new Uint8Array([1]));
      const b = new Uint8Array(a);
      expect(hashesEqual(a, b)).to.be.true;
    });

    it('returns false for different hashes', () => {
      const a = blockHash(new Uint8Array([1]));
      const b = blockHash(new Uint8Array([2]));
      expect(hashesEqual(a, b)).to.be.false;
    });

    it('returns false for wrong-length input', () => {
      const a = new Uint8Array(31);
      const b = new Uint8Array(HASH_BYTE_LENGTH);
      expect(hashesEqual(a, b)).to.be.false;
    });
  });

  describe('isValidHash / validateHash', () => {
    it('isValidHash returns true for 32 bytes', () => {
      expect(isValidHash(new Uint8Array(HASH_BYTE_LENGTH))).to.be.true;
    });

    it('isValidHash returns false for other lengths', () => {
      expect(isValidHash(new Uint8Array(0))).to.be.false;
      expect(isValidHash(new Uint8Array(31))).to.be.false;
      expect(isValidHash(new Uint8Array(33))).to.be.false;
    });

    it('validateHash throws for invalid length', () => {
      expect(() => validateHash(new Uint8Array(16))).to.throw(RangeError);
    });
  });

  describe('NULL_HASH', () => {
    it('is 32 zero bytes', () => {
      expect(NULL_HASH).to.have.lengthOf(HASH_BYTE_LENGTH);
      expect(NULL_HASH.every(b => b === 0)).to.be.true;
    });
  });
});

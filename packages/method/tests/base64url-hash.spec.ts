import { decode, encode } from '@did-btcr2/common';
import { bytesToHex, randomBytes } from '@noble/hashes/utils';
import { expect } from 'chai';
import { base64UrlHashHex, hasNonZeroPadBits, smtProofRootHex } from '../src/utils/base64url-hash.js';

/** The base64url letters in the order of their values (RFC 4648 Section 5). */
const LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';

/** True if the strict decoder refuses `text`. */
function strictRefuses(text: string): boolean {
  try {
    decode(text, 'base64urlnopad');
    return false;
  } catch {
    return true;
  }
}

describe('base64url hash helpers (ADR 146)', () => {
  const bytes = randomBytes(32);
  const text = encode(bytes, 'base64urlnopad');

  describe('hasNonZeroPadBits', () => {
    for(const length of [31, 32]) {
      it(`agrees with the strict decoder for each last letter of a ${length}-byte value`, () => {
        const base = encode(randomBytes(length), 'base64urlnopad').slice(0, -1);
        for(const letter of LETTERS) {
          const value = base + letter;
          expect(hasNonZeroPadBits(value), value).to.equal(strictRefuses(value));
        }
      });
    }

    it('is true for a pad-bit value that a lenient decoder reads as the same bytes', () => {
      const padded = text.slice(0, -1) + LETTERS[LETTERS.indexOf(text.at(-1)!) | 1];
      expect(hasNonZeroPadBits(padded)).to.equal(true);
      expect(bytesToHex(Buffer.from(padded, 'base64url'))).to.equal(bytesToHex(bytes));
    });

    it('is true for a pad-bit value with "=" padding', () => {
      const padded = text.slice(0, -1) + LETTERS[LETTERS.indexOf(text.at(-1)!) | 1];
      expect(hasNonZeroPadBits(`${padded}=`)).to.equal(true);
      const short = encode(randomBytes(31), 'base64urlnopad');
      expect(hasNonZeroPadBits(`${short.slice(0, -1)}${LETTERS[LETTERS.indexOf(short.at(-1)!) | 1]}==`)).to.equal(true);
    });

    it('is false for a value with zero pad bits (also with "=" padding) and for a letter outside base64url', () => {
      expect(hasNonZeroPadBits(text)).to.equal(false);
      expect(hasNonZeroPadBits(encode(randomBytes(33), 'base64urlnopad'))).to.equal(false);
      expect(hasNonZeroPadBits(`${text}=`)).to.equal(false);
      expect(hasNonZeroPadBits(`${text.slice(0, -1)}+`)).to.equal(false);
      expect(hasNonZeroPadBits(`!${text.slice(0, -2)}B`)).to.equal(false);
      expect(hasNonZeroPadBits('B')).to.equal(false);
      expect(hasNonZeroPadBits('')).to.equal(false);
    });

    it('is false for a value that is not a string', () => {
      for(const value of [undefined, null, 7, {}, [text]]) {
        expect(hasNonZeroPadBits(value)).to.equal(false);
      }
    });
  });

  describe('base64UrlHashHex', () => {
    it('returns the hex of a 32-byte value with no padding and zero pad bits', () => {
      expect(base64UrlHashHex(text)).to.equal(bytesToHex(bytes));
    });

    it('returns undefined for a value that the strict decoder refuses or that is not 32 bytes', () => {
      const padded = text.slice(0, -1) + LETTERS[LETTERS.indexOf(text.at(-1)!) | 1];
      for(const value of [
        padded,
        `${text}=`,
        `+${text.slice(1)}`,
        '',
        encode(randomBytes(31), 'base64urlnopad'),
        encode(randomBytes(33), 'base64urlnopad')
      ]) {
        expect(base64UrlHashHex(value), value).to.equal(undefined);
      }
    });

    it('returns undefined for a value that is not a string', () => {
      for(const value of [undefined, null, 7, bytes, [text]]) {
        expect(base64UrlHashHex(value)).to.equal(undefined);
      }
    });
  });

  describe('smtProofRootHex', () => {
    it('returns the hex of the decoded id of an object', () => {
      expect(smtProofRootHex({ id: text, collapsed: '', hashes: [] })).to.equal(bytesToHex(bytes));
    });

    it('returns undefined for a value that is not an object, and for an object whose id does not decode', () => {
      for(const value of [undefined, null, text, [{ id: text }], {}, { id: 7 }, { id: `${text}=` }]) {
        expect(smtProofRootHex(value), JSON.stringify(value)).to.equal(undefined);
      }
    });
  });
});

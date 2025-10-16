import { expect } from 'chai';
import { CompressedSecp256k1PublicKey } from '../src/public.js';
import { BIP340_PUBLIC_KEY_MULTIBASE_PREFIX, PublicKeyError } from '@did-btcr2/common';

describe('CompressedSecp256k1PublicKey', () => {
  const hex = '027f87843047622ad7556ed37c981e096a6bf606e7ccfc2ef3db1e9148ccb4cbb9';
  const parity = 2;
  const x = new Uint8Array([
    127, 135, 132,  48,  71,  98,  42, 215,
    85, 110, 211, 124, 152,  30,   9, 106,
    107, 246,   6, 231, 204, 252,  46, 243,
    219,  30, 145,  72, 204, 180, 203, 185
  ]);
  const y = new Uint8Array([
    134, 174, 110, 219, 173, 235,  25, 140,
    123, 204, 226, 205,  79,  40,  94,   9,
    12, 249, 146, 238, 209, 222, 148,  92,
    218, 208, 107, 223,  13, 168, 121,   9
  ]);
  const uncompressed = new Uint8Array([
    4,  127, 135, 132,  48,  71,  98,  42, 215,
    85, 110, 211, 124, 152,  30,   9, 106,
    107, 246,   6, 231, 204, 252,  46, 243,
    219,  30, 145,  72, 204, 180, 203, 185,
    134, 174, 110, 219, 173, 235,  25, 140,
    123, 204, 226, 205,  79,  40,  94,   9,
    12, 249, 146, 238, 209, 222, 148,  92,
    218, 208, 107, 223,  13, 168, 121,   9
  ]);
  const prefix = new Uint8Array([231, 1]);
  const compressed = new Uint8Array([parity, ...x]);
  const multibase = {
    prefix  : BIP340_PUBLIC_KEY_MULTIBASE_PREFIX,
    key     : [...prefix, ...compressed],
    encoded : 'zQ3shVzcPKb9Jw46yNjW2AMXe9AhniqSqtPueJNygcLguNZTn'
  };

  describe('with invalid bytes', () => {
    it('should throw PublicKeyError if bytes invalid', () => {
      expect(() => new CompressedSecp256k1PublicKey(new Uint8Array([0])))
        .to.throw(PublicKeyError, 'Invalid argument: byte length must be 33 (compressed)');
    });
  });

  describe('with valid bytes', () => {
    const publicKey = new CompressedSecp256k1PublicKey(compressed);

    it('should be an instance of CompressedSecp256k1PublicKey', () => {
      expect(publicKey).to.be.instanceOf(CompressedSecp256k1PublicKey);
    });

    it('should have property compressed matching compressed bytes', () => {
      expect(publicKey.compressed).to.deep.equal(compressed);
    });

    it('should have property hex matching the expected hex', () => {
      expect(publicKey.hex).to.equal(hex);
    });

    it('should have property multibase matching the expected multibase', () => {
      expect(publicKey.multibase).to.deep.equal(multibase);
    });

    it('should have property multibase.encoded matching the expected multibase.encoded', () => {
      expect(publicKey.multibase.encoded).to.equal(multibase.encoded);
    });

    it('should have property multibase.prefix matching the expected multibase.prefix', () => {
      expect(publicKey.multibase.prefix).to.deep.equal(multibase.prefix);
    });

    it('should have property multibase.prefix matching the expected multibase.prefix', () => {
      expect(publicKey.multibase.key).to.deep.equal(multibase.key);
    });

    it('should have property parity matching the expected parity', () => {
      expect(publicKey.parity).to.equal(parity);
    });

    it('should x-coordinate matching the expected x-coordinate', () => {
      expect(publicKey.x).to.deep.equal(x);
    });

    it('should have y-coordinate matching the expected y-coordinate', () => {
      expect(publicKey.y).to.deep.equal(y);
    });

    it('should have property uncompressed matching the expected uncompressed', () => {
      expect(publicKey.uncompressed).to.deep.equal(uncompressed);
    });

    it('should have property x matching the expected x', () => {
      expect(publicKey.x).to.deep.equal(x);
    });

    it('should equal the expected CompressedSecp256k1PublicKey', () => {
      expect(publicKey.equals(new CompressedSecp256k1PublicKey(compressed))).to.be.true;
    });

    it('should have property hex matching the expected hex', () => {
      expect(publicKey.hex).to.equal(hex);
    });

    it('should encode the x-coordinate and match the expected multibase', () => {
      expect(publicKey.encode()).to.equal(multibase.encoded);
    });
  });
});
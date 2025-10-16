import { expect } from 'chai';
import { Secp256k1SecretKey } from '../src/secret.js';
import { CompressedSecp256k1PublicKey } from '../src/public.js';
import { SecretKeyError } from '@did-btcr2/common';

describe('Secp256k1SecretKey', () => {
  const bytes = new Uint8Array([
    115, 253, 220, 18, 252, 147, 66, 187,
    41, 174, 155, 94, 212, 118, 50,  59,
    220, 105,  58, 17, 110,  54, 81,  36,
    85, 174, 232, 48, 254, 138, 37, 162
  ]);
  const seed = 52464508790539176856770556715241483442035423615466097401201513777400180778402n;
  const hex = '73fddc12fc9342bb29ae9b5ed476323bdc693a116e36512455aee830fe8a25a2';

  describe('with invalid seed', () => {
    it('should throw SecretKeyError if seed is not bytes or bigint', () => {
      expect(() => new Secp256k1SecretKey('' as any))
        .to.throw(SecretKeyError, 'Invalid entropy: must be a valid byte array (32) or bigint');
    });

    it('should throw SecretKeyError if seed is invalid bigint seed', () => {
      expect(() => new Secp256k1SecretKey(0n))
        .to.throw(SecretKeyError, 'Invalid bytes: must be a valid 32-byte secret key');
    });

    it('should throw SecretKeyError if seed is invalid byte array', () => {
      expect(() => new Secp256k1SecretKey(new Uint8Array([0])))
        .to.throw(SecretKeyError, 'Invalid bytes: must be a valid 32-byte secret key');
    });
  });

  describe('with seed as bytes array', () => {
    const secretKey = new Secp256k1SecretKey(bytes);

    it('should be an instance of Secp256k1SecretKey', () => {
      expect(secretKey).to.be.instanceOf(Secp256k1SecretKey);
    });

    it('should have property bytes matching the expected seed bytes', () => {
      expect(secretKey.bytes).to.deep.equal(bytes);
    });

    it('should have property seed matching the expected seed', () => {
      expect(secretKey.seed).to.deep.equal(seed);
    });

    it('should compute publicKey', () => {
      expect(secretKey.computePublicKey()).to.be.instanceOf(CompressedSecp256k1PublicKey);
    });

    it('should have a valid public key pair', () => {
      expect(secretKey.hasValidPublicKey()).to.be.true;
    });

    it('should equal Secp256k1SecretKey', () => {
      expect(secretKey.equals(new Secp256k1SecretKey(bytes))).to.be.true;
    });

    it('should equal hex', () => {
      expect(secretKey.hex).to.equal(hex);
    });

    it('should equal Secp256k1SecretKey', () => {
      expect(secretKey.isValid()).to.be.true;
    });

  });

  describe('with bigint seed', () => {
    const secretKey = new Secp256k1SecretKey(seed);

    it('should be an instance of Secp256k1SecretKey', () => {
      expect(secretKey).to.be.instanceOf(Secp256k1SecretKey);
    });

    it('should have property bytes matching the expected bytes', () => {
      expect(secretKey.bytes).to.deep.equal(bytes);
    });

    it('should have property seed matching the expected seed', () => {
      expect(secretKey.seed).to.deep.equal(seed);
    });

    it('should compute publicKey', () => {
      expect(secretKey.computePublicKey()).to.be.instanceOf(CompressedSecp256k1PublicKey);
    });

    it('should equal Secp256k1SecretKey', () => {
      expect(secretKey.equals(new Secp256k1SecretKey(seed))).to.be.true;
    });

    it('should have property hex matching the expected hex', () => {
      expect(secretKey.hex).to.equal(hex);
    });

    it('should be valid', () => {
      expect(secretKey.isValid()).to.be.true;
    });

  });
});
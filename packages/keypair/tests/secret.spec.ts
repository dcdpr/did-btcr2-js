import { expect } from 'chai';
import { Secp256k1SecretKey } from '../src/secret.js';
import { CompressedSecp256k1PublicKey } from '../src/public.js';
import { SecretKeyError } from '@did-btcr2/common';
import { secp256k1 } from '@noble/curves/secp256k1.js';

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

  describe('edge cases', () => {
    it('should reject all-zeros 32-byte key', () => {
      expect(() => new Secp256k1SecretKey(new Uint8Array(32)))
        .to.throw(SecretKeyError);
    });

    it('should accept bigint 1n (minimum valid scalar)', () => {
      const sk = new Secp256k1SecretKey(1n);
      expect(sk.isValid()).to.be.true;
      expect(sk.seed).to.equal(1n);
    });

    it('should accept secp256k1.Point.Fn.ORDER - 1 (maximum valid scalar)', () => {
      const sk = new Secp256k1SecretKey(secp256k1.Point.Fn.ORDER - 1n);
      expect(sk.isValid()).to.be.true;
    });

    it('should reject secp256k1.Point.Fn.ORDER (out of range)', () => {
      expect(() => new Secp256k1SecretKey(secp256k1.Point.Fn.ORDER))
        .to.throw(SecretKeyError);
    });

    it('should reject secp256k1.Point.Fn.ORDER + 1 (out of range)', () => {
      expect(() => new Secp256k1SecretKey(secp256k1.Point.Fn.ORDER + 1n))
        .to.throw(SecretKeyError);
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

    it('should be valid', () => {
      expect(secretKey.isValid()).to.be.true;
    });

    it('should defensive-copy input bytes', () => {
      const input = new Uint8Array(bytes);
      const sk = new Secp256k1SecretKey(input);
      input.fill(0);
      expect(sk.bytes).to.deep.equal(bytes);
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

  describe('sign and verify', () => {
    const secretKey = new Secp256k1SecretKey(bytes);
    const publicKey = secretKey.computePublicKey();
    const message = new Uint8Array(32).fill(0xab);

    it('should sign and verify with schnorr (default)', () => {
      const signature = secretKey.sign(message);
      expect(signature).to.be.instanceOf(Uint8Array);
      expect(signature.length).to.equal(64);
      expect(publicKey.verify(signature, message)).to.be.true;
    });

    it('should sign and verify with schnorr (explicit)', () => {
      const signature = secretKey.sign(message, { scheme: 'schnorr' });
      expect(publicKey.verify(signature, message, { scheme: 'schnorr' })).to.be.true;
    });

    it('should sign and verify with ecdsa', () => {
      const signature = secretKey.sign(message, { scheme: 'ecdsa' });
      expect(signature).to.be.instanceOf(Uint8Array);
      expect(signature.length).to.equal(64);
      expect(publicKey.verify(signature, message, { scheme: 'ecdsa' })).to.be.true;
    });

    it('should reject tampered message', () => {
      const signature = secretKey.sign(message);
      const tampered = new Uint8Array(32).fill(0xcd);
      expect(publicKey.verify(signature, tampered)).to.be.false;
    });

    it('should reject wrong public key', () => {
      const signature = secretKey.sign(message);
      const otherKey = Secp256k1SecretKey.generate().computePublicKey();
      expect(otherKey.verify(signature, message)).to.be.false;
    });
  });

  describe('exportJSON and fromJSON round-trip', () => {
    const secretKey = new Secp256k1SecretKey(bytes);

    it('should round-trip through exportJSON/fromJSON', () => {
      const json = secretKey.exportJSON();
      const restored = Secp256k1SecretKey.fromJSON(json);
      expect(restored.equals(secretKey)).to.be.true;
      expect(restored.hex).to.equal(secretKey.hex);
    });

    it('should produce safe output from toJSON', () => {
      const safe = secretKey.toJSON();
      expect(safe).to.deep.equal({ type: 'Secp256k1SecretKey' });
      expect(safe).to.not.have.property('bytes');
      expect(safe).to.not.have.property('hex');
    });

    it('should not expose secrets via JSON.stringify', () => {
      const json = JSON.stringify(secretKey);
      expect(json).to.not.contain(hex);
      expect(json).to.equal('{"type":"Secp256k1SecretKey"}');
    });
  });

  describe('destroy', () => {
    it('should zero out key material', () => {
      const sk = new Secp256k1SecretKey(bytes);
      expect(sk.isValid()).to.be.true;
      sk.destroy();
      expect(sk.bytes).to.deep.equal(new Uint8Array(32));
    });
  });

  describe('decode', () => {
    it('should decode a valid secretKeyMultibase string', () => {
      const sk = new Secp256k1SecretKey(bytes);
      const encoded = sk.multibase;
      const decoded = Secp256k1SecretKey.decode(encoded);
      expect(decoded.length).to.equal(34);
      expect(decoded.slice(2)).to.deep.equal(bytes);
    });
  });
});
import { KeyPairError } from '@did-btcr2/common';
import { expect } from 'chai';
import { SchnorrKeyPair } from '../src/pair.js';
import { CompressedSecp256k1PublicKey } from '../src/public.js';
import { Secp256k1SecretKey } from '../src/secret.js';

describe('SchnorrKeyPair instantiated', () => {
  const bytes = {
    secretKey : new Uint8Array([
      115, 253, 220, 18, 252, 147, 66, 187,
      41, 174, 155, 94, 212, 118, 50,  59,
      220, 105,  58, 17, 110,  54, 81,  36,
      85, 174, 232, 48, 254, 138, 37, 162
    ]),
    publicKey : new Uint8Array([
      2, 154, 213, 246, 168,  93,  39, 238,
      105, 177,  51, 174, 210, 115, 180, 242,
      245, 215,  14, 212, 167,  22, 117,   1,
      156,  26, 118, 240,  76, 102,  53,  38,
      239
    ])
  };


  describe('without params', () => {
    it('should throw KeyPairError', () => {
      expect(() => new SchnorrKeyPair())
        .to.throw(KeyPairError, 'Argument missing: must at least provide a publicKey');
    });
  });

  describe('with private key bytes', () => {
    const keys = new SchnorrKeyPair(bytes.secretKey);

    it('should construct a new instanceOf SchnorrKeyPair', () => {
      expect(keys).to.be.instanceOf(SchnorrKeyPair);
    });

    it('should have property secretKey as an instanceOf Secp256k1SecretKey with matching bytes', () => {
      expect(keys.secretKey).to.be.instanceOf(Secp256k1SecretKey);
      expect(keys.secretKey.bytes).to.deep.equal(bytes.secretKey);
    });

    it('should have property publicKey as an instanceOf CompressedSecp256k1PublicKey with matching bytes', () => {
      expect(keys.publicKey).to.be.instanceOf(CompressedSecp256k1PublicKey);
      expect(keys.publicKey.compressed).to.deep.equal(bytes.publicKey);
    });
  });

  describe('with public key bytes', () => {
    const keys = new SchnorrKeyPair(undefined, bytes.publicKey);

    it('should construct a new instanceOf SchnorrKeyPair', () => {
      expect(keys).to.be.instanceOf(SchnorrKeyPair);
    });

    it('should not have property secretKey', () => {
      expect(() => keys.secretKey).to.throw(KeyPairError, 'Secret key not available');
    });

    it('should have property publicKey as an instanceOf CompressedSecp256k1PublicKey with matching bytes', () => {
      expect(keys.publicKey).to.be.instanceOf(CompressedSecp256k1PublicKey);
      expect(keys.publicKey.compressed).to.deep.equal(bytes.publicKey);
    });
  });

  describe('with private and public key bytes', () => {
    const { secretKey, publicKey } = bytes;
    const keys = new SchnorrKeyPair(secretKey, publicKey);

    it('should construct a new instanceOf SchnorrKeyPair', () => {
      expect(keys).to.be.instanceOf(SchnorrKeyPair);
    });

    it('should have property secretKey as an instanceOf Secp256k1SecretKey with matching bytes', () => {
      expect(keys.secretKey).to.be.instanceOf(Secp256k1SecretKey);
      expect(keys.secretKey.bytes).to.deep.equal(bytes.secretKey);
    });

    it('should have property publicKey as an instanceOf CompressedSecp256k1PublicKey with matching bytes', () => {
      expect(keys.publicKey).to.be.instanceOf(CompressedSecp256k1PublicKey);
      expect(keys.publicKey.compressed).to.deep.equal(bytes.publicKey);
    });
  });

  describe('with Secp256k1SecretKey', () => {
    const secretKey = new Secp256k1SecretKey(bytes.secretKey);
    const keys = new SchnorrKeyPair({ secretKey });

    it('should construct a new SchnorrKeyPair', () => {
      expect(keys).to.be.instanceOf(SchnorrKeyPair);
    });

    it('should contain properties keys.secretKey and keys.publicKey', () => {
      expect(keys.secretKey).to.be.instanceOf(Secp256k1SecretKey);
      expect(keys.publicKey).to.be.instanceOf(CompressedSecp256k1PublicKey);
    });
  });

  describe('with CompressedSecp256k1PublicKey', () => {
    const publicKey = new CompressedSecp256k1PublicKey(bytes.publicKey);
    const keys = new SchnorrKeyPair({ publicKey });

    it('should construct a new SchnorrKeyPair', () => {
      expect(keys).to.be.instanceOf(SchnorrKeyPair);
    });

    it('should contain property keys.publicKey and should not contain property keys.secretKey', () => {
      expect(keys.publicKey).to.be.instanceOf(CompressedSecp256k1PublicKey);
      expect(() => keys.secretKey).to.throw(KeyPairError, 'Secret key not available');
    });
  });


  describe('with Secp256k1SecretKey and CompressedSecp256k1PublicKey', () => {
    const secretKey = new Secp256k1SecretKey(bytes.secretKey);
    const publicKey = new CompressedSecp256k1PublicKey(bytes.publicKey);
    const keys = new SchnorrKeyPair({ secretKey, publicKey });

    it('should construct a new SchnorrKeyPair', () => {
      expect(keys).to.be.instanceOf(SchnorrKeyPair);
    });

    it('should construct', () => {
      expect(keys.secretKey).to.be.instanceOf(Secp256k1SecretKey);
      expect(keys.publicKey).to.be.instanceOf(CompressedSecp256k1PublicKey);
    });
  });
});
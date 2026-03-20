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
    const keys = new SchnorrKeyPair({ secretKey: bytes.secretKey });

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
    const keys = new SchnorrKeyPair({ publicKey: bytes.publicKey });

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
    const keys = new SchnorrKeyPair(bytes);

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

  describe('mismatched secret and public key', () => {
    it('should throw when public key does not match secret key', () => {
      const otherPair = SchnorrKeyPair.generate();
      expect(() => new SchnorrKeyPair({
        secretKey : bytes.secretKey,
        publicKey : otherPair.publicKey.compressed
      })).to.throw(KeyPairError, 'Public key does not match secret key');
    });
  });

  describe('hasSecretKey predicate', () => {
    it('should return true for full key pairs', () => {
      const kp = new SchnorrKeyPair({ secretKey: bytes.secretKey });
      expect(kp.hasSecretKey).to.be.true;
    });

    it('should return false for public-key-only pairs', () => {
      const kp = new SchnorrKeyPair({ publicKey: bytes.publicKey });
      expect(kp.hasSecretKey).to.be.false;
    });
  });

  describe('public-key-only getters', () => {
    const kp = new SchnorrKeyPair({ publicKey: bytes.publicKey });

    it('raw should return public bytes and undefined secret', () => {
      const raw = kp.raw;
      expect(raw.public).to.be.instanceOf(Uint8Array);
      expect(raw.secret).to.be.undefined;
    });

    it('hex should return public hex and undefined secret', () => {
      const hex = kp.hex;
      expect(typeof hex.public).to.equal('string');
      expect(hex.secret).to.be.undefined;
    });

    it('multibase should return public multibase and empty secret', () => {
      const mb = kp.multibase;
      expect(mb.publicKeyMultibase).to.be.a('string').and.not.empty;
      expect(mb.secretKeyMultibase).to.equal('');
    });

    it('toJSON should return only public key', () => {
      const json = kp.toJSON();
      expect(json).to.have.property('publicKey');
      expect(json).to.not.have.property('secretKey');
    });

    it('exportJSON should throw', () => {
      expect(() => kp.exportJSON())
        .to.throw(KeyPairError, 'Cannot export: secret key required');
    });
  });

  describe('exportJSON and fromJSON round-trip', () => {
    it('should round-trip through exportJSON/fromJSON', () => {
      const original = new SchnorrKeyPair({ secretKey: bytes.secretKey });
      const json = original.exportJSON();
      const restored = SchnorrKeyPair.fromJSON(json);
      expect(SchnorrKeyPair.equals(original, restored)).to.be.true;
      expect(restored.secretKey.hex).to.equal(original.secretKey.hex);
    });

    it('should not expose secrets via JSON.stringify', () => {
      const kp = new SchnorrKeyPair({ secretKey: bytes.secretKey });
      const json = JSON.stringify(kp);
      const parsed = JSON.parse(json);
      expect(parsed).to.have.property('publicKey');
      expect(parsed).to.not.have.property('secretKey');
    });
  });
});
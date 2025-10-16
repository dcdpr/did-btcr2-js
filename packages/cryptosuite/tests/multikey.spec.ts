import { KeyPairError, MultikeyError } from '@did-btcr2/common';
import { SchnorrKeyPair, Secp256k1SecretKey, CompressedSecp256k1PublicKey } from '@did-btcr2/keypair';
import { expect } from 'chai';
import { SchnorrMultikey } from '../src/index.js';

/**
 * SchnorrMultikey Test Cases
 * 1. id, controller only → should throw
 * 2. id, controller, privateKey → should succeed
 * 3. id, controller, publicKey → should succeed
 * 4. id, controller, privateKey, publicKey → should succeed
 */
describe('SchnorrMultikey', () => {
  const skBytes = new Uint8Array([
    69, 112, 198, 176,  14, 103, 100,  73,
    35, 179, 169,  83,  80, 213, 189, 190,
    118, 200,   5,  43,  20,  46, 148,  60,
    109,  37, 134, 164, 162, 174, 185, 201
  ]);
  const schnorrKeyPair = new SchnorrKeyPair({ secretKey: skBytes });
  const publicKey = schnorrKeyPair.publicKey;
  // Multikey Constants
  const id = '#initialKey';
  const controller = 'did:btcr2:regtest:k1qtwrw6r00e3rh6hv02ak42mweykcg0u7n478vl5ks4ugfppl9dfs7m3gyfg';
  const fullId = `${controller}${id}`;
  const publicKeyMultibase = 'zQ3shcERTF2BZqz4v51hDdPdM4di9xFWNadCakCkQmNEZPdPt';
  const verificationMethod = { id, type: 'Multikey', controller, publicKeyMultibase };
  const message = Buffer.from('hello, world');
  const validSignature = new Uint8Array([
    230, 121, 211, 219, 114, 235, 178, 235, 140, 226, 13,
    104,  26,  57, 212,  69, 118,   5,  98,  23, 174, 17,
    41, 234, 139,  74, 203, 102,  77,  82, 165,  28, 33,
    248, 217, 150,  45, 209,  98, 157, 185,  37, 193, 72,
    165, 134, 136, 217, 180, 143, 206, 208, 247, 163, 93,
    178,  19, 144, 137, 252,  47, 215, 237,  28
  ]);
  const invalidSignature =  new Uint8Array([
    25, 105, 158, 232,  91,   7,  61,   8,   2, 215, 191,
    122,  47,  51, 195, 195, 207,  95, 213, 226,  72, 224,
    10, 153,  84,  66, 197, 186, 110, 108,  91, 156, 195,
    157, 126,  82,  51,  10, 167, 163, 240, 244, 231, 140,
    202, 250, 220, 245, 132,  34, 102,  64, 202,  24,  97,
    163,  84,  73, 128,   5, 188, 219,  47, 133
  ]);

  /**
   * Incomplete parameters
   */
  describe('No SchnorrKeyPair', () => {
    it('should throw MultikeyError', () => {
      expect(() => new SchnorrMultikey({ id, controller }))
        .to.throw(MultikeyError, 'Argument missing: "keys" required');
    });
  });

  /**
   * All parameters
   */
  describe('SchnorrKeyPair', () => {
    const multikey = new SchnorrMultikey({ id, controller, keys: schnorrKeyPair });

    it('should successfully construct a new SchnorrMultikey', () => {
      expect(multikey).to.exist.and.to.be.instanceOf(SchnorrMultikey);
    });

    it('should have proper variables: id, controller, privateKey, publicKey', () => {
      expect(multikey.id).to.equal(id);
      expect(multikey.controller).to.equal(controller);
      expect(multikey.secretKey).to.exist.and.to.be.instanceOf(Secp256k1SecretKey);
      expect(multikey.publicKey).to.exist.and.to.be.instanceOf(CompressedSecp256k1PublicKey);
      expect(multikey.secretKey.equals(schnorrKeyPair.secretKey)).to.be.true;
      expect(multikey.publicKey.equals(schnorrKeyPair.publicKey)).to.be.true;
    });

    it('should create a valid schnorr signature', () => {
      const signature = multikey.sign(message);
      expect(signature).to.exist.and.to.be.instanceOf(Uint8Array);
      expect(signature.length).to.equal(64);
    });

    it('should resolve verification of a valid schnorr signature to true', () => {
      expect(multikey.verify(validSignature, message)).to.be.true;
    });

    it('should resolve verification of an invalid schnorr signature to false', () => {
      expect(multikey.verify(invalidSignature, message)).to.be.false;
    });

    it('should contain a CompressedSecp256k1PublicKey in x-only base58btc format', () => {
      const publicKey = multikey.publicKey;
      expect(publicKey).to.exist.and.to.be.instanceOf(CompressedSecp256k1PublicKey);
      expect(publicKey.multibase.encoded).to.equal(publicKeyMultibase);
    });

    it('should decode publicKeyMultibase from Multikey Format to bytes', () => {
      expect(multikey.publicKey.encode()).to.equal(publicKeyMultibase);
    });

    it('should have a matching full id', () => {
      expect(multikey.fullId()).to.equal(fullId);
    });

    it('should return a valid, matching verification method', () => {
      expect(JSON.deepEqual(multikey.toVerificationMethod(), verificationMethod)).to.equal(true);
    });

    it('should construct a valid Multikey with matching data given a valid verification method', () => {
      const multikeyFromVm = multikey.fromVerificationMethod(verificationMethod);
      expect(multikeyFromVm).to.exist.and.to.be.instanceOf(SchnorrMultikey);
      expect(multikeyFromVm.id).to.equal(id);
      expect(multikeyFromVm.controller).to.equal(controller);
      expect(multikeyFromVm.publicKey).to.exist.and.to.be.instanceOf(CompressedSecp256k1PublicKey);
      expect(multikeyFromVm.publicKey.equals(schnorrKeyPair.publicKey)).to.be.true;
    });
  });

  /**
   * Key Pair with Public Key passed only
   */
  describe('Verification SchnorrKeyPair (CompressedSecp256k1PublicKey-Only)', () => {
    const keys = new SchnorrKeyPair({ publicKey });
    const multikey = new SchnorrMultikey({ id, controller, keys });

    it('should successfully construct a new SchnorrMultikey with publicKey only', () => {
      expect(multikey).to.exist.and.to.be.instanceOf(SchnorrMultikey);
      expect(multikey.publicKey).to.exist.and.to.be.instanceOf(CompressedSecp256k1PublicKey);
    });

    it('should have proper variables: id, controller, publicKey', () => {
      expect(multikey.id).to.equal(id);
      expect(multikey.controller).to.equal(controller);
      expect(() => multikey.secretKey).to.throw(KeyPairError, 'Secret key not available');
      expect(multikey.publicKey).to.exist.and.to.be.instanceOf(CompressedSecp256k1PublicKey);
      expect(multikey.publicKey.equals(publicKey)).to.be.true;
    });

    it('should throw KeyPairError', () => {
      expect(() => multikey.sign(message))
        .to.throw(KeyPairError, 'Secret key not available');
    });

    it('should verify that a valid schnorr signature was produced by the Multikey', () => {
      expect(multikey.verify(validSignature, message)).to.be.true;
    });

    it('should verify that an invalid schnorr signature was not produced by the Multikey', () => {
      expect(multikey.verify(invalidSignature, message)).to.be.false;
    });

    it('should encode publicKey from bytes to Multikey Format', () => {
      expect(multikey.publicKey.encode()).to.equal(publicKeyMultibase);
    });

    it('should decode publicKeyMultibase from Multikey Format to bytes', () => {
      expect(multikey.publicKey.decode()).to.be.instanceOf(Uint8Array);
    });

    it('should have a matching full id', () => {
      expect(multikey.fullId()).to.equal(fullId);
    });

    it('should return a valid, matching verification method', () => {
      expect(JSON.deepEqual(multikey.toVerificationMethod(), verificationMethod)).to.equal(true);
    });

    it('should construct a valid Multikey with matching data given a valid verification method', () => {
      const multikeyFromVm = multikey.fromVerificationMethod(verificationMethod);
      expect(multikeyFromVm).to.exist.and.to.be.instanceOf(SchnorrMultikey);
      expect(multikeyFromVm.id).to.equal(id);
      expect(multikeyFromVm.controller).to.equal(controller);
      expect(multikeyFromVm.publicKey).to.exist.and.to.be.instanceOf(CompressedSecp256k1PublicKey);
      expect(multikeyFromVm.publicKey.equals(publicKey)).to.be.true;
    });
  });

  /**
   * Key Pair with PrivateKey passed only
   */
  describe('Sign/Verify SchnorrKeyPair (PrivateKey-CompressedSecp256k1PublicKey)', () => {
    const keys = new SchnorrKeyPair({ secretKey: schnorrKeyPair.secretKey });
    const multikey = new SchnorrMultikey({ id, controller, keys });

    it('should successfully construct a new SchnorrMultikey with a keyPair', () => {
      expect(multikey).to.exist.and.to.be.instanceOf(SchnorrMultikey);
    });

    it('should have proper variables: id, controller, keyPair', () => {
      expect(multikey.id).to.equal(id);
      expect(multikey.controller).to.equal(controller);
      expect(multikey.publicKey).to.exist.and.to.be.instanceOf(CompressedSecp256k1PublicKey);
      expect(multikey.secretKey).to.exist.and.to.be.instanceOf(Secp256k1SecretKey);
      expect(multikey.secretKey.equals(keys.secretKey)).to.be.true;
      expect(multikey.publicKey.equals(keys.publicKey)).to.be.true;
    });

    it('should create a valid schnorr signature', () => {
      const signature = multikey.sign(message);
      expect(signature).to.exist.and.to.be.instanceOf(Uint8Array);
      expect(signature.length).to.equal(64);
    });

    it('should verify that a valid schnorr signature was produced by the Multikey', () => {
      expect(multikey.verify(validSignature, message)).to.be.true;
    });

    it('should verify that an invalid schnorr signature was not produced by the Multikey', () => {
      expect(multikey.verify(invalidSignature, message)).to.be.false;
    });

    it('should encode publicKey from bytes to Multikey Format', () => {
      expect(multikey.publicKey.encode()).to.equal(publicKeyMultibase);
    });

    it('should decode publicKeyMultibase from Multikey Format to public key bytes', () => {
      expect(multikey.publicKey.decode()).to.be.instanceOf(Uint8Array);
    });

    it('should have a matching full id', () => {
      expect(multikey.fullId()).to.equal(fullId);
    });

    it('should return a valid, matching verification method', () => {
      expect(JSON.deepEqual(multikey.toVerificationMethod(), verificationMethod)).to.equal(true);
    });

    it('should construct a valid Multikey with matching data given a valid verification method', () => {
      const multikeyFromVm = multikey.fromVerificationMethod(verificationMethod);
      expect(multikeyFromVm).to.exist.and.to.be.instanceOf(SchnorrMultikey);
      expect(multikeyFromVm.id).to.equal(id);
      expect(multikeyFromVm.controller).to.equal(controller);
      expect(multikeyFromVm.publicKey).to.exist.and.to.be.instanceOf(CompressedSecp256k1PublicKey);
      expect(multikeyFromVm.publicKey.equals(publicKey)).to.be.true;
    });
  });

  /**
   * Key Pair from Secret
   */
  describe('Sign/Verify SchnorrKeyPair (Secp256k1SecretKey.fromEntropy)', () => {
    const SECRET = 31408844715744742771434292216794392628447163656691664006588916258271600228809n;
    const secretKey = Secp256k1SecretKey.fromEntropy(SECRET);
    const keys = new SchnorrKeyPair({ secretKey });
    const multikey = new SchnorrMultikey({ id, controller, keys });

    it('should successfully construct a new SchnorrMultikey with a keyPair', () => {
      expect(multikey).to.exist.and.to.be.instanceOf(SchnorrMultikey);
    });

    it('should have proper variables: id, controller, keyPair', () => {
      expect(multikey.id).to.equal(id);
      expect(multikey.controller).to.equal(controller);
      expect(multikey.publicKey).to.exist.and.to.be.instanceOf(CompressedSecp256k1PublicKey);
      expect(multikey.secretKey).to.exist.and.to.be.instanceOf(Secp256k1SecretKey);
      expect(multikey.secretKey.equals(secretKey)).to.be.true;
      expect(multikey.publicKey.equals(publicKey)).to.be.true;
      expect(multikey.secretKey.seed).to.equal(SECRET);
    });

    it('should create a valid schnorr signature', () => {
      const signature = multikey.sign(message);
      expect(signature).to.exist.and.to.be.instanceOf(Uint8Array);
      expect(signature.length).to.equal(64);
    });

    it('should verify that a valid schnorr signature was produced by the Multikey', () => {
      expect(multikey.verify(validSignature, message)).to.be.true;
    });

    it('should verify that an invalid schnorr signature was not produced by the Multikey', () => {
      expect(multikey.verify(invalidSignature, message)).to.be.false;
    });

    it('should encode publicKey from bytes to Multikey Format', () => {
      expect(multikey.publicKey.encode()).to.equal(publicKeyMultibase);
    });

    it('should decode publicKeyMultibase from Multikey Format to public key bytes', () => {
      expect(multikey.publicKey.decode()).to.be.instanceOf(Uint8Array);
    });

    it('should have a matching full id', () => {
      expect(multikey.fullId()).to.equal(fullId);
    });

    it('should return a valid, matching verification method', () => {
      expect(JSON.deepEqual(multikey.toVerificationMethod(), verificationMethod)).to.equal(true);
    });

    it('should construct a valid Multikey with matching data given a valid verification method', () => {
      const multikeyFromVm = multikey.fromVerificationMethod(verificationMethod);
      expect(multikeyFromVm).to.exist.and.to.be.instanceOf(SchnorrMultikey);
      expect(multikeyFromVm.id).to.equal(id);
      expect(multikeyFromVm.controller).to.equal(controller);
      expect(multikeyFromVm.publicKey).to.exist.and.to.be.instanceOf(CompressedSecp256k1PublicKey);
      expect(multikeyFromVm.publicKey.equals(publicKey)).to.be.true;
      expect(() => multikeyFromVm.secretKey?.seed).to.throw(KeyPairError, 'Secret key not available');
    });
  });
});
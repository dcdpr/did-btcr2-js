import { SchnorrKeyPair } from '@did-btcr2/keypair';
import { expect } from 'chai';
import { KeyManagerError } from '@did-btcr2/common';
import { Kms } from '../src/index.js';

describe('Kms', () => {
  it('constructs with default MemoryStore', () => {
    const kms = new Kms();
    expect(kms).to.exist;
    expect(kms.activeKeyId).to.equal(undefined);
    expect(kms.listKeys()).to.deep.equal([]);
  });

  // -------------------------------------------------------------------------
  // importKey
  // -------------------------------------------------------------------------

  describe('importKey', () => {
    it('generates a URN-style key identifier by default', () => {
      const kms = new Kms();
      const kp = SchnorrKeyPair.generate();
      const id = kms.importKey(kp);
      expect(id).to.match(/^urn:kms:secp256k1:[0-9a-f]{16}$/);
    });

    it('does not set active by default', () => {
      const kms = new Kms();
      kms.importKey(SchnorrKeyPair.generate());
      expect(kms.activeKeyId).to.equal(undefined);
    });

    it('sets active when setActive: true', () => {
      const kms = new Kms();
      const id = kms.importKey(SchnorrKeyPair.generate(), { setActive: true });
      expect(kms.activeKeyId).to.equal(id);
    });

    it('accepts a custom id', () => {
      const kms = new Kms();
      const customId = 'urn:kms:secp256k1:custom-id';
      const id = kms.importKey(SchnorrKeyPair.generate(), { id: customId });
      expect(id).to.equal(customId);
      expect(kms.listKeys()).to.deep.equal([customId]);
    });

    it('stores metadata tags', () => {
      const kms = new Kms();
      const tags = { derivationPath: 'm/86\'/0\'/0\'/0/0', account: '0' };
      const id = kms.importKey(SchnorrKeyPair.generate(), { tags });
      expect(kms.listKeys()).to.deep.equal([id]);
    });

    it('computes publicKey when only secretKey provided', () => {
      const kms = new Kms();
      const kp = SchnorrKeyPair.generate();
      const secOnly = new SchnorrKeyPair({ secretKey: kp.secretKey });
      const id = kms.importKey(secOnly);
      expect(id).to.be.a('string');
      expect(kms.getPublicKey(id)).to.be.instanceOf(Uint8Array);
    });

    it('throws KEY_FOUND for duplicate key', () => {
      const kms = new Kms();
      const kp = SchnorrKeyPair.generate();
      const id = kms.importKey(kp);
      expect(() => kms.importKey(kp, { id })).to.throw(
        KeyManagerError, `Key already exists: ${id}`
      );
    });

    it('imports public-key-only (watch-only) entries', () => {
      const kms = new Kms();
      const kp = SchnorrKeyPair.generate();
      const pubOnly = new SchnorrKeyPair({ publicKey: kp.publicKey });
      const id = kms.importKey(pubOnly);
      expect(kms.getPublicKey(id)).to.deep.equal(kp.publicKey.compressed);
    });
  });

  // -------------------------------------------------------------------------
  // getPublicKey
  // -------------------------------------------------------------------------

  describe('getPublicKey', () => {
    it('returns public key by explicit id', () => {
      const kms = new Kms();
      const kp = SchnorrKeyPair.generate();
      const id = kms.importKey(kp, { setActive: true });
      expect(kms.getPublicKey(id)).to.deep.equal(kp.publicKey.compressed);
    });

    it('returns public key for active key when no id provided', () => {
      const kms = new Kms();
      const kp = SchnorrKeyPair.generate();
      kms.importKey(kp, { setActive: true });
      expect(kms.getPublicKey()).to.deep.equal(kp.publicKey.compressed);
    });

    it('throws when no active key set and no id provided', () => {
      const kms = new Kms();
      expect(() => kms.getPublicKey()).to.throw(KeyManagerError, 'No active key set');
    });
  });

  // -------------------------------------------------------------------------
  // setActiveKey
  // -------------------------------------------------------------------------

  describe('setActiveKey', () => {
    it('sets the active key', () => {
      const kms = new Kms();
      const id = kms.importKey(SchnorrKeyPair.generate());
      expect(kms.activeKeyId).to.equal(undefined);
      kms.setActiveKey(id);
      expect(kms.activeKeyId).to.equal(id);
    });

    it('throws for non-existent key', () => {
      const kms = new Kms();
      expect(() => kms.setActiveKey('missing-id')).to.throw(
        KeyManagerError, 'Key not found: missing-id'
      );
    });
  });

  // -------------------------------------------------------------------------
  // sign / verify
  // -------------------------------------------------------------------------

  describe('sign / verify', () => {
    it('signs and verifies with Schnorr (default)', () => {
      const kms = new Kms();
      const id = kms.importKey(SchnorrKeyPair.generate(), { setActive: true });
      const digest = kms.digest(new Uint8Array([1, 2, 3]));
      const sig = kms.sign(digest, id);
      expect(sig).to.be.instanceOf(Uint8Array);
      expect(kms.verify(sig, digest, id)).to.equal(true);
    });

    it('signs and verifies with ECDSA', () => {
      const kms = new Kms();
      const id = kms.importKey(SchnorrKeyPair.generate(), { setActive: true });
      const digest = kms.digest(new Uint8Array([4, 5, 6]));
      const sig = kms.sign(digest, id, { scheme: 'ecdsa' });
      expect(sig).to.be.instanceOf(Uint8Array);
      expect(kms.verify(sig, digest, id, { scheme: 'ecdsa' })).to.equal(true);
    });

    it('signs and verifies using active key when no id provided', () => {
      const kms = new Kms();
      kms.importKey(SchnorrKeyPair.generate(), { setActive: true });
      const digest = kms.digest(new Uint8Array([7, 8, 9]));
      const sig = kms.sign(digest);
      expect(kms.verify(sig, digest)).to.equal(true);
    });

    it('throws KEY_NOT_SIGNER for public-key-only entries', () => {
      const kms = new Kms();
      const kp = SchnorrKeyPair.generate();
      const pubOnly = new SchnorrKeyPair({ publicKey: kp.publicKey });
      const id = kms.importKey(pubOnly, { setActive: true });
      const digest = kms.digest(new Uint8Array([1, 2, 3]));
      expect(() => kms.sign(digest, id)).to.throw(
        KeyManagerError, 'Key is not a signing key'
      );
    });

    it('verify works for public-key-only entries', () => {
      const kms = new Kms();
      const kp = SchnorrKeyPair.generate();

      // Sign externally with the secret key
      const digest = kms.digest(new Uint8Array([1, 2, 3]));
      const sig = kp.secretKey.sign(digest);

      // Import as public-only and verify through the KMS
      const pubOnly = new SchnorrKeyPair({ publicKey: kp.publicKey });
      const id = kms.importKey(pubOnly, { setActive: true });
      expect(kms.verify(sig, digest, id)).to.equal(true);
    });
  });

  // -------------------------------------------------------------------------
  // removeKey
  // -------------------------------------------------------------------------

  describe('removeKey', () => {
    it('throws when removing active key without force', () => {
      const kms = new Kms();
      const id = kms.importKey(SchnorrKeyPair.generate(), { setActive: true });
      expect(() => kms.removeKey(id)).to.throw(
        KeyManagerError,
        'Cannot remove active key (use "force": true or switch active key)'
      );
    });

    it('throws for non-existent key', () => {
      const kms = new Kms();
      expect(() => kms.removeKey('no-such-id', { force: true })).to.throw(
        KeyManagerError, 'Key not found: no-such-id'
      );
    });

    it('removes with force and clears active', () => {
      const kms = new Kms();
      const id = kms.importKey(SchnorrKeyPair.generate(), { setActive: true });
      kms.removeKey(id, { force: true });
      expect(kms.activeKeyId).to.equal(undefined);
      expect(kms.listKeys()).to.deep.equal([]);
    });

    it('removes non-active key without force', () => {
      const kms = new Kms();
      const id = kms.importKey(SchnorrKeyPair.generate());
      kms.removeKey(id);
      expect(kms.listKeys()).to.deep.equal([]);
    });
  });

  // -------------------------------------------------------------------------
  // digest
  // -------------------------------------------------------------------------

  describe('digest', () => {
    it('computes deterministic SHA-256', () => {
      const kms = new Kms();
      const data = new Uint8Array([9, 9, 9]);
      const a = kms.digest(data);
      const b = kms.digest(data);
      expect(a).to.be.instanceOf(Uint8Array);
      expect(Buffer.from(a).toString('hex')).to.equal(Buffer.from(b).toString('hex'));
    });
  });

  // -------------------------------------------------------------------------
  // generateKey
  // -------------------------------------------------------------------------

  describe('generateKey', () => {
    it('generates a key with URN identifier', () => {
      const kms = new Kms();
      const id = kms.generateKey();
      expect(id).to.match(/^urn:kms:secp256k1:[0-9a-f]{16}$/);
      expect(kms.listKeys()).to.deep.equal([id]);
    });

    it('does not set active by default', () => {
      const kms = new Kms();
      kms.generateKey();
      expect(kms.activeKeyId).to.equal(undefined);
    });

    it('sets active when setActive: true', () => {
      const kms = new Kms();
      const id = kms.generateKey({ setActive: true });
      expect(kms.activeKeyId).to.equal(id);
    });

    it('stores metadata tags', () => {
      const kms = new Kms();
      const id = kms.generateKey({ tags: { purpose: 'test' } });
      expect(kms.listKeys()).to.deep.equal([id]);
    });

    it('generated key can sign and verify', () => {
      const kms = new Kms();
      const id = kms.generateKey({ setActive: true });
      const digest = kms.digest(new Uint8Array([4, 5, 6]));
      const sig = kms.sign(digest, id);
      expect(kms.verify(sig, digest, id)).to.equal(true);
    });
  });

  // -------------------------------------------------------------------------
  // exportKey (concrete-class-only)
  // -------------------------------------------------------------------------

  describe('exportKey', () => {
    it('exports a full key pair for signing keys', () => {
      const kms = new Kms();
      const id = kms.generateKey({ setActive: true });
      const exported = kms.exportKey(id);
      expect(exported).to.be.instanceOf(SchnorrKeyPair);
      expect(exported.secretKey).to.exist;
    });

    it('exports a public-key-only pair for watch-only keys', () => {
      const kms = new Kms();
      const kp = SchnorrKeyPair.generate();
      const pubOnly = new SchnorrKeyPair({ publicKey: kp.publicKey });
      const id = kms.importKey(pubOnly);
      const exported = kms.exportKey(id);
      expect(exported).to.be.instanceOf(SchnorrKeyPair);
      expect(exported.publicKey.compressed).to.deep.equal(kp.publicKey.compressed);
    });
  });
});

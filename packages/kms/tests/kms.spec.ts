import { SchnorrKeyPair } from '@did-btcr2/keypair';
import { expect, use } from 'chai';
import { Kms } from '../src/index.js';
import { KeyManagerError } from '@did-btcr2/common';
import chaiAsPromised from 'chai-as-promised';

use(chaiAsPromised);

/**
 * Did Btcr2 KMS Test
 */
describe('KMS Test', () => {
  it('constructs with default MemoryStore', () => {
    const kms = new Kms();
    expect(kms).to.exist;
    expect(kms.activeKeyId).to.equal(undefined);
    expect(kms.listKeys()).to.deep.equal([]);
  });

  it('importKey: sets active by default and lists the key', () => {
    const kms = new Kms();
    const kp = SchnorrKeyPair.generate();
    const id = kms.importKey(kp);
    expect(id).to.equal(kp.publicKey.hex);
    expect(kms.activeKeyId).to.equal(id);
    expect(kms.listKeys()).to.deep.equal([id]);
  });

  it('importKey: sets active to custom id and lists the key', () => {
    const kms = new Kms();
    const kp = SchnorrKeyPair.generate();
    const id = `urn:kms:secp256k1:${kp.publicKey.hex}`;
    kms.importKey(kp, { id });
    expect(kms.listKeys()).to.deep.equal([id]);
    expect(kms.activeKeyId).to.equal(id);
  });

  it('importKey: computes publicKey if missing', () => {
    const kms = new Kms();
    const kp = SchnorrKeyPair.generate();
    const secOnly = new SchnorrKeyPair({ secretKey: kp.secretKey });
    const id = kms.importKey(secOnly);
    expect(id).to.be.a('string');
    expect(kms.activeKeyId).to.equal(id);
    expect(kms.getPublicKey(id)).to.be.instanceOf(Uint8Array);
  });

  it('importKey: duplicate throws KEY_FOUND', () => {
    const kms = new Kms();
    const kp = SchnorrKeyPair.generate();
    const id = kms.importKey(kp);
    expect(() => kms.importKey(kp, { id })).to.throw(KeyManagerError, `Key already exists: ${id}`);
  });

  it('getPublicKey: explicit id and via active; error when no active', () => {
    const kms1 = new Kms();
    const kp = SchnorrKeyPair.generate();
    const id = kms1.importKey(kp, { setActive: true });
    expect(kms1.getPublicKey(id)).to.deep.equal(kp.publicKey.compressed);
    expect(kms1.getPublicKey()).to.deep.equal(kp.publicKey.compressed);

    const kms2 = new Kms();
    expect(() => kms2.getPublicKey()).to.throw(KeyManagerError, 'No active key set');
  });

  it('setActiveKey: ok and not found error', () => {
    const kms = new Kms();
    const id = kms.importKey(SchnorrKeyPair.generate(), { setActive: false });
    expect(kms.activeKeyId).to.equal(undefined);
    kms.setActiveKey(id);
    expect(kms.activeKeyId).to.equal(id);
    expect(() => kms.setActiveKey('missing-id')).to.throw(KeyManagerError, 'Key not found: missing-id');
  });

  it('sign/verify: happy path', () => {
    const kms = new Kms();
    const id = kms.importKey(SchnorrKeyPair.generate());
    const msg = new Uint8Array([1, 2, 3]);
    const digest = kms.digest(msg);
    const sig = kms.sign(digest, id);
    expect(sig).to.be.instanceOf(Uint8Array);
    expect(kms.verify(sig, digest, id)).to.equal(true);
  });

  it('removeKey: active without force throws; not found throws; forced removes and clears active', () => {
    const kms = new Kms();
    const id = kms.importKey(SchnorrKeyPair.generate());
    expect(() => kms.removeKey(id)).to.throw(
      KeyManagerError,
      'Cannot remove active key (use "force": true or switch active key)'
    );

    expect(() => kms.removeKey('no-such-id', { force: true })).to.throw(
      KeyManagerError,
      'Key not found: no-such-id'
    );

    kms.removeKey(id, { force: true });
    expect(kms.activeKeyId).to.equal(undefined);
    expect(kms.listKeys()).to.deep.equal([]);
  });

  it('digest: deterministic sha256', () => {
    const kms = new Kms();
    const data = new Uint8Array([9, 9, 9]);
    const a = kms.digest(data);
    const b = kms.digest(data);
    expect(a).to.be.instanceOf(Uint8Array);
    expect(Buffer.from(a).toString('hex')).to.equal(Buffer.from(b).toString('hex'));
  });

  it('generateKey: returns id, stores and sets active', () => {
    const kms = new Kms();
    const id = kms.generateKey();
    expect(typeof id).to.equal('string');
    expect(kms.activeKeyId).to.equal(id);
    expect(kms.listKeys()).to.deep.equal([id]);
    const msg = new Uint8Array([4, 5, 6]);
    const digest = kms.digest(msg);
    const sig = kms.sign(digest, id);
    expect(kms.verify(sig, digest, id)).to.equal(true);
  });

  it('static getKey: throws when not initialized', () => {
    expect(() => Kms.getKey()).to.throw(KeyManagerError, 'Kms instance not initialized');
  });

  it('static initialize: auto-generate when keyPair not provided; second call returns same instance; getKey works', () => {
    const instance1 = Kms.initialize(undefined as unknown as SchnorrKeyPair, 'my-key-id');
    expect(instance1).to.be.instanceOf(Kms);
    const kp = SchnorrKeyPair.generate();
    const instance2 = Kms.initialize(kp, 'another-id');
    expect(instance2).to.equal(instance1);
    const pair = Kms.getKey('my-key-id');
    expect(pair).to.exist;
    const pair2 = Kms.getKey();
    expect(pair2).to.exist;
  });

});
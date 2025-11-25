import { expect } from 'chai';
import { SchnorrKeyPair } from '@did-btcr2/keypair';
import type { HashBytes, KeyBytes, SignatureBytes } from '@did-btcr2/common';
import { KeyManagerApi } from '../src/index.js';
import type { KeyManager } from '@did-btcr2/kms';

/**
 * KeyManagerApi Test
 */
describe('KeyManagerApi', () => {
  it('should construct with default KMS', () => {
    const kmsApi = new KeyManagerApi();
    expect(kmsApi.kms).to.exist;
  });

  it('generateKey() returns a key id and lists it', () => {
    const kmsApi = new KeyManagerApi();
    const id = kmsApi.generateKey();
    expect(id).to.be.a('string');
    expect(kmsApi.listKeys()).to.include(id);
  });

  it('import() and export() round-trip', () => {
    const kmsApi = new KeyManagerApi();
    const kp = SchnorrKeyPair.generate();
    const id = kmsApi.import(kp);
    expect(id).to.be.a('string');
    const exported = kmsApi.export(id);
    expect(exported).to.be.instanceOf(SchnorrKeyPair);
  });

  it('setActive() changes the active key', () => {
    const kmsApi = new KeyManagerApi();
    const id = kmsApi.generateKey();
    const id2 = kmsApi.generateKey();
    kmsApi.setActive(id);
    expect(kmsApi.getPublicKey()).to.be.instanceOf(Uint8Array);
    kmsApi.setActive(id2);
    expect(kmsApi.getPublicKey()).to.be.instanceOf(Uint8Array);
  });

  it('getPublicKey() returns bytes for explicit id', () => {
    const kmsApi = new KeyManagerApi();
    const id = kmsApi.generateKey();
    const pk = kmsApi.getPublicKey(id);
    expect(pk).to.be.instanceOf(Uint8Array);
  });

  it('removeKey() removes a non-active key', () => {
    const kmsApi = new KeyManagerApi();
    const kp = SchnorrKeyPair.generate();
    const id = kmsApi.import(kp, { setActive: false });
    kmsApi.removeKey(id);
    expect(kmsApi.listKeys()).to.not.include(id);
  });

  it('removeKey() with force removes active key', () => {
    const kmsApi = new KeyManagerApi();
    const id = kmsApi.generateKey();
    kmsApi.removeKey(id, { force: true });
    expect(kmsApi.listKeys()).to.deep.equal([]);
  });

  it('sign() and verify() round-trip', () => {
    const kmsApi = new KeyManagerApi();
    const id = kmsApi.generateKey();
    const data = new Uint8Array([10, 20, 30]);
    const digest = kmsApi.digest(data);
    const sig = kmsApi.sign(digest, id);
    expect(sig).to.be.instanceOf(Uint8Array);
    expect(kmsApi.verify(sig, digest, id)).to.equal(true);
  });

  it('sign() rejects empty data', () => {
    const kmsApi = new KeyManagerApi();
    kmsApi.generateKey();
    expect(() => kmsApi.sign(new Uint8Array(0))).to.throw('data must be a non-empty Uint8Array');
  });

  it('digest() is deterministic', () => {
    const kmsApi = new KeyManagerApi();
    const data = new Uint8Array([7, 8, 9]);
    const a = kmsApi.digest(data);
    const b = kmsApi.digest(data);
    expect(Buffer.from(a).toString('hex')).to.equal(Buffer.from(b).toString('hex'));
  });

  // --- export() with non-Kms KeyManager ---

  it('export() throws when backing KMS does not support export', () => {
    const fakeKms: KeyManager = {
      generateKey  : () => 'key-1',
      setActiveKey : () => {},
      importKey    : () => 'key-1',
      removeKey    : () => {},
      listKeys     : () => ['key-1'],
      getPublicKey : () => new Uint8Array(33) as KeyBytes,
      sign         : () => new Uint8Array(64) as SignatureBytes,
      verify       : () => true,
      digest       : () => new Uint8Array(32) as HashBytes,
    };
    const kmsApi = new KeyManagerApi(fakeKms);
    expect(() => kmsApi.export('key-1')).to.throw('Key export is not supported');
  });
});

import { chmodSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { KeyEntry } from '@did-btcr2/key-manager';
import { FileKeyStore } from '../src/keystore/file-key-store.js';
import type { ArgonParams } from '../src/keystore/envelope.js';
import { KeyStoreError } from '../src/keystore/error.js';
import { expect } from './helpers.js';

// Low-cost argon2id parameters keep the suite well under the mocha timeout.
const FAST: ArgonParams = { t: 1, m: 256, p: 1, dkLen: 32 };
const PASS = 'test passphrase';

function tmpKeystore(): string {
  const dir = mkdtempSync(join(tmpdir(), 'btcr2-keystore-'));
  return join(dir, 'keystore.json');
}

function signingEntry(seed: number): KeyEntry {
  return {
    secretKey : new Uint8Array(32).fill(seed),
    publicKey : new Uint8Array(33).fill(seed),
    tags      : { name: `key-${seed}` },
  };
}

function watchOnlyEntry(seed: number): KeyEntry {
  return {
    publicKey : new Uint8Array(33).fill(seed),
    tags      : { name: `watch-${seed}` },
  };
}

function openStore(path: string, getPassphrase: () => string = () => PASS): FileKeyStore {
  return new FileKeyStore({ path, getPassphrase, argonParams: FAST });
}

describe('FileKeyStore', () => {
  let path: string;

  beforeEach(() => { path = tmpKeystore(); });

  afterEach(() => { rmSync(join(path, '..'), { recursive: true, force: true }); });

  it('round-trips a signing key through set/has/get/delete', () => {
    const store = openStore(path);
    store.set('urn:a', signingEntry(1));
    expect(store.has('urn:a')).to.equal(true);
    const got = store.get('urn:a');
    expect(Array.from(got!.secretKey!)).to.deep.equal(Array.from(new Uint8Array(32).fill(1)));
    expect(Array.from(got!.publicKey)).to.deep.equal(Array.from(new Uint8Array(33).fill(1)));
    expect(got!.tags).to.deep.equal({ name: 'key-1' });
    expect(store.delete('urn:a')).to.equal(true);
    expect(store.has('urn:a')).to.equal(false);
  });

  it('persists keys across instances', () => {
    openStore(path).set('urn:a', signingEntry(2));
    const reopened = openStore(path);
    expect(Array.from(reopened.get('urn:a')!.secretKey!))
      .to.deep.equal(Array.from(new Uint8Array(32).fill(2)));
  });

  it('encrypts signing keys on disk and stores watch-only keys in clear', () => {
    const store = openStore(path);
    store.set('urn:sign', signingEntry(3));
    store.set('urn:watch', watchOnlyEntry(4));
    const onDisk = JSON.parse(readFileSync(path, 'utf-8'));
    expect(onDisk.keys['urn:sign'].secret.cipher).to.equal('xchacha20poly1305');
    expect(onDisk.keys['urn:sign'].publicKey).to.be.a('string');
    expect(onDisk.keys['urn:watch']).to.not.have.property('secret');
    expect(onDisk.keys['urn:watch'].publicKey).to.be.a('string');
  });

  it('rejects a wrong passphrase when the secret is accessed', () => {
    openStore(path).set('urn:a', signingEntry(5));
    const wrong = openStore(path, () => 'wrong');
    expect(() => wrong.get('urn:a')!.secretKey)
      .to.throw(KeyStoreError).with.property('type', 'DECRYPT_ERROR');
  });

  it('entries() and list() omit secrets and never prompt; get materializes lazily', () => {
    openStore(path).set('urn:a', signingEntry(6));
    let calls = 0;
    const reopened = openStore(path, () => { calls += 1; return PASS; });
    const entries = reopened.entries();
    const list = reopened.list();
    expect(entries[0][1].secretKey).to.equal(undefined);
    expect(list[0].secretKey).to.equal(undefined);
    expect(list[0].publicKey).to.be.instanceOf(Uint8Array);
    expect(calls).to.equal(0);
    const got = reopened.get('urn:a');
    expect(calls).to.equal(0); // get() alone does not decrypt
    expect(got!.secretKey).to.be.instanceOf(Uint8Array); // accessing the secret does
    expect(calls).to.equal(1);
  });

  it('preserves the active pointer across mutations and instances', () => {
    const store = openStore(path);
    store.set('urn:a', signingEntry(1));
    store.set('urn:b', signingEntry(2));
    store.setActive('urn:b');
    store.set('urn:c', signingEntry(3));
    expect(store.getActive()).to.equal('urn:b');
    expect(openStore(path).getActive()).to.equal('urn:b');
  });

  it('clears the active pointer when the active key is deleted', () => {
    const store = openStore(path);
    store.set('urn:a', signingEntry(1));
    store.setActive('urn:a');
    store.delete('urn:a');
    expect(store.getActive()).to.equal(undefined);
  });

  it('rejects setting an unknown key as active', () => {
    const store = openStore(path);
    expect(() => store.setActive('urn:missing'))
      .to.throw(KeyStoreError).with.property('type', 'KEY_NOT_FOUND_ERROR');
  });

  it('writes a 0600 file in a 0700 directory and leaves no temp file', function () {
    if (process.platform === 'win32') return this.skip();
    const store = openStore(path);
    store.set('urn:a', signingEntry(1));
    expect(statSync(path).mode & 0o777).to.equal(0o600);
    expect(statSync(join(path, '..')).mode & 0o777).to.equal(0o700);
    expect(readdirSync(join(path, '..')).filter(f => f.endsWith('.tmp'))).to.deep.equal([]);
  });

  it('fails closed on insecure file permissions', function () {
    if (process.platform === 'win32') return this.skip();
    writeFileSync(path, '{"v":1,"keys":{}}', { mode: 0o644 });
    chmodSync(path, 0o644); // force group/other-readable regardless of umask
    expect(() => openStore(path)).to.throw(KeyStoreError).with.property('type', 'KEYSTORE_PERMISSION_ERROR');
  });

  it('rejects a corrupt keystore file', () => {
    writeFileSync(path, 'not json', { mode: 0o600 });
    expect(() => openStore(path)).to.throw(KeyStoreError).with.property('type', 'KEYSTORE_CORRUPT_ERROR');
  });
});

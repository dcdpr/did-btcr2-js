import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { keystoreApiFactory } from '../src/config.js';
import type { ArgonParams } from '../src/keystore/envelope.js';
import { FileKeyStore } from '../src/keystore/file-key-store.js';
import { ENV_KEYSTORE_PASSPHRASE } from '../src/keystore/passphrase.js';
import { expect } from './helpers.js';

const FAST: ArgonParams = { t: 1, m: 256, p: 1, dkLen: 32 };

describe('keystoreApiFactory', () => {
  let dir: string;
  let keystore: string;
  const savedPass = process.env[ENV_KEYSTORE_PASSPHRASE];

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'btcr2-ksfactory-'));
    keystore = join(dir, 'keystore.json');
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
    if (savedPass !== undefined) process.env[ENV_KEYSTORE_PASSPHRASE] = savedPass;
    else delete process.env[ENV_KEYSTORE_PASSPHRASE];
  });

  it('injects a keystore-backed KeyManager (a fresh store lists no keys)', () => {
    delete process.env[ENV_KEYSTORE_PASSPHRASE];
    const api = keystoreApiFactory(undefined, { keystore });
    expect(api.kms).to.exist;
    expect(api.kms.listKeys()).to.deep.equal([]);
  });

  it('persists a generated key across factory calls', function () {
    this.timeout(15000); // exercises the real factory path: production argon2id (64 MiB) runs once
    process.env[ENV_KEYSTORE_PASSPHRASE] = 'factory-pass';
    const id = keystoreApiFactory(undefined, { keystore }).kms.generateKey();
    expect(keystoreApiFactory(undefined, { keystore }).kms.listKeys()).to.deep.equal([id]);
  });

  it('re-applies a persisted active pointer at construction without a passphrase', () => {
    // Seed a signing key and a persisted active pointer directly via the store.
    const store = new FileKeyStore({ path: keystore, getPassphrase: () => 'seed-pass', argonParams: FAST });
    const id = 'urn:kms:secp256k1:seedkey';
    store.set(id, { secretKey: new Uint8Array(32).fill(7), publicKey: new Uint8Array(33).fill(7) });
    store.setActive(id);
    // No passphrase available now: applying the active pointer must not decrypt.
    delete process.env[ENV_KEYSTORE_PASSPHRASE];
    const api = keystoreApiFactory(undefined, { keystore });
    expect(api.kms.kms.activeKeyId).to.equal(id);
    expect(api.kms.listKeys()).to.deep.equal([id]);
  });
});

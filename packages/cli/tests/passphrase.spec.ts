import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { acquirePassphrase, ENV_KEYSTORE_PASSPHRASE } from '../src/keystore/passphrase.js';
import { KeyStoreError } from '../src/keystore/error.js';
import { expect } from './helpers.js';

describe('acquirePassphrase', () => {
  const saved = process.env[ENV_KEYSTORE_PASSPHRASE];

  afterEach(() => {
    if (saved !== undefined) process.env[ENV_KEYSTORE_PASSPHRASE] = saved;
    else delete process.env[ENV_KEYSTORE_PASSPHRASE];
  });

  it('reads the passphrase from the environment', () => {
    process.env[ENV_KEYSTORE_PASSPHRASE] = 'env-pass';
    expect(acquirePassphrase()).to.equal('env-pass');
  });

  it('reads the passphrase from a file, trimming a trailing newline', () => {
    delete process.env[ENV_KEYSTORE_PASSPHRASE];
    const dir = mkdtempSync(join(tmpdir(), 'btcr2-pass-'));
    const file = join(dir, 'pass.txt');
    writeFileSync(file, 'file-pass\n');
    try {
      expect(acquirePassphrase({ passphraseFile: file })).to.equal('file-pass');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('prefers the environment over a passphrase file', () => {
    process.env[ENV_KEYSTORE_PASSPHRASE] = 'env-wins';
    expect(acquirePassphrase({ passphraseFile: '/nonexistent' })).to.equal('env-wins');
  });

  it('throws when no passphrase is available and standard input is not a terminal', function () {
    if (process.stdin.isTTY) return this.skip();
    delete process.env[ENV_KEYSTORE_PASSPHRASE];
    expect(() => acquirePassphrase())
      .to.throw(KeyStoreError).with.property('type', 'PASSPHRASE_REQUIRED_ERROR');
  });

  it('rejects a whitespace-only environment passphrase', () => {
    process.env[ENV_KEYSTORE_PASSPHRASE] = '   ';
    expect(() => acquirePassphrase())
      .to.throw(KeyStoreError).with.property('type', 'PASSPHRASE_REQUIRED_ERROR');
  });

  it('rejects an empty passphrase file', () => {
    delete process.env[ENV_KEYSTORE_PASSPHRASE];
    const dir = mkdtempSync(join(tmpdir(), 'btcr2-pass-'));
    const file = join(dir, 'empty.txt');
    writeFileSync(file, '\n');
    try {
      expect(() => acquirePassphrase({ passphraseFile: file }))
        .to.throw(KeyStoreError).with.property('type', 'PASSPHRASE_REQUIRED_ERROR');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

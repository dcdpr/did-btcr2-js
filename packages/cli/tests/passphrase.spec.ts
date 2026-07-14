import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { acquirePassphrase, dropLastUtf8Char, ENV_KEYSTORE_PASSPHRASE } from '../src/keystore/passphrase.js';
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

  describe('beforePrompt session source (ADR 081)', () => {
    it('consults beforePrompt after env/file and before the no-TTY failure', () => {
      delete process.env[ENV_KEYSTORE_PASSPHRASE];
      // Even on a non-TTY runner, a beforePrompt value is used instead of throwing.
      expect(acquirePassphrase({ beforePrompt: () => 'from-session' })).to.equal('from-session');
    });

    it('returns the session value verbatim (no re-normalization) and rejects an empty one', () => {
      delete process.env[ENV_KEYSTORE_PASSPHRASE];
      // The session holds the exact, already-verified passphrase; a trailing
      // newline is part of it, not formatting to strip. Re-stripping here would
      // corrupt the KDF input for a passphrase that legitimately ends in one, so
      // the value must come back byte-for-byte.
      expect(acquirePassphrase({ beforePrompt: () => 'sess\n' })).to.equal('sess\n');
      expect(acquirePassphrase({ beforePrompt: () => 'sess' })).to.equal('sess');
      expect(() => acquirePassphrase({ beforePrompt: () => '   ' }))
        .to.throw(KeyStoreError).with.property('type', 'PASSPHRASE_REQUIRED_ERROR');
    });

    it('lets the env var win over beforePrompt (never consults it)', () => {
      process.env[ENV_KEYSTORE_PASSPHRASE] = 'env-wins';
      const beforePrompt = (): string => { throw new Error('beforePrompt must not be consulted when the env var is set'); };
      expect(acquirePassphrase({ beforePrompt })).to.equal('env-wins');
    });

    it('lets --passphrase-file win over beforePrompt (never consults it)', () => {
      delete process.env[ENV_KEYSTORE_PASSPHRASE];
      const dir = mkdtempSync(join(tmpdir(), 'btcr2-pass-'));
      const file = join(dir, 'pass.txt');
      writeFileSync(file, 'file-wins\n');
      const beforePrompt = (): string => { throw new Error('beforePrompt must not be consulted when a passphrase file is set'); };
      try {
        expect(acquirePassphrase({ passphraseFile: file, beforePrompt })).to.equal('file-wins');
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    });

    it('does not consult beforePrompt under forcePrompt', function () {
      if (process.stdin.isTTY) return this.skip(); // forcePrompt would otherwise prompt
      delete process.env[ENV_KEYSTORE_PASSPHRASE];
      const beforePrompt = (): string => { throw new Error('beforePrompt must not be consulted under forcePrompt'); };
      expect(() => acquirePassphrase({ forcePrompt: true, beforePrompt }))
        .to.throw(KeyStoreError).with.property('type', 'PASSPHRASE_REQUIRED_ERROR');
    });

    it('falls through to the no-TTY failure when beforePrompt yields nothing', function () {
      if (process.stdin.isTTY) return this.skip();
      delete process.env[ENV_KEYSTORE_PASSPHRASE];
      expect(() => acquirePassphrase({ beforePrompt: () => undefined }))
        .to.throw(KeyStoreError).with.property('type', 'PASSPHRASE_REQUIRED_ERROR');
    });
  });
});

describe('dropLastUtf8Char (backspace over a hidden entry)', () => {
  const decode = (bytes: number[]): string => Buffer.from(bytes).toString('utf-8');

  it('removes a whole two-byte character rather than a single byte', () => {
    const bytes = [ ...Buffer.from('aé', 'utf-8') ]; // é = 0xC3 0xA9
    dropLastUtf8Char(bytes);
    expect(decode(bytes)).to.equal('a'); // not a lone 0xC3 that decodes to U+FFFD
  });

  it('removes a whole four-byte character (emoji)', () => {
    const bytes = [ ...Buffer.from('x😀', 'utf-8') ]; // 😀 = 0xF0 0x9F 0x98 0x80
    dropLastUtf8Char(bytes);
    expect(decode(bytes)).to.equal('x');
  });

  it('removes a single ASCII byte', () => {
    const bytes = [ ...Buffer.from('ab', 'utf-8') ];
    dropLastUtf8Char(bytes);
    expect(decode(bytes)).to.equal('a');
  });

  it('is a no-op on an empty buffer', () => {
    const bytes: number[] = [];
    dropLastUtf8Char(bytes);
    expect(bytes).to.deep.equal([]);
  });
});

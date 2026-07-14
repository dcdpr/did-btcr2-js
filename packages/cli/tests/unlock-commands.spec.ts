import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DidBtcr2Cli } from '../src/cli.js';
import type { ArgonParams } from '../src/keystore/envelope.js';
import { FileKeyStore, initKeystore } from '../src/keystore/file-key-store.js';
import { ENV_KEYSTORE_PASSPHRASE } from '../src/keystore/passphrase.js';
import { ENV_KEYSTORE_TTL } from '../src/keystore/session.js';
import { createTestApiFactory, expect, originalConsoleError, originalConsoleLog } from './helpers.js';

const FAST: ArgonParams = { t: 1, m: 256, p: 1, dkLen: 32 };
const SECRET = new Uint8Array(32).fill(7);
const SECRET_HEX = '07'.repeat(32);
const PUBLIC = new Uint8Array(33).fill(2);
const KEY_ID = 'urn:kms:secp256k1:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
const ENV_KEYS = [ 'BTCR2_HOME', ENV_KEYSTORE_PASSPHRASE, ENV_KEYSTORE_TTL ];

describe('keystore unlock / lock / status (ADR 081)', () => {
  const saved: Record<string, string | undefined> = {};
  const originalStderrWrite = process.stderr.write.bind(process.stderr);
  let dir: string;
  let home: string;
  let passFile: string;
  let out: string[];
  let err: string[];

  beforeEach(() => {
    for (const k of ENV_KEYS) { saved[k] = process.env[k]; delete process.env[k]; }
    dir = mkdtempSync(join(tmpdir(), 'btcr2-unlock-'));
    home = join(dir, 'home');
    passFile = join(dir, 'pass.txt');
    writeFileSync(passFile, 'pw\n');
    out = [];
    err = [];
    console.log = (m?: unknown) => { if (m !== undefined) out.push(String(m)); };
    console.error = (m?: unknown) => { if (m !== undefined) err.push(String(m)); };
    process.stderr.write = ((chunk: unknown): boolean => { err.push(String(chunk)); return true; }) as typeof process.stderr.write;
  });

  afterEach(() => {
    console.log = originalConsoleLog;
    console.error = originalConsoleError;
    process.stderr.write = originalStderrWrite;
    process.exitCode = 0;
    for (const k of ENV_KEYS) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; }
    rmSync(dir, { recursive: true, force: true });
  });

  async function run(...args: string[]): Promise<void> {
    await new DidBtcr2Cli(createTestApiFactory()).run(['node', 'btcr2', '--home', home, ...args]);
  }

  const keystorePath = (): string => join(home, 'keystore.json');
  const sessionPath = (): string => join(home, 'session.json');

  /** Establishes a FAST encrypted keystore (empty, established) at the home default. */
  function establishEncrypted(): void {
    initKeystore(keystorePath(), { protection: 'passphrase', argonParams: FAST, getPassphrase: () => 'pw' });
  }

  /** Establishes a FAST encrypted keystore holding one named, sealed key. */
  function establishWithKey(): void {
    new FileKeyStore({ path: keystorePath(), argonParams: FAST, getPassphrase: () => 'pw' })
      .set(KEY_ID, { publicKey: PUBLIC, secretKey: SECRET, tags: { name: 'demo' } });
  }

  function writeConfig(obj: Record<string, unknown>): void {
    mkdirSync(home, { recursive: true });
    writeFileSync(join(home, 'config.json'), JSON.stringify(obj));
  }

  describe('unlock refusals', () => {
    it('refuses when no keystore exists', async () => {
      await run('keystore', 'unlock');
      expect(err.join(' ')).to.match(/No keystore/i);
      expect(existsSync(sessionPath())).to.equal(false);
    });

    it('refuses a dev keystore (nothing to cache)', async () => {
      initKeystore(keystorePath(), { protection: 'none', getPassphrase: () => 'x' });
      await run('keystore', 'unlock');
      expect(err.join(' ')).to.match(/dev keystore/i);
      expect(existsSync(sessionPath())).to.equal(false);
    });

    it('refuses an encrypted keystore with no passphrase established yet', async () => {
      mkdirSync(home, { recursive: true });
      writeFileSync(keystorePath(), JSON.stringify({ v: 1, protection: 'passphrase', keys: {} }));
      await run('keystore', 'unlock');
      expect(err.join(' ')).to.match(/no passphrase established/i);
    });

    it('rejects a wrong passphrase and writes no session', async () => {
      establishEncrypted();
      const wrongFile = join(dir, 'wrong.txt');
      writeFileSync(wrongFile, 'not-the-pass');
      await run('--passphrase-file', wrongFile, 'keystore', 'unlock');
      expect(err.join(' ')).to.match(/Incorrect passphrase/i);
      expect(existsSync(sessionPath())).to.equal(false);
    });
  });

  describe('mainnet gate', () => {
    it('refuses to unlock when the active network is bitcoin, before acquiring the passphrase', async () => {
      establishEncrypted();
      writeConfig({ schemaVersion: 1, defaults: { network: 'bitcoin' } });
      // No --passphrase-file: the gate must fire before any passphrase is acquired,
      // so the error is the mainnet refusal, not "no passphrase available".
      await run('keystore', 'unlock');
      expect(err.join(' ')).to.match(/mainnet/i);
      expect(err.join(' ')).to.not.match(/no passphrase available/i);
      expect(existsSync(sessionPath())).to.equal(false);
    });

    it('allows a mainnet unlock with --allow-mainnet and records the allowance', async () => {
      establishEncrypted();
      writeConfig({ schemaVersion: 1, defaults: { network: 'bitcoin' } });
      await run('--passphrase-file', passFile, 'keystore', 'unlock', '--allow-mainnet');
      expect(err.join(' ')).to.not.match(/mainnet/i);
      expect(existsSync(sessionPath())).to.equal(true);
      out = [];
      await run('-o', 'json', 'keystore', 'status');
      expect(JSON.parse(out.join('\n')).data.session.allowMainnet).to.equal(true);
    });

    it('allows unlock on a non-mainnet default without a flag and records no allowance', async () => {
      establishEncrypted();
      await run('--passphrase-file', passFile, 'keystore', 'unlock');
      expect(existsSync(sessionPath())).to.equal(true);
      out = [];
      await run('-o', 'json', 'keystore', 'status');
      expect(JSON.parse(out.join('\n')).data.session.allowMainnet).to.equal(false);
    });
  });

  describe('--ttl validation', () => {
    beforeEach(() => establishEncrypted());

    it('rejects a zero, malformed, or over-cap ttl before touching the passphrase', async () => {
      // No --passphrase-file: the ttl is validated before any passphrase is
      // acquired, so a bad ttl errors on the ttl, not on a missing passphrase. A
      // reordering that acquired the passphrase first would surface "no passphrase
      // available" here and fail the /Invalid --ttl/ match.
      await run('keystore', 'unlock', '--ttl', '0');
      expect(err.join(' ')).to.match(/Invalid --ttl/i);
      expect(err.join(' ')).to.not.match(/no passphrase available/i);
      err = [];
      await run('keystore', 'unlock', '--ttl', 'abc');
      expect(err.join(' ')).to.match(/Invalid --ttl/i);
      err = [];
      await run('keystore', 'unlock', '--ttl', '25h');
      expect(err.join(' ')).to.match(/exceeds the 24h maximum/i);
      expect(existsSync(sessionPath())).to.equal(false);
    });

    it('reads the ttl from BTCR2_KEYSTORE_TTL and blames the env var, not --ttl, on a bad value', async () => {
      process.env[ENV_KEYSTORE_TTL] = '25h';
      await run('keystore', 'unlock');
      expect(err.join(' ')).to.match(/\$BTCR2_KEYSTORE_TTL "25h" exceeds/);
      expect(err.join(' ')).to.not.match(/--ttl/);
    });

    it('honors a valid --ttl and the default of one hour', async () => {
      await run('-o', 'json', '--passphrase-file', passFile, 'keystore', 'unlock', '--ttl', '30m');
      expect(JSON.parse(out.join('\n')).data.ttlSeconds).to.equal(1800);
      await run('keystore', 'lock');
      out = [];
      await run('-o', 'json', '--passphrase-file', passFile, 'keystore', 'unlock');
      expect(JSON.parse(out.join('\n')).data.ttlSeconds).to.equal(3600);
    });
  });

  describe('unlock success, status, and output redaction', () => {
    beforeEach(() => establishEncrypted());

    it('writes a session and status reports it active, never printing the passphrase', async () => {
      await run('-o', 'json', '--passphrase-file', passFile, 'keystore', 'unlock');
      const unlock = JSON.parse(out.join('\n'));
      expect(unlock.action).to.equal('keystore-unlock');
      expect(unlock.data.keystore).to.equal(keystorePath());
      expect(unlock.data).to.not.have.property('passphrase');
      expect(existsSync(sessionPath())).to.equal(true);

      out = [];
      await run('-o', 'json', 'keystore', 'status');
      const status = JSON.parse(out.join('\n')).data;
      expect(status.session.active).to.equal(true);
      expect(status.session.secondsRemaining).to.be.a('number');

      // The passphrase must not appear anywhere in either command's output.
      expect(`${out.join(' ')} ${err.join(' ')}`).to.not.match(/\bpw\b/);
    });

    it('status reports the session inactive after lock', async () => {
      await run('--passphrase-file', passFile, 'keystore', 'unlock');
      await run('keystore', 'lock');
      out = [];
      await run('-o', 'json', 'keystore', 'status');
      expect(JSON.parse(out.join('\n')).data.session.active).to.equal(false);
    });
  });

  describe('lock', () => {
    it('clears a session, is idempotent, and reports whether one existed', async () => {
      establishEncrypted();
      await run('--passphrase-file', passFile, 'keystore', 'unlock');
      out = [];
      await run('-o', 'json', 'keystore', 'lock');
      expect(JSON.parse(out.join('\n')).data.cleared).to.equal(true);
      expect(existsSync(sessionPath())).to.equal(false);
      out = [];
      await run('-o', 'json', 'keystore', 'lock');
      expect(JSON.parse(out.join('\n')).data.cleared).to.equal(false);
    });

    it('works under a malformed config (home-only resolution)', async () => {
      writeConfig({} as never);
      writeFileSync(join(home, 'config.json'), '{ not valid json ');
      await run('-o', 'json', 'keystore', 'lock');
      expect(err.join(' ')).to.equal('');
      expect(JSON.parse(out.join('\n')).data.cleared).to.equal(false);
    });
  });

  describe('establishment invalidates a stale session', () => {
    it('btcr2 init clears a pre-existing session when it establishes a keystore', async function () {
      this.timeout(30_000); // real init establishes at production argon2id cost
      establishEncrypted();
      await run('--passphrase-file', passFile, 'keystore', 'unlock');
      expect(existsSync(sessionPath())).to.equal(true);
      // init never overwrites an existing keystore, so remove it first to force a
      // fresh establishment. The stale session (holding the old passphrase in
      // plaintext) must be cleared, matching keystore init / change-passphrase.
      rmSync(keystorePath());
      await run('--passphrase-file', passFile, 'init');
      expect(existsSync(keystorePath())).to.equal(true);
      expect(existsSync(sessionPath())).to.equal(false);
    });

    it('btcr2 init leaves a session intact when the keystore already exists (no re-establishment)', async () => {
      establishEncrypted();
      await run('--passphrase-file', passFile, 'keystore', 'unlock');
      // The keystore already exists, so init is a no-op for it; a valid session
      // for that same keystore must survive.
      await run('--passphrase-file', passFile, 'init');
      expect(existsSync(sessionPath())).to.equal(true);
    });
  });

  describe('end to end: unlock enables prompt-free key access, lock re-locks', () => {
    it('exports a sealed key without a prompt while unlocked, then fails once locked', async function () {
      if (process.stdin.isTTY) return this.skip(); // relies on a non-interactive runner
      establishWithKey();
      await run('--passphrase-file', passFile, 'keystore', 'unlock');

      // No passphrase source on this command: the session must supply it.
      const secretOut = join(dir, 'secret1.hex');
      await run('key', 'export', 'demo', '--secret', '--out', secretOut);
      expect(readFileSync(secretOut, 'utf-8').trim()).to.equal(SECRET_HEX);

      await run('keystore', 'lock');
      err = [];
      const secretOut2 = join(dir, 'secret2.hex');
      await run('key', 'export', 'demo', '--secret', '--out', secretOut2);
      expect(err.join(' ')).to.match(/passphrase/i);
      expect(existsSync(secretOut2)).to.equal(false);
    });
  });
});

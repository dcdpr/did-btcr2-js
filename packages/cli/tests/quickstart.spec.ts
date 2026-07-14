import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DidBtcr2Cli } from '../src/cli.js';
import type { ArgonParams } from '../src/keystore/envelope.js';
import { initKeystore, keystoreSummary } from '../src/keystore/file-key-store.js';
import { ENV_KEYSTORE_PASSPHRASE } from '../src/keystore/passphrase.js';
import { ENV_KEYSTORE_TTL } from '../src/keystore/session.js';
import { createTestApiFactory, expect, originalConsoleError, originalConsoleLog } from './helpers.js';

const FAST: ArgonParams = { t: 1, m: 256, p: 1, dkLen: 32 };
const ENV_KEYS = [ 'BTCR2_HOME', ENV_KEYSTORE_PASSPHRASE, ENV_KEYSTORE_TTL ];
/** A refused endpoint so the advisory doctor probe fails fast and offline. */
const REFUSED = 'http://127.0.0.1:1';

describe('quickstart (ADR 083)', () => {
  const saved: Record<string, string | undefined> = {};
  const originalStderrWrite = process.stderr.write.bind(process.stderr);
  let dir: string;
  let home: string;
  let passFile: string;
  let out: string[];
  let err: string[];

  beforeEach(() => {
    for (const k of ENV_KEYS) { saved[k] = process.env[k]; delete process.env[k]; }
    dir = mkdtempSync(join(tmpdir(), 'btcr2-quickstart-'));
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
  const configPath = (): string => join(home, 'config.json');
  const sessionPath = (): string => join(home, 'session.json');

  /** Establishes a FAST encrypted keystore (empty, established) at the home default. */
  function establishEncrypted(): void {
    initKeystore(keystorePath(), { protection: 'passphrase', argonParams: FAST, getPassphrase: () => 'pw' });
  }

  /** The `defaults.network` recorded in the config file, or undefined. */
  function recordedNetwork(): unknown {
    if (!existsSync(configPath())) return undefined;
    return (JSON.parse(readFileSync(configPath(), 'utf-8')).defaults ?? {}).network;
  }

  const parse = (): { action: string; data: Record<string, unknown> } => JSON.parse(out.join('\n'));

  describe('scaffold and network', () => {
    it('--dev seeds home/config/keystore and records mutinynet by default', async () => {
      await run('-o', 'json', 'quickstart', '--dev', '--no-doctor');
      const result = parse();
      expect(result.action).to.equal('quickstart');
      expect(result.data.network).to.equal('mutinynet');
      expect(result.data.created).to.have.members([ 'config', 'keystore' ]);
      expect(result.data.protection).to.equal('dev');
      expect(result.data.unlocked).to.equal(false);
      expect(result.data).to.not.have.property('doctor');
      expect(recordedNetwork()).to.equal('mutinynet');
    });

    it('an explicit -n records that network', async () => {
      await run('-o', 'json', 'quickstart', '-n', 'signet', '--dev', '--no-doctor');
      expect(parse().data.network).to.equal('signet');
      expect(recordedNetwork()).to.equal('signet');
    });

    it('a bare re-run does not clobber a network the operator set earlier', async () => {
      await run('init', '--dev');
      await run('config', 'set', 'defaults.network', 'signet');
      out = [];
      await run('-o', 'json', 'quickstart', '--dev', '--no-doctor');
      expect(parse().data.network).to.equal('signet');
      expect(recordedNetwork()).to.equal('signet');
    });

    it('an explicit -n overrides an existing default', async () => {
      await run('init', '--dev');
      await run('config', 'set', 'defaults.network', 'signet');
      out = [];
      await run('-o', 'json', 'quickstart', '-n', 'testnet4', '--dev', '--no-doctor');
      expect(parse().data.network).to.equal('testnet4');
      expect(recordedNetwork()).to.equal('testnet4');
    });
  });

  describe('mainnet gate (before any writes)', () => {
    it('refuses -n bitcoin without --allow-mainnet and writes nothing', async () => {
      await run('quickstart', '-n', 'bitcoin', '--dev', '--no-doctor');
      expect(err.join(' ')).to.match(/mainnet/i);
      expect(existsSync(configPath())).to.equal(false);
      expect(existsSync(keystorePath())).to.equal(false);
    });

    it('refuses -n bitcoin --dev even with --allow-mainnet', async () => {
      await run('quickstart', '-n', 'bitcoin', '--dev', '--allow-mainnet', '--no-doctor');
      expect(err.join(' ')).to.match(/dev keystore/i);
      expect(existsSync(keystorePath())).to.equal(false);
    });
  });

  describe('session caching is opt-in (--unlock)', () => {
    it('without --unlock, caches no session (fresh encrypted keystore)', async function () {
      this.timeout(30_000); // real establishment at production argon2id cost
      await run('-o', 'json', '--passphrase-file', passFile, 'quickstart', '--no-doctor');
      const result = parse();
      expect(result.data.protection).to.equal('encrypted');
      expect(result.data.unlocked).to.equal(false);
      expect(existsSync(sessionPath())).to.equal(false);
    });

    it('with --unlock on a fresh encrypted keystore, caches a session with no second prompt', async function () {
      this.timeout(30_000);
      await run('-o', 'json', '--passphrase-file', passFile, 'quickstart', '--unlock', '--ttl', '30m', '--no-doctor');
      const result = parse();
      expect(result.data.protection).to.equal('encrypted');
      expect(result.data.unlocked).to.equal(true);
      expect((result.data.session as { ttlSeconds: number }).ttlSeconds).to.equal(1800);
      expect(existsSync(sessionPath())).to.equal(true);
      // The passphrase must never appear in output.
      expect(`${out.join(' ')} ${err.join(' ')}`).to.not.match(/\bpw\b/);
    });

    it('with --unlock on an existing keystore that already has a live session, skips (idempotent)', async () => {
      establishEncrypted();
      await run('--passphrase-file', passFile, 'keystore', 'unlock');
      expect(existsSync(sessionPath())).to.equal(true);
      out = [];
      // No passphrase source: a live session means no prompt and no re-write.
      await run('-o', 'json', 'quickstart', '--unlock', '--no-doctor');
      expect(parse().data.unlocked).to.equal(true);
      expect(existsSync(sessionPath())).to.equal(true);
    });

    it('with --unlock on an existing encrypted keystore, non-TTY with no passphrase source, skips non-fatally', async function () {
      if (process.stdin.isTTY) return this.skip(); // relies on a non-interactive runner
      establishEncrypted();
      await run('-o', 'json', 'quickstart', '--unlock', '--no-doctor');
      expect(parse().data.unlocked).to.equal(false);
      expect(existsSync(sessionPath())).to.equal(false);
      expect(err.join(' ')).to.match(/skipped caching the session/i);
      expect(process.exitCode).to.not.equal(1);
    });

    it('--dev never caches a session, even with --unlock', async () => {
      await run('-o', 'json', 'quickstart', '--dev', '--unlock', '--no-doctor');
      expect(parse().data.unlocked).to.equal(false);
      expect(existsSync(sessionPath())).to.equal(false);
    });
  });

  describe('advisory doctor', () => {
    it('runs by default and a failed probe does not fail quickstart', async function () {
      this.timeout(15_000);
      await run(
        '-o', 'json',
        '--btc-rest', `${REFUSED}/api`,
        '--cas-gateway', REFUSED,
        'quickstart', '--dev',
      );
      const result = parse();
      expect(result.data).to.have.property('doctor');
      const checks = (result.data.doctor as { checks: Array<{ ok: boolean }> }).checks;
      expect(checks.some((c) => !c.ok)).to.equal(true);
      expect(process.exitCode).to.not.equal(1); // advisory: a failed probe still exits 0
    });

    it('--no-doctor skips the probe', async () => {
      await run('-o', 'json', 'quickstart', '--dev', '--no-doctor');
      expect(parse().data).to.not.have.property('doctor');
    });
  });

  describe('init -n complement', () => {
    it('init -n records the network in the envelope and config', async () => {
      await run('-o', 'json', 'init', '-n', 'signet', '--dev');
      const result = parse();
      expect(result.action).to.equal('init');
      expect(result.data.network).to.equal('signet');
      expect(recordedNetwork()).to.equal('signet');
    });

    it('init without -n does not persist a network', async () => {
      await run('-o', 'json', 'init', '--dev');
      // resolveDefaultNetwork falls back to regtest, but nothing is written.
      expect(parse().data.network).to.equal('regtest');
      expect(recordedNetwork()).to.equal(undefined);
      expect(keystoreSummary(keystorePath()).protection).to.equal('dev');
    });

    it('rejects an invalid -n before any work', async () => {
      await run('quickstart', '-n', 'notanet', '--dev', '--no-doctor');
      expect(err.join(' ')).to.match(/Invalid network/i);
      expect(existsSync(keystorePath())).to.equal(false);
    });
  });
});

import { createApi } from '@did-btcr2/api';
import { SchnorrKeyPair } from '@did-btcr2/keypair';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DidBtcr2Cli } from '../src/cli.js';
import { initKeystore, keystoreSummary } from '../src/keystore/file-key-store.js';
import type { ArgonParams } from '../src/keystore/envelope.js';
import { ENV_KEYSTORE_PASSPHRASE } from '../src/keystore/passphrase.js';
import { createTestApiFactory, expect, originalConsoleError, originalConsoleLog } from './helpers.js';

const FAST: ArgonParams = { t: 1, m: 256, p: 1, dkLen: 32 };
const ENV_KEYS = [ 'BTCR2_HOME', ENV_KEYSTORE_PASSPHRASE ];

/** A valid did:btcr2 identifier on the given network, minted offline. */
function didFor(network: string): string {
  const pub = SchnorrKeyPair.generate().publicKey.compressed;
  return createApi().createDid('deterministic', pub, { network: network as never });
}

describe('state + keystore commands (ADR 079/080)', () => {
  const saved: Record<string, string | undefined> = {};
  const originalStderrWrite = process.stderr.write.bind(process.stderr);
  let dir: string;
  let home: string;
  let out: string[];
  let err: string[];

  beforeEach(() => {
    for (const k of ENV_KEYS) { saved[k] = process.env[k]; delete process.env[k]; }
    dir = mkdtempSync(join(tmpdir(), 'btcr2-state-'));
    home = join(dir, 'home');
    out = [];
    err = [];
    console.log = (m?: unknown) => { if (m !== undefined) out.push(String(m)); };
    console.error = (m?: unknown) => { if (m !== undefined) err.push(String(m)); };
    // Capture stderr notes/warnings (init/keystore write these via process.stderr).
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

  /** Fresh CLI invocation with a temp home; the api factory is never network-touched here. */
  async function run(...args: string[]): Promise<void> {
    await new DidBtcr2Cli(createTestApiFactory()).run(['node', 'btcr2', '--home', home, ...args]);
  }

  const keystorePath = (): string => join(home, 'keystore.json');
  const configPath = (): string => join(home, 'config.json');

  describe('btcr2 init', () => {
    it('--dev seeds home, config, and an unencrypted keystore', async () => {
      await run('-o', 'json', 'init', '--dev');
      const result = JSON.parse(out.join('\n'));
      expect(result.action).to.equal('init');
      expect(result.data.home).to.equal(home);
      expect(result.data.created).to.have.members([ 'config', 'keystore' ]);
      expect(result.data.protection).to.equal('dev');
      expect(existsSync(configPath())).to.equal(true);
      expect(keystoreSummary(keystorePath()).protection).to.equal('dev');
    });

    it('is idempotent: a second run creates nothing', async () => {
      await run('init', '--dev');
      out = [];
      await run('-o', 'json', 'init', '--dev');
      expect(JSON.parse(out.join('\n')).data.created).to.deep.equal([]);
    });

    it('establishes an encrypted keystore from the passphrase env var', async function () {
      this.timeout(20000); // one production argon2id run for the verifier
      process.env[ENV_KEYSTORE_PASSPHRASE] = 'demo-pass';
      await run('-o', 'json', 'init');
      expect(JSON.parse(out.join('\n')).data.protection).to.equal('encrypted');
      expect(keystoreSummary(keystorePath()).established).to.equal(true);
    });
  });

  describe('keystore group', () => {
    it('init --dev then status reports dev', async () => {
      await run('keystore', 'init', '--dev');
      out = [];
      await run('-o', 'json', 'keystore', 'status');
      const status = JSON.parse(out.join('\n')).data;
      expect(status.protection).to.equal('dev');
      expect(status.path).to.equal(keystorePath());
    });

    it('status reports absent when no keystore exists', async () => {
      await run('-o', 'json', 'keystore', 'status');
      expect(JSON.parse(out.join('\n')).data.protection).to.equal('absent');
    });

    it('init refuses to overwrite without --force', async () => {
      await run('keystore', 'init', '--dev');
      err = [];
      await run('keystore', 'init', '--dev');
      expect(err.join(' ')).to.match(/already exists/i);
    });

    it('change-passphrase refuses a dev keystore', async () => {
      await run('keystore', 'init', '--dev');
      err = [];
      await run('keystore', 'change-passphrase');
      expect(err.join(' ')).to.match(/dev keystore/i);
    });

    it('change-passphrase errors when no keystore exists', async () => {
      await run('keystore', 'change-passphrase');
      expect(err.join(' ')).to.match(/No keystore/i);
    });
  });

  describe('config path', () => {
    it('config path reports the home, config, and keystore locations', async () => {
      await run('-o', 'json', 'config', 'path');
      const data = JSON.parse(out.join('\n')).data;
      expect(data.home).to.equal(home);
      expect(data.config).to.equal(configPath());
      expect(data.keystore).to.equal(keystorePath());
    });
  });

  describe('a malformed config is loud for key material but graceful for diagnostics', () => {
    const writeMalformedConfig = (): void => {
      mkdirSync(home, { recursive: true });
      writeFileSync(configPath(), '{ not valid json ');
    };

    it('config path still reports locations instead of crashing', async () => {
      writeMalformedConfig();
      await run('-o', 'json', 'config', 'path');
      expect(err.join(' ')).to.equal('');
      const data = JSON.parse(out.join('\n')).data;
      expect(data.home).to.equal(home);
      expect(data.keystore).to.equal(keystorePath());
    });

    it('keystore status still reports instead of crashing', async () => {
      writeMalformedConfig();
      await run('-o', 'json', 'keystore', 'status');
      expect(err.join(' ')).to.equal('');
      expect(JSON.parse(out.join('\n')).data.protection).to.equal('absent');
    });

    it('key generate aborts loudly rather than sealing a key into the wrong store', async () => {
      writeMalformedConfig();
      await run('key', 'generate', '--name', 'x');
      expect(err.join(' ')).to.match(/not valid JSON/i);
      expect(existsSync(keystorePath())).to.equal(false); // no key material written
    });
  });

  describe('init and keystore init never silently destroy keys (review fix)', () => {
    it('btcr2 init --force re-scaffolds config but leaves an existing keystore (and its keys) intact', async () => {
      initKeystore(keystorePath(), { protection: 'none', getPassphrase: () => 'x', argonParams: FAST });
      await run('key', 'generate', '--name', 'keep'); // dev keystore: no prompt
      out = [];
      err = [];
      await run('-o', 'json', 'init', '--force');
      const result = JSON.parse(out.join('\n'));
      expect(result.data.created).to.not.include('keystore');
      expect(err.join(' ')).to.match(/left intact/i);
      expect(keystoreSummary(keystorePath()).keyCount).to.equal(1);
    });

    it('keystore init --force warns before discarding existing keys', async () => {
      initKeystore(keystorePath(), { protection: 'none', getPassphrase: () => 'x', argonParams: FAST });
      await run('key', 'generate', '--name', 'doomed');
      err = [];
      await run('keystore', 'init', '--dev', '--force');
      expect(err.join(' ')).to.match(/discards its 1 existing key/i);
      expect(keystoreSummary(keystorePath()).keyCount).to.equal(0);
    });
  });

  describe('dev keystore is refused on mainnet (ADR 080)', () => {
    beforeEach(() => {
      // A dev keystore at the home default, established directly (fast).
      initKeystore(keystorePath(), { protection: 'none', getPassphrase: () => 'unused', argonParams: FAST });
    });

    async function runUpdate(did: string): Promise<void> {
      await run(
        'update',
        '-s', JSON.stringify({ id: did }),
        '--source-version-id', '1',
        '-p', '[]',
        '-m', `${did}#key-0`,
        '-b', '"bitcoin:addr"',
      );
    }

    it('refuses update on a mainnet DID', async () => {
      await runUpdate(didFor('bitcoin'));
      expect(err.join(' ')).to.match(/Refusing a mainnet/i);
    });

    it('does not raise the dev-keystore error on a testnet DID', async () => {
      await runUpdate(didFor('testnet4'));
      expect(err.join(' ')).to.not.match(/Refusing a mainnet/i);
    });

    it('refuses generating a mainnet key into a dev keystore', async () => {
      await run('create', '-t', 'k', '-n', 'bitcoin');
      expect(err.join(' ')).to.match(/Refusing a mainnet/i);
    });

    it('refuses deactivate on a mainnet DID', async () => {
      const did = didFor('bitcoin');
      await run(
        'deactivate',
        '-s', JSON.stringify({ id: did }),
        '--source-version-id', '1',
        '-m', `${did}#key-0`,
        '-b', '"bitcoin:addr"',
      );
      expect(err.join(' ')).to.match(/Refusing a mainnet/i);
    });
  });
});

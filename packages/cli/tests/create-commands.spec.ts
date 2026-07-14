import { Identifier } from '@did-btcr2/api';
import { SchnorrKeyPair } from '@did-btcr2/keypair';
import { bytesToHex } from '@noble/hashes/utils.js';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DidBtcr2Cli } from '../src/cli.js';
import {
  createKeystoreTestApiFactory,
  createTestApiFactory,
  expect,
  originalConsoleError,
  originalConsoleLog,
} from './helpers.js';

/** A fresh 33-byte compressed public key as hex, for the raw-bytes path. */
function freshPublicKeyHex(): string {
  return bytesToHex(SchnorrKeyPair.generate().publicKey.compressed);
}

describe('create command', () => {
  let dir: string;
  let keystore: string;
  let cfg: string;
  let out: string[];
  let err: string[];
  let originalStderrWrite: typeof process.stderr.write;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'btcr2-create-'));
    keystore = join(dir, 'keystore.json');
    cfg = join(dir, 'config.json');
    out = [];
    err = [];
    console.log = (m?: unknown) => { if (m !== undefined) out.push(String(m)); };
    console.error = (m?: unknown) => { if (m !== undefined) err.push(String(m)); };
    originalStderrWrite = process.stderr.write;
    process.stderr.write = ((chunk: unknown) => { err.push(String(chunk)); return true; }) as typeof process.stderr.write;
    // Start each test with a clean exit code so handleError's `??= 1` is observable.
    process.exitCode = undefined;
  });

  afterEach(() => {
    console.log = originalConsoleLog;
    console.error = originalConsoleError;
    process.stderr.write = originalStderrWrite;
    process.exitCode = 0;
    rmSync(dir, { recursive: true, force: true });
  });

  // Each call is a fresh CLI invocation sharing the temp keystore and config files.
  async function run(...args: string[]): Promise<void> {
    const cli = new DidBtcr2Cli(createTestApiFactory(), createKeystoreTestApiFactory(keystore, 'pw'));
    await cli.run(['node', 'btcr2', ...args]);
  }

  function readKeystore(): { active?: string; keys: Record<string, unknown> } {
    return JSON.parse(readFileSync(keystore, 'utf-8'));
  }

  it('generate mode mints a DID and stores a key when no key arg is given', async () => {
    await run('-o', 'json', 'create', '-n', 'regtest');
    const result = JSON.parse(out[0]);
    expect(result.action).to.equal('create');
    expect(result.data).to.match(/^did:btcr2:k1/);
    expect(result.keyId).to.match(/^urn:kms:secp256k1:[0-9a-f]{32}$/);
    expect(result.publicKey).to.match(/^[0-9a-f]{66}$/);
  });

  it('the generated key is persisted and set active', async () => {
    await run('-o', 'json', 'create', '-n', 'regtest');
    const { keyId } = JSON.parse(out[0]);
    const stored = readKeystore();
    expect(stored.active).to.equal(keyId);
    expect(stored.keys).to.have.property(keyId);
  });

  it('existing-key mode reuses a stored key without generating a new one', async () => {
    await run('-o', 'json', 'create', '-n', 'regtest');
    const first = JSON.parse(out[0]);
    out = [];
    await run('-o', 'json', '--signing-key', first.keyId, 'create', '-n', 'regtest');
    const second = JSON.parse(out[0]);
    expect(second.keyId).to.equal(first.keyId);
    // Same key, same network -> the deterministic identifier is identical.
    expect(second.data).to.equal(first.data);
    // No second key was created.
    expect(Object.keys(readKeystore().keys)).to.have.length(1);
  });

  it('raw-bytes mode creates a deterministic DID offline (no keystore)', async () => {
    const pk = freshPublicKeyHex();
    await run('-o', 'json', 'create', '-t', 'k', '-n', 'signet', '-b', pk);
    const result = JSON.parse(out[0]);
    expect(result.data).to.match(/^did:btcr2:k1/);
    expect(result).to.not.have.property('keyId');
    expect(Identifier.decode(result.data).network).to.equal('signet');
  });

  it('defaults the network from config defaults.network when -n is omitted', async () => {
    writeFileSync(cfg, JSON.stringify({ schemaVersion: 1, defaults: { network: 'mutinynet' } }));
    const pk = freshPublicKeyHex();
    await run('-o', 'json', '--config', cfg, 'create', '-b', pk);
    const result = JSON.parse(out[0]);
    expect(Identifier.decode(result.data).network).to.equal('mutinynet');
  });

  it('falls back to regtest when no -n and no config default', async () => {
    const pk = freshPublicKeyHex();
    await run('-o', 'json', '--config', cfg, 'create', '-b', pk);
    const result = JSON.parse(out[0]);
    expect(Identifier.decode(result.data).network).to.equal('regtest');
  });

  it('rejects supplying both --bytes and --signing-key', async () => {
    const pk = freshPublicKeyHex();
    await run('--signing-key', 'somekey', 'create', '-b', pk);
    expect(err.join(' ')).to.match(/at most one of --bytes or --signing-key/i);
    expect(process.exitCode).to.equal(1);
  });

  it('external type requires --bytes', async () => {
    await run('create', '-t', 'x', '-n', 'regtest');
    expect(err.join(' ')).to.match(/external identifiers .* require --bytes/i);
    expect(process.exitCode).to.equal(1);
  });

  it('rejects an invalid --bytes length', async () => {
    await run('create', '-t', 'k', '-n', 'regtest', '-b', 'abcd');
    expect(err.join(' ')).to.match(/invalid bytes length/i);
    expect(process.exitCode).to.equal(1);
  });

  it('text mode prints the DID on stdout and key provenance on stderr', async () => {
    await run('create', '-n', 'regtest');
    expect(out[0]).to.match(/^did:btcr2:k1/);
    expect(err.join(' ')).to.match(/Generated and stored key urn:kms:secp256k1:[0-9a-f]{32} \(now the active key\)/);
  });

  describe('funding hint (ADR 082)', () => {
    it('text mode on a testnet with a faucet prints the beacon, faucet, and explorer', async () => {
      const pk = freshPublicKeyHex();
      await run('create', '-t', 'k', '-n', 'mutinynet', '-b', pk);
      const e = err.join(' ');
      expect(e).to.match(/Fund the initial beacon/i);
      expect(e).to.match(/Faucet:\s+https:\/\/faucet\.mutinynet\.com\//);
      expect(e).to.match(/Explorer:\s+https:\/\/mutinynet\.com\/address\/tb1/);
    });

    it('omits the funding hint under -o json (machine output stays clean)', async () => {
      const pk = freshPublicKeyHex();
      await run('-o', 'json', 'create', '-t', 'k', '-n', 'mutinynet', '-b', pk);
      expect(err.join(' ')).to.not.match(/Fund the initial beacon/i);
    });

    it('omits the funding hint on a network without a faucet (regtest)', async () => {
      const pk = freshPublicKeyHex();
      await run('create', '-t', 'k', '-n', 'regtest', '-b', pk);
      expect(err.join(' ')).to.not.match(/Fund the initial beacon/i);
    });

    it('omits the funding hint for an external (-t x) identifier (no beacon key)', async () => {
      await run('create', '-t', 'x', '-n', 'mutinynet', '-b', 'ab'.repeat(32));
      expect(err.join(' ')).to.not.match(/Fund the initial beacon/i);
    });
  });
});

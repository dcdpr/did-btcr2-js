import { createApi } from '@did-btcr2/api';
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

/** The api of the fixtures: offline, with no connection and no key. */
const sdk = createApi();

/** A fresh 33-byte compressed public key as hex, for the raw-bytes path. */
function freshPublicKeyHex(): string {
  return bytesToHex(sdk.crypto.keypair.generate().publicKey.compressed);
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
    await run('-o', 'json', 'create', '--key', first.keyId, '-n', 'regtest');
    const second = JSON.parse(out[0]);
    expect(second.keyId).to.equal(first.keyId);
    // Same key, same network -> the deterministic identifier is identical.
    expect(second.data).to.equal(first.data);
    // No second key was created.
    expect(Object.keys(readKeystore().keys)).to.have.length(1);
  });

  it('existing-key mode resolves a fingerprint prefix and prints the key provenance under --verbose', async () => {
    await run('-o', 'json', 'create', '-n', 'regtest');
    const first = JSON.parse(out[0]);
    out = [];
    err = [];
    const prefix = first.keyId.slice('urn:kms:secp256k1:'.length, 'urn:kms:secp256k1:'.length + 6);
    await run('--verbose', 'create', '-k', prefix, '-n', 'regtest');
    expect(out[0]).to.equal(first.data);
    expect(err.join(' ')).to.include(`Using stored key ${first.keyId}.`);
  });

  it('existing-key mode fails for an unknown key reference', async () => {
    await run('create', '--key', 'no-such-key', '-n', 'regtest');
    expect(err.join(' ')).to.include('No key matches reference "no-such-key".');
    expect(process.exitCode).to.equal(1);
  });

  it('uses the active key when no --key is given', async () => {
    await run('-o', 'json', 'create', '-n', 'regtest');
    const first = JSON.parse(out[0]);
    out = [];
    err = [];
    await run('create', '-n', 'regtest');
    expect(out).to.deep.equal([ first.data ]);
    expect(err).to.deep.equal([]);
    expect(Object.keys(readKeystore().keys)).to.have.length(1);
  });

  it('uses identity.default of the active profile before the active key', async () => {
    await run('-o', 'json', 'create', '-n', 'regtest');
    await run('-o', 'json', 'key', 'generate', '--name', 'bob');
    const bob = JSON.parse(out[1]).data.keyId;
    writeFileSync(cfg, JSON.stringify({
      schemaVersion : 1,
      defaults      : { profile: 'custom' },
      profiles      : { custom: { identity: { default: 'bob' } } },
    }));
    out = [];
    await run('-o', 'json', '--config', cfg, 'create', '-n', 'regtest');
    expect(JSON.parse(out[0]).keyId).to.equal(bob);
  });

  it('--key wins over identity.default and the active key', async () => {
    await run('-o', 'json', 'create', '-n', 'regtest');
    const active = JSON.parse(out[0]).keyId;
    writeFileSync(cfg, JSON.stringify({
      schemaVersion : 1,
      defaults      : { profile: 'custom' },
      profiles      : { custom: { identity: { default: 'no-such-key' } } },
    }));
    out = [];
    await run('-o', 'json', '--config', cfg, 'create', '--key', active, '-n', 'regtest');
    expect(JSON.parse(out[0]).keyId).to.equal(active);
  });

  it('rejects an empty --key', async () => {
    await run('create', '--key', '', '-n', 'regtest');
    expect(err.join(' ')).to.include('--key must not be empty.');
    expect(process.exitCode).to.equal(1);
  });

  it('rejects --key with an external (-t x) identifier', async () => {
    await run('create', '--key', 'somekey', '-t', 'x', '-n', 'regtest', '-b', 'ab'.repeat(32));
    expect(err.join(' ')).to.include('--key applies only to deterministic identifiers (-t k).');
    expect(process.exitCode).to.equal(1);
  });

  it('shows the --key flag in the create help', async () => {
    const cli = new DidBtcr2Cli(createTestApiFactory(), createKeystoreTestApiFactory(keystore, 'pw'));
    const create = cli.program.commands.find(c => c.name() === 'create');
    // Commander wraps long help lines, so compare with the whitespace collapsed.
    const help = create!.helpInformation().replace(/\s+/g, ' ');
    expect(help).to.include('Usage: btcr2 create [options] ');
    expect(help).to.include('-k, --key <ref> For type=k, a stored key whose public key the identifier encodes');
  });

  it('raw-bytes mode creates a deterministic DID offline (no keystore)', async () => {
    const pk = freshPublicKeyHex();
    await run('-o', 'json', 'create', '-t', 'k', '-n', 'signet', '-b', pk);
    const result = JSON.parse(out[0]);
    expect(result.data).to.match(/^did:btcr2:k1/);
    expect(result).to.not.have.property('keyId');
    expect(sdk.did.decode(result.data).network).to.equal('signet');
  });

  it('defaults the network from config defaults.network when -n is omitted', async () => {
    writeFileSync(cfg, JSON.stringify({ schemaVersion: 1, defaults: { network: 'mutinynet' } }));
    const pk = freshPublicKeyHex();
    await run('-o', 'json', '--config', cfg, 'create', '-b', pk);
    const result = JSON.parse(out[0]);
    expect(sdk.did.decode(result.data).network).to.equal('mutinynet');
  });

  it('lets the network of the active profile win over defaults.network, with no warning', async () => {
    writeFileSync(cfg, JSON.stringify({
      schemaVersion : 1,
      defaults      : { network: 'mutinynet', profile: 'production' },
      profiles      : { production: { network: 'signet' } },
    }));
    const pk = freshPublicKeyHex();
    await run('-o', 'json', '--config', cfg, 'create', '-b', pk);
    const result = JSON.parse(out[0]);
    expect(sdk.did.decode(result.data).network).to.equal('signet');
    expect(err.join('')).to.not.include('Warning:');
  });

  it('warns if -n names another network than the active profile', async () => {
    writeFileSync(cfg, JSON.stringify({
      schemaVersion : 1,
      defaults      : { profile: 'production' },
      profiles      : { production: { network: 'signet' } },
    }));
    const pk = freshPublicKeyHex();
    await run('-o', 'json', '--config', cfg, 'create', '-n', 'regtest', '-b', pk);
    expect(sdk.did.decode(JSON.parse(out[0]).data).network).to.equal('regtest');
    expect(err.join('')).to.include(
      'Warning: the identifier network is "regtest", but the active profile "production" declares network "signet".'
    );
  });

  it('falls back to regtest when no -n and no config default', async () => {
    const pk = freshPublicKeyHex();
    await run('-o', 'json', '--config', cfg, 'create', '-b', pk);
    const result = JSON.parse(out[0]);
    expect(sdk.did.decode(result.data).network).to.equal('regtest');
  });

  it('rejects supplying both --key and --bytes', async () => {
    const pk = freshPublicKeyHex();
    await run('create', '--key', 'somekey', '-b', pk);
    expect(err.join(' ')).to.include('Provide at most one of --bytes or --key.');
    expect(process.exitCode).to.equal(1);
  });

  it('external type requires --document or --bytes', async () => {
    await run('create', '-t', 'x', '-n', 'regtest');
    expect(err.join(' ')).to.match(/external identifiers .* require --document <path>.* or --bytes <hex>/i);
    expect(process.exitCode).to.equal(1);
  });

  it('rejects an invalid --bytes length', async () => {
    await run('create', '-t', 'k', '-n', 'regtest', '-b', 'abcd');
    expect(err.join(' ')).to.match(/invalid bytes length/i);
    expect(process.exitCode).to.equal(1);
  });

  it('text mode prints only the identifier', async () => {
    await run('create', '-n', 'regtest');
    expect(out).to.have.length(1);
    expect(out[0]).to.match(/^did:btcr2:k1/);
    expect(err).to.deep.equal([]);
  });

  it('--verbose after the command word adds the key provenance on stderr', async () => {
    await run('create', '--verbose', '-n', 'regtest');
    expect(out).to.have.length(1);
    expect(out[0]).to.match(/^did:btcr2:k1/);
    expect(err.join(' ')).to.match(/Generated and stored key urn:kms:secp256k1:[0-9a-f]{32} \(now the active key\)/);
  });

  it('json mode prints the full envelope without --verbose', async () => {
    await run('-o', 'json', 'create', '-n', 'regtest');
    const result = JSON.parse(out[0]);
    expect(result).to.have.keys('action', 'data', 'keyId', 'publicKey');
    expect(err).to.deep.equal([]);
  });

  describe('funding hint (ADR 082)', () => {
    it('--verbose on a testnet with a faucet prints the beacon, faucet, and explorer', async () => {
      const pk = freshPublicKeyHex();
      await run('--verbose', 'create', '-t', 'k', '-n', 'mutinynet', '-b', pk);
      const e = err.join(' ');
      expect(e).to.match(/Fund the initial beacon/i);
      expect(e).to.match(/Faucet:\s+https:\/\/faucet\.mutinynet\.com\//);
      expect(e).to.match(/Explorer:\s+https:\/\/mutinynet\.com\/address\/tb1/);
    });

    it('omits the funding hint in text mode without --verbose', async () => {
      const pk = freshPublicKeyHex();
      await run('create', '-t', 'k', '-n', 'mutinynet', '-b', pk);
      expect(out).to.have.length(1);
      expect(err).to.deep.equal([]);
    });

    it('omits the funding hint under -o json (machine output stays clean)', async () => {
      const pk = freshPublicKeyHex();
      await run('-o', 'json', '--verbose', 'create', '-t', 'k', '-n', 'mutinynet', '-b', pk);
      expect(err.join(' ')).to.not.match(/Fund the initial beacon/i);
    });

    it('omits the funding hint on a network without a faucet (regtest)', async () => {
      const pk = freshPublicKeyHex();
      await run('--verbose', 'create', '-t', 'k', '-n', 'regtest', '-b', pk);
      expect(err.join(' ')).to.not.match(/Fund the initial beacon/i);
    });

    it('omits the funding hint for an external (-t x) identifier (no beacon key)', async () => {
      await run('--verbose', 'create', '-t', 'x', '-n', 'mutinynet', '-b', 'ab'.repeat(32));
      expect(err.join(' ')).to.not.match(/Fund the initial beacon/i);
    });
  });
});

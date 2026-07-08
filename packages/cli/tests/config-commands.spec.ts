import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DidBtcr2Cli } from '../src/cli.js';
import { createTestApiFactory, expect, originalConsoleError, originalConsoleLog } from './helpers.js';

describe('config and profile commands', () => {
  let dir: string;
  let cfg: string;
  let out: string[];
  let err: string[];

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'btcr2-config-'));
    cfg = join(dir, 'config.json');
    out = [];
    err = [];
    console.log = (m?: unknown) => { if (m !== undefined) out.push(String(m)); };
    console.error = (m?: unknown) => { if (m !== undefined) err.push(String(m)); };
  });

  afterEach(() => {
    console.log = originalConsoleLog;
    console.error = originalConsoleError;
    process.exitCode = 0;
    rmSync(dir, { recursive: true, force: true });
  });

  async function run(...args: string[]): Promise<void> {
    await new DidBtcr2Cli(createTestApiFactory()).run(['node', 'btcr2', '--config', cfg, ...args]);
  }


  function readCfg(): any {
    return JSON.parse(readFileSync(cfg, 'utf-8'));
  }

  it('config init scaffolds a config with one profile per network', async () => {
    await run('config', 'init');
    const file = readCfg();
    expect(file.schemaVersion).to.equal(1);
    expect(file.profiles).to.have.property('regtest');
    expect(file.profiles).to.have.property('bitcoin');
  });

  it('config init refuses to overwrite without --force', async () => {
    await run('config', 'init');
    err = [];
    await run('config', 'init');
    expect(err.join(' ')).to.match(/already exists/i);
  });

  it('config set then get round-trips a dotted path', async () => {
    await run('config', 'init');
    await run('config', 'set', 'profiles.regtest.btc.rest', 'http://localhost:3001');
    out = [];
    await run('config', 'get', 'profiles.regtest.btc.rest');
    expect(out.join('')).to.contain('http://localhost:3001');
    expect(readCfg().profiles.regtest.btc.rest).to.equal('http://localhost:3001');
  });

  it('config unset removes a value', async () => {
    await run('config', 'init');
    await run('config', 'set', 'profiles.regtest.btc.rest', 'http://x');
    await run('config', 'unset', 'profiles.regtest.btc.rest');
    expect(readCfg().profiles.regtest.btc).to.not.have.property('rest');
  });

  it('the config writer preserves unknown keys across a rewrite', async () => {
    await run('config', 'init');
    const file = readCfg();
    file.customKey = 'keep-me';
    writeFileSync(cfg, JSON.stringify(file));
    await run('config', 'set', 'defaults.network', 'regtest');
    expect(readCfg().customKey).to.equal('keep-me');
    expect(readCfg().defaults.network).to.equal('regtest');
  });

  it('profile add then use sets the active profile', async () => {
    await run('config', 'init');
    await run('profile', 'add', 'custom');
    await run('profile', 'use', 'custom');
    expect(readCfg().defaults.profile).to.equal('custom');
  });

  it('profile remove deletes a profile', async () => {
    await run('config', 'init');
    await run('profile', 'remove', 'signet');
    expect(readCfg().profiles).to.not.have.property('signet');
  });

  it('config set stores a known scalar path as a string (no JSON coercion)', async () => {
    await run('config', 'init');
    await run('config', 'set', 'profiles.regtest.btc.rpcUrl', '8080');
    expect(readCfg().profiles.regtest.btc.rpcUrl).to.equal('8080');
    expect(typeof readCfg().profiles.regtest.btc.rpcUrl).to.equal('string');
  });

  it('config set still JSON-parses a structured value at a non-scalar path', async () => {
    await run('config', 'init');
    await run('config', 'set', 'customFlag', 'true');
    expect(readCfg().customFlag).to.equal(true);
  });

  it('a write refuses to clobber a malformed config file', async () => {
    const malformed = '{ "profiles": {  ';
    writeFileSync(cfg, malformed);
    await run('config', 'set', 'defaults.network', 'regtest');
    expect(err.join(' ')).to.match(/not valid JSON/i);
    // The malformed-but-recoverable file is untouched, not overwritten with `{}`.
    expect(readFileSync(cfg, 'utf-8')).to.equal(malformed);
  });

  it('honors config defaults.output for command output when no -o flag is given', async () => {
    await run('config', 'init');
    await run('config', 'set', 'defaults.output', 'json');
    out = [];
    const validKey = '02' + 'aa'.repeat(32);
    await run('create', '-t', 'k', '-n', 'regtest', '-b', validKey);
    const parsed = JSON.parse(out.join('\n'));
    expect(parsed.action).to.equal('create');
    expect(parsed.data).to.include('did:btcr2:');
  });

  it('config set rejects an invalid enum value for a known key', async () => {
    await run('config', 'init');
    await run('config', 'set', 'defaults.network', 'mainnett');
    expect(err.join(' ')).to.match(/Expected one of/);
    // The invalid value was not persisted.
    expect(readCfg().defaults?.network).to.be.undefined;
  });

  it('config set warns but still writes an unknown path', async () => {
    await run('config', 'init');
    await run('config', 'set', 'profiles.regtest.btc.rset', 'http://typo');
    expect(err.join(' ')).to.match(/not a known config path/);
    expect(readCfg().profiles.regtest.btc.rset).to.equal('http://typo');
  });

  it('config validate passes on a freshly initialized config', async () => {
    await run('config', 'init');
    out = [];
    await run('config', 'validate');
    const parsed = JSON.parse(out.join('\n'));
    expect(parsed.ok).to.equal(true);
    expect(parsed.issues).to.deep.equal([]);
  });

  it('config validate reports unknown keys', async () => {
    await run('config', 'init');
    await run('config', 'set', 'profiles.regtest.btc.rset', 'http://x'); // unknown path (warned)
    out = [];
    await run('config', 'validate');
    const parsed = JSON.parse(out.join('\n'));
    expect(parsed.ok).to.equal(false);
    expect(parsed.issues.some((i: { path: string }) => i.path === 'profiles.regtest.btc.rset')).to.equal(true);
  });

  it('config path prints the resolved config and keystore paths', async () => {
    out = [];
    await run('config', 'path');
    const parsed = JSON.parse(out.join('\n'));
    expect(parsed.config).to.equal(cfg);
    expect(parsed.keystore).to.be.a('string');
  });

  it('config effective reports resolved values with provenance', async () => {
    await run('config', 'init');
    await run('config', 'set', 'profiles.regtest.btc.rest', 'http://custom:3000');
    out = [];
    await run('config', 'effective', '-n', 'regtest');
    const parsed = JSON.parse(out.join('\n'));
    expect(parsed.network).to.equal('regtest');
    expect(parsed.btc.rest.value).to.equal('http://custom:3000');
    expect(parsed.btc.rest.source).to.equal('file');
  });

  it('config doctor reports unreachable endpoints', async function () {
    this.timeout(15000);
    out = [];
    await run(
      '--btc-rest', 'http://127.0.0.1:1',
      '--btc-rpc-url', 'http://127.0.0.1:1',
      '--cas-gateway', 'http://127.0.0.1:1',
      'config', 'doctor', '-n', 'regtest',
    );
    const parsed = JSON.parse(out.join('\n'));
    const rest = parsed.checks.find((c: { endpoint: string }) => c.endpoint === 'btc-rest');
    expect(rest.ok).to.equal(false);
    expect(parsed.checks.every((c: { ok: boolean }) => c.ok === false)).to.equal(true);
  });

  it('config get redacts the rpc password by default', async () => {
    await run('config', 'init');
    await run('config', 'set', 'profiles.regtest.btc.rpcPass', 'super-secret');
    out = [];
    await run('config', 'get', 'profiles.regtest');
    expect(out.join('\n')).to.not.contain('super-secret');
    expect(out.join('\n')).to.contain('********');
  });

  it('config get --show-secrets reveals the rpc password', async () => {
    await run('config', 'init');
    await run('config', 'set', 'profiles.regtest.btc.rpcPass', 'super-secret');
    out = [];
    await run('config', 'get', 'profiles.regtest', '--show-secrets');
    expect(out.join('\n')).to.contain('super-secret');
  });

  it('config get on the password leaf redacts it directly', async () => {
    await run('config', 'init');
    await run('config', 'set', 'profiles.regtest.btc.rpcPass', 'super-secret');
    out = [];
    await run('config', 'get', 'profiles.regtest.btc.rpcPass');
    expect(out.join('\n')).to.not.contain('super-secret');
    expect(out.join('\n')).to.contain('********');
  });

  it('config list redacts secrets by default', async () => {
    await run('config', 'init');
    await run('config', 'set', 'profiles.regtest.btc.rpcPass', 'super-secret');
    out = [];
    await run('config', 'list');
    expect(out.join('\n')).to.not.contain('super-secret');
    expect(out.join('\n')).to.contain('********');
  });

  it('config set rejects a prototype-polluting path', async () => {
    await run('config', 'init');
    await run('config', 'set', '__proto__.polluted', 'evil');
    expect(err.join(' ')).to.match(/Illegal config path segment/);
    expect(({} as Record<string, unknown>).polluted).to.be.undefined;
  });

  it('config set rejects a non-number for a numeric leaf', async () => {
    await run('config', 'init');
    await run('config', 'set', 'profiles.regtest.btc.feeRate', 'lots');
    expect(err.join(' ')).to.match(/expected a number/);
    expect(readCfg().profiles.regtest.btc?.feeRate).to.be.undefined;
  });

  it('config set stores an identity path as a string (no numeric coercion)', async () => {
    await run('config', 'init');
    await run('config', 'set', 'profiles.regtest.identity.default', '12345');
    expect(readCfg().profiles.regtest.identity.default).to.equal('12345');
  });

  it('config validate reports a newer-than-supported schemaVersion instead of throwing', async () => {
    writeFileSync(cfg, JSON.stringify({ schemaVersion: 9999, profiles: {} }));
    out = [];
    await run('config', 'validate');
    const parsed = JSON.parse(out.join('\n'));
    expect(parsed.ok).to.equal(false);
    expect(parsed.issues.some((i: { path: string }) => i.path === 'schemaVersion')).to.equal(true);
  });

  it('profile show redacts the rpc password by default', async () => {
    await run('config', 'init');
    await run('config', 'set', 'profiles.regtest.btc.rpcPass', 'super-secret');
    out = [];
    await run('profile', 'show', 'regtest');
    expect(out.join('\n')).to.not.contain('super-secret');
    expect(out.join('\n')).to.contain('********');
  });

  it('config effective scrubs a password embedded in the rpc url', async () => {
    await run('config', 'init');
    await run('config', 'set', 'profiles.regtest.btc.rpcUrl', 'http://alice:s3cret@node:18443');
    out = [];
    await run('config', 'effective', '-n', 'regtest');
    const parsed = JSON.parse(out.join('\n'));
    expect(parsed.btc.rpcUrl.value).to.not.contain('s3cret');
    expect(parsed.btc.rpcUrl.value).to.contain('********');
  });

  it('completion bash prints a completion script', async () => {
    await run('completion', 'bash');
    expect(out.join('\n')).to.contain('complete -F _btcr2 btcr2');
  });
});

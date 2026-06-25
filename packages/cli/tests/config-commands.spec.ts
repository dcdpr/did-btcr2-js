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

  it('completion bash prints a completion script', async () => {
    await run('completion', 'bash');
    expect(out.join('\n')).to.contain('complete -F _btcr2 btcr2');
  });
});

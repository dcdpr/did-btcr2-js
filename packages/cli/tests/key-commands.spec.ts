import { SchnorrKeyPair } from '@did-btcr2/keypair';
import { bytesToHex } from '@noble/hashes/utils.js';
import type { Command } from 'commander';
import { mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DidBtcr2Cli } from '../src/cli.js';
import type { ApiFactory, ConnectionOverrides } from '../src/config.js';
import { CLIError } from '../src/error.js';
import { createKeystoreTestApiFactory, createTestApiFactory, expect, originalConsoleLog } from './helpers.js';

function keySub(cli: DidBtcr2Cli, name: string): Command {
  const key = cli.program.commands.find(c => c.name() === 'key');
  if (!key) throw new Error('key command not found');
  const sub = key.commands.find(c => c.name() === name);
  if (!sub) throw new Error(`key ${name} not found`);
  return sub;
}

describe('key commands', () => {
  let dir: string;
  let keystore: string;
  let out: string[];

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'btcr2-keycmd-'));
    keystore = join(dir, 'keystore.json');
    out = [];
    console.log = (msg?: unknown) => { if (msg !== undefined) out.push(String(msg)); };
  });

  afterEach(() => {
    console.log = originalConsoleLog;
    rmSync(dir, { recursive: true, force: true });
  });

  function makeCli(): DidBtcr2Cli {
    return new DidBtcr2Cli(createTestApiFactory(), createKeystoreTestApiFactory(keystore, 'pw'));
  }

  // Each call is a fresh CLI invocation reading/writing the shared keystore file.
  async function runKey(name: string, ...args: string[]): Promise<void> {
    await keySub(makeCli(), name).parseAsync(args, { from: 'user' });
  }

  it('generate creates a key and prints its id and public key', async () => {
    await runKey('generate', '--name', 'alice', '--set-active');
    const result = JSON.parse(out[0]);
    expect(result.keyId).to.match(/^urn:kms:secp256k1:[0-9a-f]{32}$/);
    expect(result.publicKey).to.match(/^[0-9a-f]{66}$/);
    expect(result.active).to.equal(true);
  });

  it('list shows generated keys with the active marker', async () => {
    await runKey('generate', '--name', 'alice', '--set-active');
    out = [];
    await runKey('list');
    const list = JSON.parse(out[0]);
    expect(list).to.have.length(1);
    expect(list[0].name).to.equal('alice');
    expect(list[0].active).to.equal(true);
  });

  it('show prints public material but never a secret', async () => {
    await runKey('generate', '--name', 'bob', '--set-active');
    out = [];
    await runKey('show', 'bob');
    const shown = JSON.parse(out[0]);
    expect(shown.publicKey).to.match(/^[0-9a-f]{66}$/);
    expect(shown).to.not.have.property('secretKey');
  });

  it('use sets and persists the active key across invocations', async () => {
    await runKey('generate', '--name', 'a');
    await runKey('generate', '--name', 'b');
    await runKey('use', 'a');
    out = [];
    await runKey('list');
    const active = JSON.parse(out[0]).find((k: { active: boolean }) => k.active);
    expect(active.name).to.equal('a');
  });

  it('delete removes a non-active key', async () => {
    await runKey('generate', '--name', 'a', '--set-active');
    await runKey('generate', '--name', 'b');
    await runKey('delete', 'b');
    out = [];
    await runKey('list');
    const list = JSON.parse(out[0]);
    expect(list).to.have.length(1);
    expect(list[0].name).to.equal('a');
  });

  it('import --public adds a watch-only key', async () => {
    const pub = bytesToHex(SchnorrKeyPair.generate().publicKey.compressed);
    await runKey('import', '--public', pub, '--name', 'watch');
    const result = JSON.parse(out[0]);
    expect(result.watchOnly).to.equal(true);
    expect(result.publicKey).to.equal(pub);
  });

  it('rejects a duplicate name', async () => {
    await runKey('generate', '--name', 'dup');
    await expect(runKey('generate', '--name', 'dup')).to.be.rejectedWith(CLIError, /already exists/);
  });

  it('export --secret requires --out', async () => {
    await runKey('generate', '--name', 'a', '--set-active');
    await expect(runKey('export', 'a', '--secret')).to.be.rejectedWith(CLIError, /requires --out/);
  });

  it('export writes the secret to a 0600 file', async () => {
    await runKey('generate', '--name', 'a', '--set-active');
    out = [];
    const secretOut = join(dir, 'secret.hex');
    await runKey('export', 'a', '--secret', '--out', secretOut);
    expect(JSON.parse(out[0]).secretWrittenTo).to.equal(secretOut);
    expect(readFileSync(secretOut, 'utf-8')).to.match(/^[0-9a-f]{64}$/);
    if (process.platform !== 'win32') expect(statSync(secretOut).mode & 0o777).to.equal(0o600);
  });

  it('export without --secret prints only the public key', async () => {
    await runKey('generate', '--name', 'a', '--set-active');
    out = [];
    await runKey('export', 'a');
    const result = JSON.parse(out[0]);
    expect(result.publicKey).to.match(/^[0-9a-f]{66}$/);
    expect(result).to.not.have.property('secretWrittenTo');
  });

  it('threads --keystore and --passphrase-file through to the keystore factory', async () => {
    let captured: ConnectionOverrides | undefined;
    const spy: ApiFactory = (_network, overrides) => {
      captured = overrides;
      return createKeystoreTestApiFactory(keystore, 'pw')();
    };
    const cli = new DidBtcr2Cli(createTestApiFactory(), spy);
    await cli.run(['node', 'btcr2', '--keystore', keystore, '--passphrase-file', '/tmp/pw', 'key', 'generate', '--name', 'wired']);
    expect(captured?.keystore).to.equal(keystore);
    expect(captured?.passphraseFile).to.equal('/tmp/pw');
  });
});

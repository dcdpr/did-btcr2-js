import { createApi, type DidBtcr2Api } from '@did-btcr2/api';
import { SchnorrKeyPair } from '@did-btcr2/keypair';
import { KeyManagerSigner } from '@did-btcr2/key-manager';
import type { Command } from 'commander';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DidBtcr2Cli } from '../src/cli.js';
import type { ApiFactory } from '../src/config.js';
import { CLIError } from '../src/error.js';
import { createKeystoreTestApiFactory, createTestApiFactory, expect, originalConsoleLog } from './helpers.js';

function sub(cli: DidBtcr2Cli, name: string): Command {
  const c = cli.program.commands.find(x => x.name() === name);
  if (!c) throw new Error(`${name} not found`);
  return c;
}

describe('update and deactivate (signing)', () => {
  let dir: string;
  let keystore: string;
  let did: string;
  let out: string[];

  let captured: { params?: any };

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'btcr2-update-'));
    keystore = join(dir, 'keystore.json');
    out = [];
    captured = {};
    console.log = (m?: unknown) => { if (m !== undefined) out.push(String(m)); };
    did = createApi().createDid('deterministic', SchnorrKeyPair.generate().publicKey.compressed, { network: 'regtest' });
  });

  afterEach(() => {
    console.log = originalConsoleLog;
    rmSync(dir, { recursive: true, force: true });
  });

  function seedActiveKey(): void {
    createKeystoreTestApiFactory(keystore, 'pw')().kms.generateKey({ setActive: true });
  }

  // A real keystore-backed KeyManager plus a stubbed update that captures its
  // params, so the signing wiring is exercised without real Bitcoin I/O.
  function stubFactory(): ApiFactory {
    return () => {
      const realApi = createKeystoreTestApiFactory(keystore, 'pw')();
      return {
        kms   : realApi.kms,
        btcr2 : { update: async (params: unknown) => { captured.params = params; return { signed: 'mock' }; } },
      } as unknown as DidBtcr2Api;
    };
  }

  const sourceDoc = (): string => JSON.stringify({ id: did });
  const PATCHES = JSON.stringify([{ op: 'add', path: '/service/1', value: { id: '#x' } }]);

  it('update is unblocked and fails on an empty keystore at key resolution', async () => {
    const cli = new DidBtcr2Cli(createTestApiFactory(), stubFactory());
    await expect(
      sub(cli, 'update').parseAsync(
        ['-s', sourceDoc(), '--source-version-id', '1', '-p', PATCHES, '-m', '#k0', '-b', '"#beacon-0"'],
        { from: 'user' },
      ),
    ).to.be.rejectedWith(CLIError, /no active key/i);
  });

  it('update resolves the active key, builds a KeyManagerSigner, and calls update', async () => {
    seedActiveKey();
    const cli = new DidBtcr2Cli(createTestApiFactory(), stubFactory());
    await sub(cli, 'update').parseAsync(
      ['-s', sourceDoc(), '--source-version-id', '2', '-p', PATCHES, '-m', '#k0', '-b', '"#beacon-0"'],
      { from: 'user' },
    );
    expect(captured.params.signer).to.be.instanceOf(KeyManagerSigner);
    expect(captured.params.sourceVersionId).to.equal(2);
    expect(captured.params.patches).to.deep.equal(JSON.parse(PATCHES));
    expect(JSON.parse(out[0]).signed).to.equal('mock');
  });

  it('rejects a non-numeric --source-version-id before signing', async () => {
    seedActiveKey();
    const cli = new DidBtcr2Cli(createTestApiFactory(), stubFactory());
    await expect(
      sub(cli, 'update').parseAsync(
        ['-s', sourceDoc(), '--source-version-id', 'abc', '-p', PATCHES, '-m', '#k0', '-b', '"#beacon-0"'],
        { from: 'user' },
      ),
    ).to.be.rejectedWith(CLIError, /non-negative integer/);
    expect(captured.params).to.equal(undefined);
  });

  it('deactivate routes through update with the deactivation patch', async () => {
    seedActiveKey();
    const cli = new DidBtcr2Cli(createTestApiFactory(), stubFactory());
    await sub(cli, 'deactivate').parseAsync(
      ['-s', sourceDoc(), '--source-version-id', '3', '-m', '#k0', '-b', '"#beacon-0"'],
      { from: 'user' },
    );
    expect(captured.params.signer).to.be.instanceOf(KeyManagerSigner);
    expect(captured.params.patches).to.deep.equal([{ op: 'add', path: '/deactivated', value: true }]);
  });
});

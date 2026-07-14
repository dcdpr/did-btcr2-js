import { createApi, type DidBtcr2Api } from '@did-btcr2/api';
import { SchnorrKeyPair } from '@did-btcr2/keypair';
import { KeyManagerSigner } from '@did-btcr2/key-manager';
import { StaticFeeEstimator } from '@did-btcr2/method';
import type { Command } from 'commander';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DidBtcr2Cli } from '../src/cli.js';
import type { ApiFactory } from '../src/config.js';
import { CLIError } from '../src/error.js';
import { createKeystoreTestApiFactory, createTestApiFactory, expect, originalConsoleError, originalConsoleLog } from './helpers.js';

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
    // CAS publication is opt-in and never required; with no --publish-to-cas
    // flag the CLI defaults to 'never' so updates complete sidecar-only.
    expect(captured.params.publishToCas).to.equal('never');
    expect(JSON.parse(out[0]).signed).to.equal('mock');
  });

  it('update forwards --publish-to-cas auto to the api', async () => {
    seedActiveKey();
    const cli = new DidBtcr2Cli(createTestApiFactory(), stubFactory());
    await sub(cli, 'update').parseAsync(
      ['-s', sourceDoc(), '--source-version-id', '2', '-p', PATCHES, '-m', '#k0', '-b', '"#beacon-0"',
        '--publish-to-cas', 'auto'],
      { from: 'user' },
    );
    expect(captured.params.publishToCas).to.equal('auto');
  });

  it('update rejects an invalid --publish-to-cas value before signing', async () => {
    seedActiveKey();
    const cli = new DidBtcr2Cli(createTestApiFactory(), stubFactory());
    await expect(
      sub(cli, 'update').parseAsync(
        ['-s', sourceDoc(), '--source-version-id', '2', '-p', PATCHES, '-m', '#k0', '-b', '"#beacon-0"',
          '--publish-to-cas', 'sometimes'],
        { from: 'user' },
      ),
    ).to.be.rejectedWith(CLIError, /must be one of "auto", "always", or "never"/);
    expect(captured.params).to.equal(undefined);
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
    expect(captured.params.publishToCas).to.equal('never');
  });

  it('deactivate forwards --publish-to-cas always to the api', async () => {
    seedActiveKey();
    const cli = new DidBtcr2Cli(createTestApiFactory(), stubFactory());
    await sub(cli, 'deactivate').parseAsync(
      ['-s', sourceDoc(), '--source-version-id', '3', '-m', '#k0', '-b', '"#beacon-0"',
        '--publish-to-cas', 'always'],
      { from: 'user' },
    );
    expect(captured.params.publishToCas).to.equal('always');
  });

  it('deactivate rejects an invalid --publish-to-cas value before signing', async () => {
    seedActiveKey();
    const cli = new DidBtcr2Cli(createTestApiFactory(), stubFactory());
    await expect(
      sub(cli, 'deactivate').parseAsync(
        ['-s', sourceDoc(), '--source-version-id', '3', '-m', '#k0', '-b', '"#beacon-0"',
          '--publish-to-cas', 'sometimes'],
        { from: 'user' },
      ),
    ).to.be.rejectedWith(CLIError, /must be one of "auto", "always", or "never"/);
    expect(captured.params).to.equal(undefined);
  });

  it('update forwards --fee-rate as a StaticFeeEstimator in broadcastOptions', async () => {
    seedActiveKey();
    const cli = new DidBtcr2Cli(createTestApiFactory(), stubFactory());
    await sub(cli, 'update').parseAsync(
      ['-s', sourceDoc(), '--source-version-id', '2', '-p', PATCHES, '-m', '#k0', '-b', '"#beacon-0"',
        '--fee-rate', '12'],
      { from: 'user' },
    );
    expect(captured.params.broadcastOptions.feeEstimator).to.be.instanceOf(StaticFeeEstimator);
    expect(captured.params.broadcastOptions.feeEstimator.satsPerVbyte).to.equal(12);
  });

  it('update forwards --change-address in broadcastOptions', async () => {
    seedActiveKey();
    const cli = new DidBtcr2Cli(createTestApiFactory(), stubFactory());
    await sub(cli, 'update').parseAsync(
      ['-s', sourceDoc(), '--source-version-id', '2', '-p', PATCHES, '-m', '#k0', '-b', '"#beacon-0"',
        '--change-address', 'bcrt1qexamplechangeaddr'],
      { from: 'user' },
    );
    expect(captured.params.broadcastOptions.changeAddress).to.equal('bcrt1qexamplechangeaddr');
  });

  it('update omits broadcastOptions when neither fee-rate nor change-address is set', async () => {
    seedActiveKey();
    const cli = new DidBtcr2Cli(createTestApiFactory(), stubFactory());
    await sub(cli, 'update').parseAsync(
      ['-s', sourceDoc(), '--source-version-id', '2', '-p', PATCHES, '-m', '#k0', '-b', '"#beacon-0"'],
      { from: 'user' },
    );
    expect(captured.params.broadcastOptions).to.equal(undefined);
  });

  it('update rejects an invalid --fee-rate before calling update', async () => {
    seedActiveKey();
    const cli = new DidBtcr2Cli(createTestApiFactory(), stubFactory());
    await expect(
      sub(cli, 'update').parseAsync(
        ['-s', sourceDoc(), '--source-version-id', '2', '-p', PATCHES, '-m', '#k0', '-b', '"#beacon-0"',
          '--fee-rate', '-5'],
        { from: 'user' },
      ),
    ).to.be.rejectedWith(CLIError, /positive number of sats/);
    expect(captured.params).to.equal(undefined);
  });

  it('deactivate forwards --fee-rate as a StaticFeeEstimator in broadcastOptions', async () => {
    seedActiveKey();
    const cli = new DidBtcr2Cli(createTestApiFactory(), stubFactory());
    await sub(cli, 'deactivate').parseAsync(
      ['-s', sourceDoc(), '--source-version-id', '3', '-m', '#k0', '-b', '"#beacon-0"',
        '--fee-rate', '7'],
      { from: 'user' },
    );
    expect(captured.params.broadcastOptions.feeEstimator.satsPerVbyte).to.equal(7);
  });
});

describe('update/deactivate watch hint (ADR 082)', () => {
  let dir: string;
  let keystore: string;
  let err: string[];
  let originalStderrWrite: typeof process.stderr.write;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'btcr2-watch-'));
    keystore = join(dir, 'keystore.json');
    err = [];
    console.log = () => {};
    console.error = (m?: unknown) => { if (m !== undefined) err.push(String(m)); };
    originalStderrWrite = process.stderr.write;
    process.stderr.write = ((chunk: unknown) => { err.push(String(chunk)); return true; }) as typeof process.stderr.write;
    createKeystoreTestApiFactory(keystore, 'pw')().kms.generateKey({ setActive: true });
  });

  afterEach(() => {
    console.log = originalConsoleLog;
    console.error = originalConsoleError;
    process.stderr.write = originalStderrWrite;
    rmSync(dir, { recursive: true, force: true });
  });

  /** A signing stub whose update returns a fixed txid, so the watch hint can be observed. */
  function txidStub(txid: string): ApiFactory {
    return () => {
      const realApi = createKeystoreTestApiFactory(keystore, 'pw')();
      return {
        kms   : realApi.kms,
        btcr2 : { update: async () => ({ txid }) },
      } as unknown as DidBtcr2Api;
    };
  }

  const didFor = (network: string): string =>
    createApi().createDid('deterministic', SchnorrKeyPair.generate().publicKey.compressed, { network: network as never });

  it('prints a Watch link for the txid on a network with an explorer', async () => {
    const did = didFor('mutinynet');
    const cli = new DidBtcr2Cli(createTestApiFactory(), txidStub('cafe1234'));
    await sub(cli, 'update').parseAsync(
      ['-s', JSON.stringify({ id: did }), '--source-version-id', '1', '-p', '[]', '-m', '#k0', '-b', '"#beacon-0"'],
      { from: 'user' },
    );
    expect(err.join(' ')).to.match(/Watch:\s+https:\/\/mutinynet\.com\/tx\/cafe1234/);
  });

  it('omits the Watch link on a network without an explorer (regtest)', async () => {
    const did = didFor('regtest');
    const cli = new DidBtcr2Cli(createTestApiFactory(), txidStub('cafe1234'));
    await sub(cli, 'deactivate').parseAsync(
      ['-s', JSON.stringify({ id: did }), '--source-version-id', '1', '-m', '#k0', '-b', '"#beacon-0"'],
      { from: 'user' },
    );
    expect(err.join(' ')).to.not.match(/Watch:/);
  });
});

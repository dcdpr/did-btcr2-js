import { createApi, type DidBtcr2Api } from '@did-btcr2/api';
import { SchnorrKeyPair } from '@did-btcr2/keypair';
import type { Command } from 'commander';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DidBtcr2Cli } from '../src/cli.js';
import {
  confirmBroadcast,
  DEFAULT_FEE_RATE_SATS_PER_VBYTE,
  ESTIMATED_BEACON_TX_VBYTES,
  MAX_FEE_RATE_SATS_PER_VBYTE,
} from '../src/confirm.js';
import type { ApiFactory } from '../src/config.js';
import { CLIError } from '../src/error.js';
import { createKeystoreTestApiFactory, createTestApiFactory, expect, originalConsoleLog } from './helpers.js';

function sub(cli: DidBtcr2Cli, name: string): Command {
  const c = cli.program.commands.find(x => x.name() === name);
  if (!c) throw new Error(`${name} not found`);
  return c;
}

/** Forces stdin non-interactive for the duration of `fn`, then restores it. */
function withNonTtyStdinSync<T>(fn: () => T): T {
  const stdin = process.stdin as unknown as { isTTY?: boolean };
  const had = Object.prototype.hasOwnProperty.call(stdin, 'isTTY');
  const prev = stdin.isTTY;
  stdin.isTTY = false;
  try {
    return fn();
  } finally {
    if (had) stdin.isTTY = prev;
    else delete stdin.isTTY;
  }
}

/** Async variant of {@link withNonTtyStdinSync}. */
async function withNonTtyStdin<T>(fn: () => Promise<T>): Promise<T> {
  const stdin = process.stdin as unknown as { isTTY?: boolean };
  const had = Object.prototype.hasOwnProperty.call(stdin, 'isTTY');
  const prev = stdin.isTTY;
  stdin.isTTY = false;
  try {
    return await fn();
  } finally {
    if (had) stdin.isTTY = prev;
    else delete stdin.isTTY;
  }
}

describe('broadcast confirmation', () => {
  const base = {
    did                 : 'did:btcr2:xxxx',
    network             : 'bitcoin' as const,
    beaconId            : '#beacon-0',
    feeRateSatsPerVByte : 12,
  };

  it('skips confirmation on regtest', () => {
    expect(() => confirmBroadcast({ ...base, action: 'update', network: 'regtest' })).to.not.throw();
    expect(() => confirmBroadcast({ ...base, action: 'deactivate', network: 'regtest' })).to.not.throw();
  });

  it('skips the prompt when --yes was passed', () => {
    let prompted = false;
    confirmBroadcast({ ...base, action: 'update' }, {
      yes    : true,
      prompt : () => { prompted = true; return 'no'; },
    });
    expect(prompted).to.equal(false);
  });

  it('proceeds when the operator answers yes', () => {
    expect(() => confirmBroadcast({ ...base, action: 'update' }, { prompt: () => 'yes' })).to.not.throw();
    expect(() => confirmBroadcast({ ...base, action: 'update' }, { prompt: () => ' y ' })).to.not.throw();
  });

  it('aborts when the operator declines', () => {
    expect(() => confirmBroadcast({ ...base, action: 'update' }, { prompt: () => 'no' }))
      .to.throw(CLIError, /not confirmed/);
    expect(() => confirmBroadcast({ ...base, action: 'update' }, { prompt: () => '' }))
      .to.throw(CLIError, /not confirmed/);
  });

  it('fails closed when no confirmation channel is available', () => {
    // With stdin non-interactive and no --yes, confirmation must fail closed.
    withNonTtyStdinSync(() => {
      expect(() => confirmBroadcast({ ...base, action: 'update' })).to.throw(CLIError, /--yes/);
    });
    withNonTtyStdinSync(() => {
      try {
        confirmBroadcast({ ...base, action: 'deactivate' });
        expect.fail('Expected to throw');
      } catch (err: any) {
        expect(err.type).to.equal('CONFIRMATION_REQUIRED_ERROR');
      }
    });
  });

  it('displays the plan with an estimated absolute fee', () => {
    let label = '';
    confirmBroadcast({ ...base, action: 'update' }, {
      prompt : (l) => { label = l; return 'yes'; },
    });
    expect(label).to.include(base.did);
    expect(label).to.include('bitcoin');
    expect(label).to.include('#beacon-0');
    const estimatedSats = Math.ceil(base.feeRateSatsPerVByte * ESTIMATED_BEACON_TX_VBYTES);
    expect(label).to.include(`~${estimatedSats} sats`);
    expect(label).to.include('12 sat/vB');
  });

  it('warns that deactivation is permanent', () => {
    let label = '';
    confirmBroadcast({ ...base, action: 'deactivate' }, {
      prompt : (l) => { label = l; return 'yes'; },
    });
    expect(label).to.match(/permanent|irreversible/i);
  });
});

describe('fee-rate ceiling and command-level confirmation', () => {
  let dir: string;
  let keystore: string;
  let did: string;
  let captured: { params?: any };

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'btcr2-broadcast-safety-'));
    keystore = join(dir, 'keystore.json');
    captured = {};
    console.log = () => {};
    createKeystoreTestApiFactory(keystore, 'pw')().kms.generateKey({ setActive: true });
  });

  afterEach(() => {
    console.log = originalConsoleLog;
    rmSync(dir, { recursive: true, force: true });
  });

  function stubFactory(): ApiFactory {
    return () => {
      const realApi = createKeystoreTestApiFactory(keystore, 'pw')();
      return {
        kms   : realApi.kms,
        btcr2 : { update: async (params: unknown) => { captured.params = params; return { signed: 'mock' }; } },
      } as unknown as DidBtcr2Api;
    };
  }

  const didFor = (network: string): string =>
    createApi().createDid('deterministic', SchnorrKeyPair.generate().publicKey.compressed, { network: network as never });

  const updateArgs = (id: string, extra: string[] = []): string[] => [
    '-s', JSON.stringify({ id }),
    '--source-version-id', '1',
    '-p', '[]',
    '-m', '#k0',
    '-b', '"#beacon-0"',
    ...extra,
  ];

  it('rejects a fat-fingered --fee-rate above the ceiling', async () => {
    did = didFor('regtest');
    const cli = new DidBtcr2Cli(createTestApiFactory(), stubFactory());
    await expect(
      sub(cli, 'update').parseAsync(updateArgs(did, ['--fee-rate', '50000']), { from: 'user' }),
    ).to.be.rejectedWith(CLIError, new RegExp(`maximum ${MAX_FEE_RATE_SATS_PER_VBYTE}`));
    expect(captured.params).to.equal(undefined);
  });

  it('accepts a --fee-rate at the ceiling', async () => {
    did = didFor('regtest');
    const cli = new DidBtcr2Cli(createTestApiFactory(), stubFactory());
    await sub(cli, 'update').parseAsync(
      updateArgs(did, ['--fee-rate', String(MAX_FEE_RATE_SATS_PER_VBYTE)]),
      { from: 'user' },
    );
    expect(captured.params.broadcastOptions.feeEstimator.satsPerVbyte).to.equal(MAX_FEE_RATE_SATS_PER_VBYTE);
  });

  it('rejects an excessive BTCR2_FEE_RATE from the environment', async () => {
    did = didFor('regtest');
    process.env.BTCR2_FEE_RATE = '50000';
    try {
      const cli = new DidBtcr2Cli(createTestApiFactory(), stubFactory());
      await expect(
        sub(cli, 'update').parseAsync(updateArgs(did), { from: 'user' }),
      ).to.be.rejectedWith(CLIError, /maximum/);
      expect(captured.params).to.equal(undefined);
    } finally {
      delete process.env.BTCR2_FEE_RATE;
    }
  });

  it('requires --yes on a public network when non-interactive', async () => {
    did = didFor('mutinynet');
    const cli = new DidBtcr2Cli(createTestApiFactory(), stubFactory());
    await withNonTtyStdin(async () => {
      await expect(
        sub(cli, 'update').parseAsync(updateArgs(did), { from: 'user' }),
      ).to.be.rejectedWith(CLIError, /--yes/);
    });
    expect(captured.params).to.equal(undefined);
  });

  it('proceeds on a public network with --yes', async () => {
    did = didFor('mutinynet');
    const cli = new DidBtcr2Cli(createTestApiFactory(), stubFactory());
    await withNonTtyStdin(async () => {
      await sub(cli, 'update').parseAsync(updateArgs(did, ['--yes']), { from: 'user' });
    });
    expect(captured.params).to.not.equal(undefined);
  });

  it('requires --yes for a non-interactive deactivate on a public network', async () => {
    did = didFor('mutinynet');
    const cli = new DidBtcr2Cli(createTestApiFactory(), stubFactory());
    const args = [
      '-s', JSON.stringify({ id: did }),
      '--source-version-id', '1',
      '-m', '#k0',
      '-b', '"#beacon-0"',
    ];
    await withNonTtyStdin(async () => {
      await expect(
        sub(cli, 'deactivate').parseAsync(args, { from: 'user' }),
      ).to.be.rejectedWith(CLIError, /--yes/);
    });
    expect(captured.params).to.equal(undefined);
  });

  it('shows the default fee rate in the plan when none is configured', () => {
    // Unit-level: no fee flag/env/profile means the SDK default is displayed.
    let label = '';
    confirmBroadcast({
      action              : 'update',
      did                 : 'did:btcr2:xxxx',
      network             : 'signet',
      beaconId            : '#beacon-0',
      feeRateSatsPerVByte : DEFAULT_FEE_RATE_SATS_PER_VBYTE,
    }, { prompt: (l) => { label = l; return 'yes'; } });
    expect(label).to.include(`${DEFAULT_FEE_RATE_SATS_PER_VBYTE} sat/vB`);
  });
});

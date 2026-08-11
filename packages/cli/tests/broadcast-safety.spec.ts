import { createApi, type DidBtcr2Api } from '@did-btcr2/api';
import { SchnorrKeyPair } from '@did-btcr2/keypair';
import type { Command } from 'commander';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DidBtcr2Cli } from '../src/cli.js';
import {
  broadcastConfirmer,
  confirmBroadcast,
  DEFAULT_FEE_RATE_SATS_PER_VBYTE,
  MAX_FEE_RATE_SATS_PER_VBYTE,
  ttyPrompt,
  type TtyPromptIo,
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
    feeSats             : 1860n,
    vsize               : 155,
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

  it('displays the plan with the exact fee of the built transaction', () => {
    let label = '';
    confirmBroadcast({ ...base, action: 'update' }, {
      prompt : (l) => { label = l; return 'yes'; },
    });
    expect(label).to.include(base.did);
    expect(label).to.include('bitcoin');
    expect(label).to.include('#beacon-0');
    expect(label).to.include('1860 sats');
    expect(label).to.include('155 vB');
    expect(label).to.include('12 sat/vB');
    expect(label).to.not.include('~');
  });

  it('shows the fee the built transaction pays, via the update-flow callback adapter', () => {
    // The SDK hands the built transaction's exact fee and size to the
    // confirmation callback; what the operator sees must be those values.
    let label = '';
    const confirm = broadcastConfirmer({
      action              : 'update',
      did                 : 'did:btcr2:xxxx',
      network             : 'bitcoin',
      beaconId            : '#beacon-0',
      feeRateSatsPerVByte : 12,
    }, { prompt: (l) => { label = l; return 'yes'; } });
    confirm({ feeSats: 4321n, vsize: 149 });
    expect(label).to.include('4321 sats');
    expect(label).to.include('149 vB');
    expect(label).to.not.include('1860');
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

  // A real keystore-backed KeyManager plus a stubbed update that captures its
  // params, so the signing wiring is exercised without real Bitcoin I/O. The
  // stub stands in for the built beacon transaction: it invokes the
  // confirmation callback with a fixed exact fee and size, and only records
  // the call as completed after confirmation passes.
  function stubFactory(): ApiFactory {
    return () => {
      const realApi = createKeystoreTestApiFactory(keystore, 'pw')();
      return {
        kms   : realApi.kms,
        btcr2 : {
          update : async (params: any) => {
            await params.confirmBroadcast?.({ beaconId: '#beacon-0', feeSats: 1860n, vsize: 155 });
            captured.params = params;
            return { signed: 'mock' };
          },
        },
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
      feeSats             : 775n,
      vsize               : 155,
      feeRateSatsPerVByte : DEFAULT_FEE_RATE_SATS_PER_VBYTE,
    }, { prompt: (l) => { label = l; return 'yes'; } });
    expect(label).to.include(`${DEFAULT_FEE_RATE_SATS_PER_VBYTE} sat/vB`);
  });
});

describe('ttyPrompt terminal reads', () => {
  type ReadFn = NonNullable<TtyPromptIo['read']>;

  /** A readSync stand-in from a script of per-call behaviors. */
  function fakeRead(script: Array<'EAGAIN' | 'EOF' | 'EIO' | number>): { read: ReadFn } {
    const queue = [...script];
    const read = ((_fd: number, buf: Buffer, off: number) => {
      const next = queue.length ? queue.shift()! : 0x0a;
      if (next === 'EAGAIN' || next === 'EOF' || next === 'EIO') {
        const error = new Error(next) as Error & { code: string };
        error.code = next;
        throw error;
      }
      buf[off] = next;
      return 1;
    }) as unknown as ReadFn;
    return { read };
  }

  const yesBytes = [...'yes\n'].map(c => c.charCodeAt(0));

  it('retries EAGAIN until input arrives instead of aborting on an idle TTY', () => {
    const { read } = fakeRead(['EAGAIN', 'EAGAIN', ...yesBytes]);
    const answer = ttyPrompt('label', { read, write: () => {}, wait: () => {} });
    expect(answer).to.equal('yes');
  });

  it('stops waiting at the idle cap and returns the accumulated (empty) answer', () => {
    const { read } = fakeRead(['EAGAIN']);
    let waited = 0;
    const answer = ttyPrompt('label', {
      read,
      write     : () => {},
      wait      : () => { waited += 5; },
      pollMs    : 5,
      maxIdleMs : 20,
    });
    expect(answer).to.equal('');
    expect(waited).to.be.at.most(25);
  });

  it('an empty answer from the idle cap declines the broadcast', () => {
    const { read } = fakeRead(['EAGAIN']);
    const prompt = (label: string): string => ttyPrompt(label, {
      read,
      write     : () => {},
      wait      : () => {},
      pollMs    : 5,
      maxIdleMs : 10,
    });
    expect(() => confirmBroadcast({
      action              : 'update',
      did                 : 'did:btcr2:xxxx',
      network             : 'signet',
      beaconId            : '#beacon-0',
      feeSats             : 775n,
      vsize               : 155,
      feeRateSatsPerVByte : 5,
    }, { prompt })).to.throw(CLIError, /not confirmed/);
  });

  it('treats EOF as end of input, not an error', () => {
    const { read } = fakeRead([...yesBytes.slice(0, 3), 'EOF']);
    expect(ttyPrompt('label', { read, write: () => {}, wait: () => {} })).to.equal('yes');
  });

  it('propagates real read errors instead of converting them to an empty answer', () => {
    const { read } = fakeRead(['EIO']);
    expect(() => ttyPrompt('label', { read, write: () => {}, wait: () => {} })).to.throw(/EIO/);
  });
});

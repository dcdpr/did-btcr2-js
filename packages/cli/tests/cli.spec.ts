import { Identifier } from '@did-btcr2/method';
import { Command } from 'commander';
import { rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Btcr2Command from '../src/command.js';
import { DidBtcr2Cli } from '../src/cli.js';
import { CLIError } from '../src/error.js';
import { expect, originalConsoleError, originalConsoleLog } from './helpers.js';

function getSubcommand(cli: DidBtcr2Cli, name: string): Command {
  const command = cli.program.commands.find((cmd: Command) => cmd.name() === name);
  if (!command) {
    throw new Error(`Subcommand ${name} not found`);
  }
  return command;
}

describe('DidBtcr2Cli command actions', () => {
  const originalDecode = Identifier.decode;

  afterEach(() => {
    (Identifier as any).decode = originalDecode;
    console.log = originalConsoleLog;
    console.error = originalConsoleError;
  });

  it('validates create options', async () => {
    const cli = new DidBtcr2Cli();
    const create = getSubcommand(cli, 'create');

    (cli as any).invokeCommand = async () => {
      throw new Error('invokeCommand should not be reached');
    };

    await expect((create as any)._actionHandler([], { type: 'z', network: 'bitcoin', bytes: 'abcd' }, create)).to.be.rejectedWith(CLIError);
    await expect((create as any)._actionHandler([], { type: 'k', network: 'not-a-network', bytes: 'abcd' }, create)).to.be.rejectedWith(CLIError);
    await expect((create as any)._actionHandler([], { type: 'k', network: 'bitcoin', bytes: '' }, create)).to.be.rejectedWith(CLIError);
  });

  it('invokes create on valid input', async () => {
    const cli = new DidBtcr2Cli();
    const create = getSubcommand(cli, 'create');
    let invoked: any;
    const results: any[] = [];

    (cli as any).invokeCommand = async (params: any) => { invoked = params; return { action: 'create', did: 'did:btcr2:abc' }; };
    (cli as any).printResult = (result: any) => results.push(result);

    await (create as any)._actionHandler([], { type: 'k', network: 'bitcoin', bytes: 'aa' }, create);

    expect(invoked.action).to.equal('create');
    expect(invoked.options).to.deep.equal({ type: 'k', network: 'bitcoin', bytes: 'aa' });
    expect(results[0]).to.deep.equal({ action: 'create', did: 'did:btcr2:abc' });
  });

  it('rejects invalid identifiers for resolve/read', async () => {
    const cli = new DidBtcr2Cli();
    const resolve = getSubcommand(cli, 'resolve');

    Identifier.decode = () => { throw new Error('bad id'); };

    await expect((resolve as any)._actionHandler([], { identifier: 'invalid' }, resolve)).to.be.rejectedWith(CLIError);
  });

  it('parses resolution options string', async () => {
    const cli = new DidBtcr2Cli();
    const resolve = getSubcommand(cli, 'resolve');
    (Identifier as any).decode = () => ({ network: 'bitcoin' });

    let invoked: any;
    (cli as any).invokeCommand = async (params: any) => { invoked = params; return { action: 'resolve', resolution: { ok: true } }; };

    await (resolve as any)._actionHandler([], { identifier: 'did:btcr2:valid', resolutionOptions: '{"versionId":1}' }, resolve);

    expect(invoked.action).to.equal('resolve');
    expect(invoked.options.options).to.deep.equal({ versionId: 1 });
  });

  it('reads resolution options from a file', async () => {
    const cli = new DidBtcr2Cli();
    const resolve = getSubcommand(cli, 'resolve');
    (Identifier as any).decode = () => ({ network: 'bitcoin' });

    const tempPath = join(tmpdir(), 'btcr2-resolve.json');
    await writeFile(tempPath, '{"network":"testnet3"}', 'utf-8');

    let invoked: any;
    (cli as any).invokeCommand = async (params: any) => { invoked = params; return { action: 'resolve', resolution: { ok: true } }; };

    await (resolve as any)._actionHandler([], { identifier: 'did:btcr2:valid', resolutionOptionsPath: tempPath }, resolve);

    expect(invoked.options.options).to.deep.equal({ network: 'testnet3' });

    await rm(tempPath, { force: true });
  });

  it('throws on bad resolution options', async () => {
    const cli = new DidBtcr2Cli();
    const resolve = getSubcommand(cli, 'resolve');
    (Identifier as any).decode = () => ({ network: 'bitcoin' });

    await expect((resolve as any)._actionHandler([], { identifier: 'did:btcr2:valid', resolutionOptions: 'not json' }, resolve)).to.be.rejectedWith(CLIError);
    await expect((resolve as any)._actionHandler([], { identifier: 'did:btcr2:valid', resolutionOptionsPath: '/no/file/here.json' }, resolve)).to.be.rejectedWith(CLIError);
  });

  it('validates update inputs', async () => {
    const cli = new DidBtcr2Cli();
    const update = getSubcommand(cli, 'update');

    (Identifier as any).decode = () => { throw new Error('bad id'); };
    await expect((update as any)._actionHandler([], {
      identifier           : 'bad',
      sourceDocument       : '{}',
      sourceVersionId      : 1,
      patch                : '[]',
      verificationMethodId : 'vm',
      beaconIds            : '[]',
    }, update)).to.be.rejectedWith(CLIError);

    (Identifier as any).decode = () => ({ network: 'bitcoin' });

    await expect((update as any)._actionHandler([], {
      identifier           : 'did:btcr2:valid',
      sourceDocument       : '{',
      sourceVersionId      : 1,
      patch                : '[]',
      verificationMethodId : 'vm',
      beaconIds            : '[]',
    }, update)).to.be.rejectedWith(CLIError);

    await expect((update as any)._actionHandler([], {
      identifier           : 'did:btcr2:valid',
      sourceDocument       : '{}',
      sourceVersionId      : 1,
      patch                : 'not json',
      verificationMethodId : 'vm',
      beaconIds            : '[]',
    }, update)).to.be.rejectedWith(CLIError);

    await expect((update as any)._actionHandler([], {
      identifier           : 'did:btcr2:valid',
      sourceDocument       : '{}',
      sourceVersionId      : 1,
      patch                : '[]',
      verificationMethodId : 'vm',
      beaconIds            : 'not json',
    }, update)).to.be.rejectedWith(CLIError);
  });

  it('passes parsed update inputs to invokeCommand', async () => {
    const cli = new DidBtcr2Cli();
    const update = getSubcommand(cli, 'update');
    (Identifier as any).decode = () => ({ network: 'bitcoin' });

    let invoked: any;
    (cli as any).invokeCommand = async (params: any) => { invoked = params; return { action: 'update', metadata: { ok: true } }; };

    await (update as any)._actionHandler([], {
      identifier           : 'did:btcr2:valid',
      sourceDocument       : '{"id":"did:btcr2:valid"}',
      sourceVersionId      : 2,
      patch                : '[{"op":"add","path":"/foo","value":"bar"}]',
      verificationMethodId : 'vm',
      beaconIds            : '["beacon1"]',
    }, update);

    expect(invoked.action).to.equal('update');
    expect(invoked.options.sourceDocument).to.deep.equal({ id: 'did:btcr2:valid' });
    expect(invoked.options.patch).to.deep.equal([{ op: 'add', path: '/foo', value: 'bar' }]);
    expect(invoked.options.beaconIds).to.deep.equal(['beacon1']);
    expect(invoked.options.sourceVersionId).to.equal(2);
  });

  it('invokes deactivate/delete', async () => {
    const cli = new DidBtcr2Cli();
    const deactivate = getSubcommand(cli, 'deactivate');
    let invoked: any;
    const outputs: any[] = [];
    (cli as any).invokeCommand = async (params: any) => { invoked = params; return { action: 'deactivate', message: 'not impl' }; };
    (cli as any).printResult = (result: any) => outputs.push(result);

    await (deactivate as any)._actionHandler([], {}, deactivate);

    expect(invoked.action).to.equal('deactivate');
    expect(outputs[0]).to.deep.equal({ action: 'deactivate', message: 'not impl' });
  });
});

describe('DidBtcr2Cli helpers', () => {
  const originalExecute = Btcr2Command.prototype.execute;

  afterEach(() => {
    Btcr2Command.prototype.execute = originalExecute;
    console.log = originalConsoleLog;
    console.error = originalConsoleError;
  });

  it('runs invokeCommand and logs results', async () => {
    const cli = new DidBtcr2Cli();
    const messages: string[] = [];
    console.log = (msg?: any) => { if (msg !== undefined) messages.push(String(msg)); };

    (Btcr2Command.prototype as any).execute = async () => ({ action: 'create', did: 'did:btcr2:123' });

    await cli.run(['node', 'btcr2', 'create', '-t', 'k', '-n', 'bitcoin', '-b', 'aa']);

    expect(messages[0]).to.equal('did:btcr2:123');
  });

  it('shows help when no command is provided', async () => {
    const cli = new DidBtcr2Cli();
    const program = cli.program;
    program.exitOverride();

    let helpCalled = false;
    program.outputHelp = (() => { helpCalled = true; return undefined as never; }) as any;

    await cli.run(['node', 'btcr2']);

    expect(helpCalled).to.be.true;
  });
});

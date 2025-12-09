import { Identifier } from '@did-btcr2/method';
import { Command } from 'commander';
import { rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
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

describe('DidBtcr2Cli', () => {
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

    await expect(create.parseAsync(['-t', 'z', '-n', 'bitcoin', '-b', 'abcd'], { from: 'user' })).to.be.rejectedWith(CLIError);
    await expect(create.parseAsync(['-t', 'k', '-n', 'not-a-network', '-b', 'abcd'], { from: 'user' })).to.be.rejectedWith(CLIError);
    await expect(create.parseAsync(['-t', 'k', '-n', 'bitcoin', '-b', ''], { from: 'user' })).to.be.rejectedWith(CLIError);
  });

  it('invokes create on valid input', async () => {
    const cli = new DidBtcr2Cli();
    const create = getSubcommand(cli, 'create');
    let invoked: any;
    const results: any[] = [];

    (cli as any).invokeCommand = async (params: any) => { invoked = params; return { action: 'create', did: 'did:btcr2:abc' }; };
    (cli as any).printResult = (result: any) => results.push(result);

    await create.parseAsync(['-t', 'k', '-n', 'bitcoin', '-b', 'aa'], { from: 'user' });

    expect(invoked.action).to.equal('create');
    expect(invoked.options).to.deep.equal({ type: 'k', network: 'bitcoin', bytes: 'aa' });
    expect(results[0]).to.deep.equal({ action: 'create', did: 'did:btcr2:abc' });
  });

  it('rejects invalid identifiers for resolve/read', async () => {
    const cli = new DidBtcr2Cli();
    const resolve = getSubcommand(cli, 'resolve');

    Identifier.decode = () => { throw new Error('bad id'); };

    await expect(resolve.parseAsync(['-i', 'did:btcr2:invalid'], { from: 'user' })).to.be.rejectedWith(CLIError);
  });

  it('parses resolution options string', async () => {
    const cli = new DidBtcr2Cli();
    const resolve = getSubcommand(cli, 'resolve');
    (Identifier as any).decode = () => ({ network: 'bitcoin' });

    let invoked: any;
    (cli as any).invokeCommand = async (params: any) => { invoked = params; return { action: 'resolve', resolution: { ok: true } }; };

    await resolve.parseAsync(['-i', 'did:btcr2:valid', '-r', '{"versionId":1}'], { from: 'user' });

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

    await resolve.parseAsync(['-i', 'did:btcr2:valid', '-p', tempPath], { from: 'user' });

    expect(invoked.options.options).to.deep.equal({ network: 'testnet3' });

    await rm(tempPath, { force: true });
  });

  it('throws on bad resolution options', async () => {
    const cli = new DidBtcr2Cli();
    const resolve = getSubcommand(cli, 'resolve');
    (Identifier as any).decode = () => ({ network: 'bitcoin' });

    await expect(resolve.parseAsync(['-i', 'did:btcr2:valid', '-r', 'not json'], { from: 'user' })).to.be.rejectedWith(CLIError);
    await expect(resolve.parseAsync(['-i', 'did:btcr2:valid', '-p', '/no/file/here.json'], { from: 'user' })).to.be.rejectedWith(CLIError);
    await expect(resolve.parseAsync(['-i', 'did:btcr2:valid'], { from: 'user' })).to.be.fulfilled;
  });

  it('validates update inputs', async () => {
    const cli = new DidBtcr2Cli();
    const update = getSubcommand(cli, 'update');

    (Identifier as any).decode = () => { throw new Error('bad id'); };
    await expect(update.parseAsync(['-i', 'bad', '-s', '{}', '-v', '1', '-p', '[]', '-m', 'vm', '-b', '[]'], { from: 'user' })).to.be.rejectedWith(CLIError);

    (Identifier as any).decode = () => ({ network: 'bitcoin' });
    await expect(update.parseAsync(['-i', 'did:btcr2:valid', '-s', '{', '-v', '1', '-p', '[]', '-m', 'vm', '-b', '[]'], { from: 'user' })).to.be.rejectedWith(CLIError);

    await expect(update.parseAsync(['-i', 'did:btcr2:valid', '-s', '{}', '-v', '1', '-p', 'not json', '-m', 'vm', '-b', '[]'], { from: 'user' })).to.be.rejectedWith(CLIError);

    await expect(update.parseAsync(['-i', 'did:btcr2:valid', '-s', '{}', '-v', '1', '-p', '[]', '-m', 'vm', '-b', 'not json'], { from: 'user' })).to.be.rejectedWith(CLIError);
  });

  it('passes parsed update inputs to invokeCommand', async () => {
    const cli = new DidBtcr2Cli();
    const update = getSubcommand(cli, 'update');
    (Identifier as any).decode = () => ({ network: 'bitcoin' });

    let invoked: any;
    (cli as any).invokeCommand = async (params: any) => { invoked = params; return { action: 'update', metadata: { ok: true } }; };

    await update.parseAsync(['-i', 'did:btcr2:valid', '-s', '{"id":"did:btcr2:valid"}', '-v', '2', '-p', '[{"op":"add","path":"/foo","value":"bar"}]', '-m', 'vm', '-b', '["beacon1"]'], { from: 'user' });

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
    (cli as any).invokeCommand = async (params: any) => { invoked = params; return { action: 'deactivate', message: 'not impl' }; };
    await deactivate.parseAsync([], { from: 'user' });
    expect(invoked.action).to.equal('deactivate');
  });
});
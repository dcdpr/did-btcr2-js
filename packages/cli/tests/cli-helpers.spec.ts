import { Command } from 'commander';
import { DidBtcr2Cli } from '../src/cli.js';
import Btcr2Command from '../src/command.js';
import { expect, originalConsoleError, originalConsoleLog } from './helpers.js';

describe('DidBtcr2Cli helpers', () => {
  afterEach(() => {
    console.log = originalConsoleLog;
    console.error = originalConsoleError;
  });

  it('runs invokeCommand and logs errors', async () => {
    const cli = new DidBtcr2Cli();
    const executed: any[] = [];

    await (cli as any).invokeCommand({
      options : { test: true },
      action  : 'test',
      command : { execute: async (params: any) => { executed.push(params); } },
    });

    expect(executed[0].action).to.equal('test');

    const errors: any[] = [];
    console.error = (...args: any[]) => errors.push(args.join(' '));

    await (cli as any).invokeCommand({
      options : {},
      action  : 'test',
      command : { execute: async () => { throw new Error('oops'); } },
    });

    expect(errors[0]).to.include('Error executing command:');
  });

  it('runs with provided argv and triggers command execution', async () => {
    const cli = new DidBtcr2Cli();
    ((cli as any).CLI as Command).exitOverride();
    const originalExecute = Btcr2Command.prototype.execute;
    let captured: any;
    Btcr2Command.prototype.execute = async (params: any) => { captured = params; };

    const argv = ['node', 'btcr2', 'create', '-t', 'k', '-n', 'bitcoin', '-b', 'aa'];
    console.log = () => {};
    cli.run(argv);

    expect(captured.action).to.equal('create');
    expect(captured.options.type).to.equal('k');
    expect(captured.options.network).to.equal('bitcoin');
    expect(captured.options.bytes).to.equal('aa');

    Btcr2Command.prototype.execute = originalExecute;
  });

  it('shows help when no command is provided', () => {
    const cli = new DidBtcr2Cli();
    const program = (cli as any).CLI as Command;
    program.exitOverride();

    let helpCalled = false;
    program.help = (() => { helpCalled = true; return undefined as never; }) as any;

    const originalArgv = process.argv;
    process.argv = ['node', 'btcr2'];
    console.log = () => {};

    cli.run();

    expect(helpCalled).to.be.true;

    process.argv = originalArgv;
  });
});

import { DidBtcr2Cli } from '../src/cli.js';
import Btcr2Command, { CommandResult } from '../src/command.js';
import { CLIError } from '../src/error.js';
import { expect, originalConsoleError, originalConsoleLog } from './helpers.js';

describe('CLI Helpers', () => {
  const originalExecute = Btcr2Command.prototype.execute;

  afterEach(() => {
    Btcr2Command.prototype.execute = originalExecute;
    console.log = originalConsoleLog;
    console.error = originalConsoleError;
    process.exitCode = undefined;
  });

  it('returns command results and propagates errors', async () => {
    const cli = new DidBtcr2Cli();
    const result = await (cli as any).invokeCommand({
      options : { },
      action  : 'deactivate',
      command : { execute: async () => ({ action: 'deactivate', message: 'ok' } as CommandResult) },
    });

    expect(result).to.deep.equal({ action: 'deactivate', message: 'ok' });

    await expect((cli as any).invokeCommand({
      options : {},
      action  : 'create',
      command : { execute: async () => { throw new Error('oops'); } },
    })).to.be.rejectedWith('oops');
  });

  it('runs with provided argv and triggers command execution', async () => {
    const cli = new DidBtcr2Cli();
    const program = cli.program;
    program.exitOverride();
    let captured: any;
    Btcr2Command.prototype.execute = async (params: any) => { captured = params; return { action: 'create', did: 'ok' }; };

    const argv = ['node', 'btcr2', 'create', '-t', 'k', '-n', 'bitcoin', '-b', 'aa'];
    await cli.run(argv);

    expect(captured.action).to.equal('create');
    expect(captured.options.type).to.equal('k');
    expect(captured.options.network).to.equal('bitcoin');
    expect(captured.options.bytes).to.equal('aa');
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

  it('handles CLIError through handleError', async () => {
    const cli = new DidBtcr2Cli();
    const errors: any[] = [];
    console.error = (...args: any[]) => errors.push(args.join(' '));

    await (cli as any).handleError(new CLIError('bad', 'BAD'));

    expect(errors[0]).to.equal('bad');
    expect(process.exitCode).to.equal(1);
  });

  it('handles Commander help errors silently', async () => {
    const cli = new DidBtcr2Cli();
    const program = cli.program;
    program.exitOverride();
    let outputHelpCalled = false;
    program.outputHelp = (() => { outputHelpCalled = true; return undefined as never; }) as any;

    await cli.run(['node', 'btcr2', '--help']);

    expect(outputHelpCalled).to.be.true;
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

  it('normalizes argv correctly', () => {
    const cli = new DidBtcr2Cli();
    const normalized0 = cli['normalizeArgv']([]);
    expect(normalized0).to.deep.equal(['node', 'btcr2']);

    const normalized1 = cli['normalizeArgv'](['btcr2']);
    expect(normalized1).to.deep.equal(['node', 'btcr2']);
  });

  it('handles unknown errors through handleError', async () => {
    const cli = new DidBtcr2Cli();
    const errors: any[] = [];
    console.error = (...args: any[]) => errors.push(args.join(' '));

    await (cli as any).handleError(new Error('unknown error'));

    console.log('errors', errors);
    expect(errors[0]).to.deep.equal('Error: unknown error');
    expect(process.exitCode).to.equal(1);
  });

  it('prints results', async () => {
    const cli = new DidBtcr2Cli();
    (cli as any).printResult({ action: 'bad', data: 'nothing' });
  });
});
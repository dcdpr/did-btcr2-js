import { DidBtcr2Cli } from '../src/cli.js';
import { CLIError } from '../src/error.js';
import { createMockOps, expect, originalConsoleError, originalConsoleLog } from './helpers.js';

describe('CLI Helpers', () => {
  afterEach(() => {
    console.log = originalConsoleLog;
    console.error = originalConsoleError;
    process.exitCode = undefined;
  });

  it('shows help when no command is provided', async () => {
    const cli = new DidBtcr2Cli(createMockOps());
    const program = cli.program;
    program.exitOverride();

    let helpCalled = false;
    program.outputHelp = (() => { helpCalled = true; return undefined as never; }) as any;

    await cli.run(['node', 'btcr2']);
    expect(helpCalled).to.be.true;
  });

  it('handles --help silently', async () => {
    const cli = new DidBtcr2Cli(createMockOps());
    const program = cli.program;
    program.exitOverride();

    let outputHelpCalled = false;
    program.outputHelp = (() => { outputHelpCalled = true; return undefined as never; }) as any;

    await cli.run(['node', 'btcr2', '--help']);
    expect(outputHelpCalled).to.be.true;
  });

  it('handles CLIError by printing message and setting exitCode', async () => {
    const ops = createMockOps({
      create : () => { throw new CLIError('bad input', 'BAD'); },
    });
    const cli = new DidBtcr2Cli(ops);
    const errors: string[] = [];
    console.error = (...args: any[]) => errors.push(args.join(' '));

    // Trigger a create with valid-shaped args so parsing succeeds but ops.create throws
    await cli.run(['node', 'btcr2', 'create', '-t', 'k', '-n', 'bitcoin', '-b', 'aa'.repeat(33)]);

    expect(errors[0]).to.equal('bad input');
    expect(process.exitCode).to.equal(1);
  });

  it('handles unknown errors by printing and setting exitCode', async () => {
    const ops = createMockOps({
      create : () => { throw new Error('unexpected'); },
    });
    const cli = new DidBtcr2Cli(ops);
    const errors: any[] = [];
    console.error = (...args: any[]) => errors.push(args[0]);

    await cli.run(['node', 'btcr2', 'create', '-t', 'k', '-n', 'bitcoin', '-b', 'aa'.repeat(33)]);

    expect(errors[0]).to.be.instanceOf(Error);
    expect(errors[0].message).to.equal('unexpected');
    expect(process.exitCode).to.equal(1);
  });

  it('normalizes empty argv', async () => {
    const cli = new DidBtcr2Cli(createMockOps());
    const program = cli.program;
    program.exitOverride();

    let helpCalled = false;
    program.outputHelp = (() => { helpCalled = true; return undefined as never; }) as any;

    await cli.run([]);
    expect(helpCalled).to.be.true;
  });

  it('normalizes single-element argv', async () => {
    const cli = new DidBtcr2Cli(createMockOps());
    const program = cli.program;
    program.exitOverride();

    let helpCalled = false;
    program.outputHelp = (() => { helpCalled = true; return undefined as never; }) as any;

    await cli.run(['btcr2']);
    expect(helpCalled).to.be.true;
  });

  it('outputs JSON format when --output json is used', async () => {
    const ops = createMockOps({
      create : () => 'did:btcr2:test123',
    });
    const cli = new DidBtcr2Cli(ops);
    const messages: string[] = [];
    console.log = (msg?: any) => { if (msg !== undefined) messages.push(String(msg)); };

    await cli.run(['node', 'btcr2', '-o', 'json', 'create', '-t', 'k', '-n', 'bitcoin', '-b', 'aa'.repeat(33)]);

    const parsed = JSON.parse(messages[0]);
    expect(parsed.action).to.equal('create');
    expect(parsed.data).to.equal('did:btcr2:test123');
  });
});

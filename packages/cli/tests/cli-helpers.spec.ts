import { DidBtcr2Cli } from '../src/cli.js';
import { createTestApi, expect, originalConsoleError, originalConsoleLog } from './helpers.js';

describe('CLI Helpers', () => {
  afterEach(() => {
    console.log = originalConsoleLog;
    console.error = originalConsoleError;
    process.exitCode = undefined;
  });

  it('shows help when no command is provided', async () => {
    const cli = new DidBtcr2Cli(createTestApi());
    const program = cli.program;
    program.exitOverride();

    let helpCalled = false;
    program.outputHelp = (() => { helpCalled = true; return undefined as never; }) as any;

    await cli.run(['node', 'btcr2']);
    expect(helpCalled).to.be.true;
  });

  it('handles --help silently', async () => {
    const cli = new DidBtcr2Cli(createTestApi());
    const program = cli.program;
    program.exitOverride();

    let outputHelpCalled = false;
    program.outputHelp = (() => { outputHelpCalled = true; return undefined as never; }) as any;

    await cli.run(['node', 'btcr2', '--help']);
    expect(outputHelpCalled).to.be.true;
  });

  it('handles errors by printing message and setting exitCode', async () => {
    const cli = new DidBtcr2Cli(createTestApi());
    const errors: any[] = [];
    console.error = (...args: any[]) => errors.push(args[0]);

    // Trigger a create with invalid byte length — validation in the create command
    // throws a CLIError before reaching the API.
    await cli.run(['node', 'btcr2', 'create', '-t', 'k', '-n', 'bitcoin', '-b', 'aa']);

    expect(errors.length).to.be.greaterThan(0);
    expect(process.exitCode).to.equal(1);
  });

  it('normalizes empty argv', async () => {
    const cli = new DidBtcr2Cli(createTestApi());
    const program = cli.program;
    program.exitOverride();

    let helpCalled = false;
    program.outputHelp = (() => { helpCalled = true; return undefined as never; }) as any;

    await cli.run([]);
    expect(helpCalled).to.be.true;
  });

  it('normalizes single-element argv', async () => {
    const cli = new DidBtcr2Cli(createTestApi());
    const program = cli.program;
    program.exitOverride();

    let helpCalled = false;
    program.outputHelp = (() => { helpCalled = true; return undefined as never; }) as any;

    await cli.run(['btcr2']);
    expect(helpCalled).to.be.true;
  });

  it('outputs JSON format when --output json is used', async () => {
    const cli = new DidBtcr2Cli(createTestApi());
    const messages: string[] = [];
    console.log = (msg?: any) => { if (msg !== undefined) messages.push(String(msg)); };

    // Valid 33-byte compressed pubkey
    const validKey = '02' + 'aa'.repeat(32);
    await cli.run(['node', 'btcr2', '-o', 'json', 'create', '-t', 'k', '-n', 'regtest', '-b', validKey]);

    const parsed = JSON.parse(messages[0]);
    expect(parsed.action).to.equal('create');
    expect(parsed.data).to.include('did:btcr2:');
  });
});

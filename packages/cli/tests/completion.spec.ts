import type { Command } from 'commander';
import { DidBtcr2Cli } from '../src/cli.js';
import { createTestApiFactory, expect, originalConsoleError, originalConsoleLog } from './helpers.js';

/** The pattern that captures the word list inside the completion script of each shell. */
const WORD_LIST_PATTERN: Record<string, RegExp> = {
  bash : /compgen -W "([^"]+)"/,
  zsh  : /compadd ([^}]+) \}/,
  fish : /-a "([^"]+)"/,
};

describe('completion command', () => {
  let out: string[];
  let err: string[];
  let cli: DidBtcr2Cli;

  beforeEach(() => {
    out = [];
    err = [];
    process.exitCode = undefined;
    cli = new DidBtcr2Cli(createTestApiFactory());
    console.log = (m?: unknown) => { if (m !== undefined) out.push(String(m)); };
    console.error = (m?: unknown) => { if (m !== undefined) err.push(String(m)); };
  });

  afterEach(() => {
    console.log = originalConsoleLog;
    console.error = originalConsoleError;
    process.exitCode = 0;
  });

  async function run(...args: string[]): Promise<void> {
    await cli.run(['node', 'btcr2', ...args]);
  }

  /** The name and the aliases of each registered top-level command, plus the built-in help command. */
  function registeredWords(program: Command): string[] {
    return [...program.commands.flatMap((command) => [command.name(), ...command.aliases()]), 'help'];
  }

  /** The words of the printed completion script for one shell. */
  function scriptWords(shell: string): string[] {
    const match = WORD_LIST_PATTERN[shell].exec(out.join('\n'));
    expect(match, `word list of the ${shell} script`).to.not.equal(null);
    return match![1].trim().split(/\s+/);
  }

  for (const shell of ['bash', 'zsh', 'fish']) {
    it(`${shell} script lists each registered command and alias once, plus help`, async () => {
      await run('completion', shell);
      const words = scriptWords(shell);
      expect(words).to.have.members(registeredWords(cli.program));
      expect(new Set(words).size).to.equal(words.length);
    });
  }

  it('lists init, quickstart, keystore, and help', async () => {
    await run('completion', 'bash');
    expect(scriptWords('bash')).to.include.members(['init', 'quickstart', 'keystore', 'help']);
  });

  it('lists the read and delete aliases', async () => {
    await run('completion', 'bash');
    expect(scriptWords('bash')).to.include.members(['read', 'delete']);
  });

  it('builds the list from the registered commands at run time', async () => {
    cli.program.command('extra').action(() => {});
    await run('completion', 'bash');
    expect(scriptWords('bash')).to.include('extra');
  });

  it('defaults to bash', async () => {
    await run('completion');
    expect(out.join('\n')).to.contain('complete -F _btcr2 btcr2');
  });

  it('refuses an unsupported shell with exit code 1', async () => {
    await run('completion', 'powershell');
    expect(err.join(' ')).to.contain('Unsupported shell "powershell". Use bash, zsh, or fish.');
    expect(process.exitCode).to.equal(1);
  });
});

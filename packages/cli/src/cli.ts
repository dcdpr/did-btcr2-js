import { Command, CommanderError } from 'commander';
import { DidBtcr2 } from '@did-btcr2/method';
import {
  registerCreateCommand,
  registerDeactivateCommand,
  registerResolveCommand,
  registerUpdateCommand,
} from './commands/index.js';
import { CLIError } from './error.js';
import { GlobalOptions, MethodOperations } from './types.js';
import { VERSION } from './version.js';

/** Default MethodOperations delegating to DidBtcr2 static methods. */
const defaultOps: MethodOperations = {
  create  : (genesisBytes, options) => DidBtcr2.create(genesisBytes, options),
  resolve : (identifier, options) => DidBtcr2.resolve(identifier, options),
  update  : (params) => DidBtcr2.update(params),
};

/**
 * CLI tool for the did:btcr2 method.
 */
export class DidBtcr2Cli {
  public readonly program: Command;
  private readonly ops: MethodOperations;

  /**
   * Initializes the CLI with optional custom MethodOperations.
   * @param {MethodOperations} ops - Custom operations for create, resolve, and update.
   */
  constructor(ops: MethodOperations = defaultOps) {
    this.ops = ops;
    this.program = new Command('btcr2')
      .version(`btcr2 ${VERSION}`, '-v, --version', 'Output the current version')
      .description('CLI tool for the did:btcr2 method')
      .option('-o, --output <format>', 'Output format <json|text>', 'text')
      .option('--verbose', 'Verbose output', false)
      .option('--quiet', 'Suppress non-essential output', false);

    const globals = (): GlobalOptions => this.program.opts() as GlobalOptions;

    registerCreateCommand(this.program, this.ops, globals);
    registerResolveCommand(this.program, this.ops, globals);
    registerUpdateCommand(this.program, this.ops, globals);
    registerDeactivateCommand(this.program, this.ops, globals);
  }

  /**
   * Runs the CLI with the provided argv or process.argv.
   * @param {string[]} [argv] - Optional array of command-line arguments.
   * @returns {Promise<void>} - Resolves when execution is complete.
   */
  public async run(argv?: string[]): Promise<void> {
    try {
      const normalized = normalizeArgv(argv ?? process.argv);
      await this.program.parseAsync(normalized, { from: 'node' });
      if (!this.program.args.length) this.program.outputHelp();
    } catch (error: unknown) {
      handleError(error);
    }
  }
}

/**
 * Normalizes argv to ensure it has at least two elements.
 * @param {string[]} argv - The original argv array.
 * @returns {string[]} - The normalized argv array.
 */
function normalizeArgv(argv: string[]): string[] {
  if (argv.length >= 2) return argv;
  if (argv.length === 1) return ['node', argv[0]];
  return ['node', 'btcr2'];
}

/**
 * Handles errors thrown during CLI execution.
 * @param {unknown} error - The error to handle.
 * @returns {void}
 */
function handleError(error: unknown): void {
  if (
    error instanceof CommanderError &&
    (error.code === 'commander.helpDisplayed' || error.code === 'commander.help')
  ) {
    return;
  }
  if (error instanceof CLIError) {
    console.error(error.message);
    process.exitCode ??= 1;
    return;
  }
  console.error(error);
  process.exitCode ??= 1;
}

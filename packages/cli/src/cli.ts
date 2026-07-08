import { DidMethodError } from '@did-btcr2/common';
import { Command, CommanderError } from 'commander';
import {
  registerCompletionCommand,
  registerConfigCommand,
  registerCreateCommand,
  registerDeactivateCommand,
  registerInitCommand,
  registerKeyCommand,
  registerKeystoreCommand,
  registerProfileCommand,
  registerResolveCommand,
  registerUpdateCommand,
} from './commands/index.js';
import { defaultApiFactory, keystoreApiFactory, resolveOutputFormat, type ApiFactory } from './config.js';
import type { GlobalOptions } from './types.js';
import { VERSION } from './version.js';

/**
 * CLI tool for the did:btcr2 method.
 */
export class DidBtcr2Cli {
  public readonly program: Command;

  /**
   * Initializes the CLI with an optional API factory.
   *
   * The factory is called lazily by each command with the appropriate
   * network derived from the DID being operated on. Defaults to
   * {@link defaultApiFactory} which uses public endpoints (mempool.space)
   * for known networks and localhost Polar for regtest.
   *
   * @param factory - Optional API factory for keystore-free commands (create,
   *   resolve). Defaults to {@link defaultApiFactory}.
   * @param keystoreFactory - Optional keystore-aware API factory for commands
   *   that need a signing identity (key, update, deactivate). Defaults to
   *   {@link keystoreApiFactory}.
   */
  constructor(
    factory: ApiFactory = defaultApiFactory,
    keystoreFactory: ApiFactory = keystoreApiFactory,
  ) {
    this.program = new Command('btcr2')
      .version(`btcr2 ${VERSION}`, '-v, --version', 'Output the current version')
      .description('CLI tool for the did:btcr2 method')
      .option('-o, --output <format>', 'Output format <json|text> (default: config defaults.output, else text)')
      .option('--verbose', 'Verbose output', false)
      .option('--quiet', 'Suppress non-essential output', false)
      .option('--home <dir>', 'btcr2 home directory holding config.json + keystore.json (default: ~/.btcr2, %LOCALAPPDATA%\\btcr2 on Windows; overrides $BTCR2_HOME)')
      .option('-c, --config <path>', 'Path to config file (default: <home>/config.json)')
      .option('--profile <name>', 'Config profile name (default: auto-detected from network)')
      .option('--btc-rest <url>', 'Override Bitcoin REST endpoint (Esplora API)')
      .option('--btc-rpc-url <url>', 'Override Bitcoin Core RPC endpoint')
      .option('--btc-rpc-user <user>', 'Bitcoin Core RPC username')
      .option('--btc-rpc-pass <pass>', 'Bitcoin Core RPC password')
      .option('--cas-gateway <url>', 'IPFS HTTP gateway for CAS reads (read-only)')
      .option('--cas-rpc-url <url>', 'IPFS HTTP RPC endpoint for a writable CAS (reads + writes; enables --publish-to-cas)')
      .option('--btc-timeout <ms>', 'Bitcoin REST/RPC request timeout in milliseconds (default: unbounded)')
      .option('--cas-timeout <ms>', 'CAS request timeout in milliseconds (default: 30000; 0 disables)')
      .option('--btc-rest-header <header>', 'Extra Bitcoin REST header "Key: Value" (repeatable)', collectHeader, [])
      .option('--btc-rpc-wallet <name>', 'Bitcoin Core wallet name for wallet-scoped RPCs')
      .option('--btc-rpc-header <header>', 'Extra Bitcoin Core RPC header "Key: Value" (repeatable)', collectHeader, [])
      .option('--keystore <path>', 'Path to the keystore file (default: <home>/keystore.json)')
      .option('--passphrase-file <path>', 'Read the keystore passphrase from a file (unattended use)')
      .option('--signing-key <ref>', 'Key for create/update/deactivate signing: a URN, fingerprint prefix, or name');

    const globals = (): GlobalOptions => this.program.opts() as GlobalOptions;

    // Resolve the effective output format (flag -> BTCR2_OUTPUT -> config
    // defaults.output -> 'text') before any command action runs, so a configured
    // default is honored while an explicit flag still wins. The commander option
    // carries no hard default (which would mask defaults.output); the resolved
    // value is written back so every command reads it through globals().output.
    this.program.hook('preAction', () => {
      const opts = this.program.opts() as GlobalOptions;
      opts.output = resolveOutputFormat({ output: opts.output, config: opts.config, home: opts.home });
    });

    registerInitCommand(this.program, globals);
    registerCreateCommand(this.program, factory, keystoreFactory, globals);
    registerResolveCommand(this.program, factory, globals);
    registerUpdateCommand(this.program, keystoreFactory, globals);
    registerDeactivateCommand(this.program, keystoreFactory, globals);
    registerKeyCommand(this.program, keystoreFactory, globals);
    registerKeystoreCommand(this.program, globals);
    registerConfigCommand(this.program, globals);
    registerProfileCommand(this.program, globals);
    registerCompletionCommand(this.program, globals);
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
      handleError(error, Boolean(this.program.opts().verbose));
    }
  }
}

/**
 * Commander collector for a repeatable header option: accumulates each
 * `Key: Value` occurrence into an array, preserving order.
 */
function collectHeader(value: string, previous: string[]): string[] {
  return [ ...previous, value ];
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
 *
 * Known method errors ({@link DidMethodError} and its subclasses, including
 * {@link CLIError} and the keystore errors) print only their message, never the
 * stack or the structured `data` payload, so internal shapes are not leaked.
 * The full error object and stack are shown only under `--verbose`.
 *
 * @param {unknown} error - The error to handle.
 * @param {boolean} verbose - Whether to print the full error object and stack.
 * @returns {void}
 */
function handleError(error: unknown, verbose: boolean): void {
  if (
    error instanceof CommanderError &&
    (error.code === 'commander.helpDisplayed' || error.code === 'commander.help')
  ) {
    return;
  }
  if (error instanceof DidMethodError) {
    console.error(verbose ? error : error.message);
    process.exitCode ??= 1;
    return;
  }
  console.error(error);
  process.exitCode ??= 1;
}

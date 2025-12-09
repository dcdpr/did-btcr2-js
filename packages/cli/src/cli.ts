import { Identifier } from '@did-btcr2/method';
import { Command, CommanderError } from 'commander';
import { readFile } from 'fs/promises';
import Btcr2Command, {
  CommandRequest,
  CommandResult,
  CreateCommandOptions,
  NetworkOption,
  ResolveCommandOptions,
  UpdateCommandOptions,
} from './command.js';
import { CLIError } from './error.js';

const SUPPORTED_NETWORKS: NetworkOption[] = ['bitcoin', 'testnet3', 'testnet4', 'signet', 'mutinynet', 'regtest'];

/**
 * CLI tool for the did:btcr2 method.
 * @type {DidBtcr2Cli}
 * @class DidBtcr2Cli
 */
export class DidBtcr2Cli {
  public readonly program: Command;

  constructor() {
    this.program = new Command('btcr2')
      .version('btcr2 0.1.0', '-v, --version', 'Output the current version')
      .description('CLI tool for the did:btcr2 method');

    this.configureCommands();
  }

  /**
   * Configures the CLI commands.
   * @returns {void}
   */
  private configureCommands(): void {
    // Create command
    this.program
      .command('create')
      .description('Create an identifier and initial DID document')
      .requiredOption('-t, --type <type>', 'Identifier type <k|x>', 'k')
      .requiredOption(
        '-n, --network <network>',
        'Identifier bitcoin network <bitcoin|testnet3|testnet4|signet|mutinynet|regtest>'
      )
      .requiredOption(
        '-b, --bytes <bytes>',
        'The genesis bytes used to create a DID and DID document as a hex string. ' +
        'If type=k, MUST be secp256k1 public key. ' +
        'If type=x, MUST be SHA-256 hash of a genesis document'
      )
      .action(async (options: { type: string; network: string; bytes: string }) => {
        const parsedOptions = this.parseCreateOptions(options);
        const result = await this.invokeCommand({ options: parsedOptions, action: 'create', command: new Btcr2Command() });
        this.printResult(result);
      });

    // Resolve command
    this.program
      .command('resolve')
      .alias('read')
      .description('Resolve the DID document of the identifier.')
      .requiredOption('-i, --identifier <identifier>', 'did:btcr2 identifier')
      .option('-r, --resolutionOptions <resolutionOptions>', 'JSON string containing resolution options')
      .option('-p, --resolutionOptionsPath <resolutionOptionsPath>', 'Path to a JSON file containing resolution options')
      .action(async (options: { identifier: string; resolutionOptions?: string; resolutionOptionsPath?: string }) => {
        const parsedOptions = await this.parseResolveOptions(options);
        const result = await this.invokeCommand({ options: parsedOptions, action: 'resolve', command: new Btcr2Command() });
        this.printResult(result);
      });

    // Update command
    this.program
      .command('update')
      .description('Update a did:btcr2 document.')
      .requiredOption('-i, --identifier <identifier>', 'did:btcr2 identifier')
      .requiredOption('-s, --sourceDocument <sourceDocument>', 'Source DID document as JSON string')
      .requiredOption('-v, --sourceVersionId <sourceVersionId>', 'Source version ID as a number')
      .requiredOption('-p, --patch <patch>', 'JSON Patch operations as a JSON string array')
      .requiredOption('-m, --verificationMethodId <verificationMethodId>', 'Did document verification method ID as a string')
      .requiredOption('-b, --beaconIds <beaconIds>', 'Beacon IDs as a JSON string array')
      .action(async (options: {
        identifier: string;
        sourceDocument: string;
        sourceVersionId: number;
        patch: string;
        verificationMethodId: string;
        beaconIds: string;
      }) => {
        const parsedOptions = this.parseUpdateOptions(options);
        const result = await this.invokeCommand({ options: parsedOptions, action: 'update', command: new Btcr2Command() });
        this.printResult(result);
      });

    // Deactivate command
    this.program
      .command('deactivate')
      .alias('delete')
      .description('Deactivate the did:btcr2 identifier permanently.')
      .action(async () => {
        const result = await this.invokeCommand({ options: {}, action: 'deactivate', command: new Btcr2Command() });
        this.printResult(result);
      });
  }

  /**
   * Invokes a command with the provided request.
   * @param {object} request The command request
   * @param {any} request.options The command options
   * @param {CommandRequest['action']} request.action The command action
   * @param {Btcr2Command} request.command The command instance
   * @returns {Promise<CommandResult>} The command result
   */
  private async invokeCommand(request: {
    options: any;
    action: CommandRequest['action'];
    command: Btcr2Command;
  }): Promise<CommandResult> {
    return await request.command.execute({ action: request.action, options: request.options } as CommandRequest);
  }

  /**
   * Runs the CLI with the provided argv or process.argv.
   * @param {string[]} [argv] The argv array to use. Defaults to process.argv.
   */
  public async run(argv?: string[]) {
    try {
      const normalized = this.normalizeArgv(argv ?? process.argv);
      await this.program.parseAsync(normalized, { from: 'node' });
      if (!this.program.args.length) this.program.outputHelp();
    } catch (error: any) {
      this.handleError(error);
    }
  }

  /**
   * Normalizes argv to ensure it has at least two elements.
   * @param {string[]} argv The argv array to normalize
   * @returns {string[]} Normalized argv array
   */
  private normalizeArgv(argv: string[]): string[] {
    if (argv.length >= 2) return argv;
    if (argv.length === 1) return ['node', argv[0]];
    return ['node', 'btcr2'];
  }

  /**
   * Handles errors thrown during CLI execution.
   * @param {unknown} error The error to handle
   * @returns {void}
   */
  private handleError(error: unknown): void {
    if (error instanceof CommanderError && (error.code === 'commander.helpDisplayed' || error.code === 'commander.help')) {
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

  /**
   * Parses create command options and throws CLIError on invalid input.
   * @param {object} options The create command options
   * @param {string} options.type The identifier type
   * @param {string} options.network The bitcoin network
   * @param {string} options.bytes The genesis bytes as a hex string
   * @returns {CreateCommandOptions} The parsed create command options
   */
  private parseCreateOptions(options: { type: string; network: string; bytes: string; }): CreateCommandOptions {
    if (!['k', 'x'].includes(options.type)) {
      throw new CLIError(
        'Invalid type. Must be "k" or "x".',
        'INVALID_ARGUMENT_ERROR',
        options
      );
    }
    if (!this.isNetworkValid(options.network)) {
      throw new CLIError(
        'Invalid network. Must be one of "bitcoin", "testnet3", "testnet4", "signet", "mutinynet", or "regtest".',
        'INVALID_ARGUMENT_ERROR',
        options
      );
    }
    if (Buffer.from(options.bytes, 'hex').length === 0) {
      throw new CLIError(
        'Invalid bytes. Must be a non-empty hex string.',
        'INVALID_ARGUMENT_ERROR',
        options
      );
    }
    return {
      type    : options.type as CreateCommandOptions['type'],
      network : options.network as NetworkOption,
      bytes   : options.bytes,
    };
  }

  /**
   * Parses resolve command options and throws CLIError on invalid input.
   * @param {object} options The resolve command options
   * @param {string} options.identifier The did:btcr2 identifier
   * @param {string} [options.resolutionOptions] JSON string of resolution options
   * @param {string} [options.resolutionOptionsPath] Path to a JSON file of resolution options
   * @returns {Promise<ResolveCommandOptions>} The parsed resolve command options
   */
  private async parseResolveOptions(options: {
    identifier: string;
    resolutionOptions?: string;
    resolutionOptionsPath?: string;
  }): Promise<ResolveCommandOptions> {
    this.validateIdentifier(options.identifier, options);
    const resolutionOptions = await this.parseResolutionOptions(options);
    return {
      identifier : options.identifier,
      ...(resolutionOptions && { options: resolutionOptions }),
    };
  }

  /**
   * Parses update command options and throws CLIError on invalid input.
   * @param {object} options The update command options
   * @param {string} options.identifier The did:btcr2 identifier
   * @param {string} options.sourceDocument The source DID document as a JSON string
   * @param {number} options.sourceVersionId The source version ID as a number
   * @param {string} options.patch The JSON Patch operations as a JSON string array
   * @param {string} options.verificationMethodId The DID document verification method ID as a string
   * @param {string} options.beaconIds The beacon IDs as a JSON string array
   * @returns {UpdateCommandOptions} The parsed update command options
   */
  private parseUpdateOptions(options: {
    identifier: string;
    sourceDocument: string;
    sourceVersionId: number;
    patch: string;
    verificationMethodId: string;
    beaconIds: string;
  }): UpdateCommandOptions {
    this.validateIdentifier(options.identifier, options);
    const sourceDocument = this.parseJsonOption<UpdateCommandOptions['sourceDocument']>(
      options.sourceDocument,
      'Invalid options. Must be a valid JSON string.',
      options
    );
    const patch = this.parseJsonOption<UpdateCommandOptions['patch']>(
      options.patch,
      'Invalid options. Must be a valid JSON string.',
      options
    );
    const beaconIds = this.parseJsonOption<UpdateCommandOptions['beaconIds']>(
      options.beaconIds,
      'Invalid options. Must be a valid JSON string.',
      options
    );

    return {
      identifier           : options.identifier,
      sourceDocument,
      sourceVersionId      : Number(options.sourceVersionId),
      patch,
      verificationMethodId : options.verificationMethodId,
      beaconIds,
    } as UpdateCommandOptions;
  }

  /**
   * Parses a JSON option and throws a CLIError on failure.
   * @param {string} value JSON string to parse
   * @param {string} errorMessage Error message to use on failure
   * @param {Record<string, any>} data Additional data to include in the error
   * @returns {T} Parsed JSON object
   */
  private parseJsonOption<T>(value: string, errorMessage: string, data: Record<string, any>): T {
    try {
      return JSON.parse(value) as T;
    } catch {
      throw new CLIError(
        errorMessage,
        'INVALID_ARGUMENT_ERROR',
        data
      );
    }
  }

  /**
   * Parses resolution options from JSON string or file path.
   * @param {object} options The options containing resolution options
   * @param {string} [options.resolutionOptions] JSON string of resolution options
   * @param {string} [options.resolutionOptionsPath] Path to a JSON file of resolution options
   * @returns {Promise<any>} The parsed resolution options
   */
  private async parseResolutionOptions(options: { resolutionOptions?: string; resolutionOptionsPath?: string; }): Promise<any> {
    if (options.resolutionOptions) {
      return this.parseJsonOption(options.resolutionOptions, 'Invalid options. Must be a valid JSON string.', options);
    }
    if (options.resolutionOptionsPath) {
      try {
        const data = await readFile(options.resolutionOptionsPath, 'utf-8');
        return JSON.parse(data);
      } catch {
        throw new CLIError(
          'Invalid options path. Must be a valid path to a JSON file.',
          'INVALID_ARGUMENT_ERROR',
          options
        );
      }
    }
    return undefined;
  }

  /**
   * Validates the did:btcr2 identifier format.
   * @param {string} identifier The identifier to validate
   * @param {Record<string, any>} data Additional data to include in the error
   * @returns {void}
   */
  private validateIdentifier(identifier: string, data: Record<string, any>): void {
    try {
      Identifier.decode(identifier);
    } catch {
      throw new CLIError(
        'Invalid identifier. Must be a valid did:btcr2 identifier.',
        'INVALID_ARGUMENT_ERROR',
        data
      );
    }
  }

  /**
   * Validates if the provided network is supported.
   * @param {string} network The network to validate
   * @returns {boolean} True if the network is valid
   */
  private isNetworkValid(network: string): network is NetworkOption {
    return SUPPORTED_NETWORKS.includes(network as NetworkOption);
  }

  /**
   * Prints the command result to the console.
   * @param {CommandResult} result The command result to print
   * @returns {void}
   */
  private printResult(result: CommandResult): void {
    switch (result.action) {
      case 'create':
        this.log(result.did);
        break;
      case 'resolve':
      case 'read':
        this.log(result.resolution);
        break;
      case 'update':
        this.log(result.metadata);
        break;
      case 'deactivate':
      case 'delete':
        this.log(result.message);
        break;
      default:
        this.log(result);
    }
  }

  /**
   * Logs a payload to the console, formatting objects as JSON.
   * @param {unknown} payload The payload to log
   * @returns {void}
   */
  private log(payload: unknown): void {
    if (typeof payload === 'string') {
      console.log(payload);
      return;
    }
    console.log(JSON.stringify(payload, null, 2));
  }
}

import { DidMethodError } from '@did-btcr2/common';
import { Identifier } from '@did-btcr2/method';
import { Command } from 'commander';
import { readFile } from 'fs/promises';
import Btcr2Command from './command.js';

/**
 * Custom CLI Error class extending DidMethodError.
 */
export class CLIError extends DidMethodError {
  constructor(message: string, type: string = 'CLIError', data?: Record<string, any>) {
    super(message, { type, name: type, data });
  }
}

/**
 * A class-based CLI using Commander.
 * - No forced process.exit().
 * - Configurable by calling `run(argv?)`.
 */
export class DidBtcr2Cli {
  private CLI: Command;

  constructor() {
    // Create the main Commander program
    this.CLI = new Command()
      .name('btcr2')
      .version('btcr2 0.1.0', '-v, --version', 'Output the current version')
      .description('CLI tool for the did:btcr2 method');

    // Configure top-level options and subcommands
    this.configureCommands();
  }

  /**
   * Configure the CLI commands and options.
   * @private
   */
  private configureCommands(): void {
    /* CREATE */
    this.CLI
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
      .action(
        async (options: { type: string; network: string; bytes: string, [key: string]: any }) => {
          if(!['k','x'].includes(options.type)) {
            throw new CLIError(
              'Invalid type. Must be "k" or "x".',
              'INVALID_ARGUMENT_ERROR',
              options
            );
          }
          if(!['bitcoin','testnet3','testnet4','signet','mutinynet','regtest'].includes(options.network)) {
            throw new CLIError(
              'Invalid network. Must be one of "bitcoin", "testnet3", ' +
              '"testnet4", "signet", "mutinynet", or "regtest".',
              'INVALID_ARGUMENT_ERROR',
              options
            );
          }
          if(Buffer.from(options.bytes, 'hex').length === 0) {
            throw new CLIError(
              'Invalid bytes. Must be a non-empty hex string.',
              'INVALID_ARGUMENT_ERROR',
              options
            );
          }
          await this.invokeCommand({ options, action: 'create', command: new Btcr2Command() });
        }
      );

    /* READ / RESOLVE */
    this.CLI
      .command('resolve')
      .alias('read')
      .description('Resolve the DID document of the identifier.')
      .requiredOption('-i, --identifier <identifier>', 'did:btcr2 identifier')
      .option('-r, --resolutionOptions <resolutionOptions>', 'JSON string containing resolution options')
      .option('-p, --resolutionOptionsPath <resolutionOptionsPath>', 'Path to a JSON file containing resolution options')
      .action(async (options: { identifier: string; resolutionOptions?: string; resolutionOptionsPath?: string }) => {
        try {
          Identifier.decode(options.identifier);
        } catch {
          throw new CLIError(
            'Invalid identifier. Must be a valid did:btcr2 identifier.',
            'INVALID_ARGUMENT_ERROR',
            options
          );
        }
        if(options.resolutionOptions) {
          try {
            options.resolutionOptions = JSON.parse(options.resolutionOptions);
          } catch {
            throw new CLIError(
              'Invalid options. Must be a valid JSON string.',
              'INVALID_ARGUMENT_ERROR',
              options
            );
          }
        }
        if(options.resolutionOptionsPath) {
          try {
            const data = await readFile(options.resolutionOptionsPath, 'utf-8');
            options.resolutionOptions = JSON.parse(data);
          } catch {
            throw new CLIError(
              'Invalid options path. Must be a valid path to a JSON file.',
              'INVALID_ARGUMENT_ERROR',
              options
            );
          }
        }
        await this.invokeCommand({ options, action: 'resolve', command: new Btcr2Command() });
      });

    /* UPDATE */
    this.CLI
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
        sourceDocument: string; // stringified DidDocument; e.g. '{ "@context": "...", "id": "did:btcr2:...", ... }'
        sourceVersionId: number;
        patch: string; // stringified PatchOperation[]; e.g. '[{ "op": "add", "path": "/foo", "value": "bar" }]'
        verificationMethodId: string;
        beaconIds: string // stringified string[]; e.g. '["beaconId1","beaconId2"]'
       }) => {
        // Validate identifier by decoding
        try {
          Identifier.decode(options.identifier);
        } catch {
          throw new CLIError(
            'Invalid identifier. Must be a valid did:btcr2 identifier.',
            'INVALID_ARGUMENT_ERROR',
            options
          );
        }
        // Validate source document JSON
        if(options.sourceDocument) {
          try {
            options.sourceDocument = JSON.parse(options.sourceDocument);
          } catch {
            throw new CLIError(
              'Invalid options. Must be a valid JSON string.',
              'INVALID_ARGUMENT_ERROR',
              options
            );
          }
        }
        // Validate patch JSON
        if(options.patch) {
          try {
            options.patch = JSON.parse(options.patch);
          } catch {
            throw new CLIError(
              'Invalid options. Must be a valid JSON string.',
              'INVALID_ARGUMENT_ERROR',
              options
            );
          }
        }
        // Validate beacon IDs JSON
        if(options.beaconIds) {
          try {
            options.beaconIds = JSON.parse(options.beaconIds);
          } catch {
            throw new CLIError(
              'Invalid options. Must be a valid JSON string.',
              'INVALID_ARGUMENT_ERROR',
              options
            );
          }
        }
        await this.invokeCommand({ options, action: 'update', command: new Btcr2Command() });
      });

    /* DEACTIVATE / DELETE */
    this.CLI
      .command('deactivate')
      .alias('delete')
      .description('Deactivate the did:btcr2 identifier permanently.')
      .action(async (options) => {
        await this.invokeCommand({ options, action: 'deactivate', command: new Btcr2Command() });
      });
  }

  /**
   * A helper to invoke the command logic without forcibly exiting.
   */
  private async invokeCommand({ options, action, command }: {
    options: any;
    action: string;
    command: Btcr2Command;
  }): Promise<void> {
    try {
      await command.execute({ options, action });
    } catch (error) {
      console.error('Error executing command:', error);
    }
  }

  /**
   * Parse and run the CLI.
   */
  public run(argv?: string[]): void {
    if (argv) {
      this.CLI.parse(argv, { from: 'user' });
    } else {
      // parse real process.argv
      this.CLI.parse();
    }

    // If no subcommand was given, show help
    if (!this.CLI.args.length) {
      this.CLI.help();
    }
  }
}


export default new DidBtcr2Cli().run();
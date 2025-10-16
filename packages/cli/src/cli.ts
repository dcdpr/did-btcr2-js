import { Command } from 'commander';
import pkg from '../package.json' with { type: 'json' };
import CRUD from './crud.js';

export interface ICommand {
  execute(params: { options?: any; action?: string }): Promise<void>;
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
      .version(`btcr2 v${pkg.version}`, '-v, --version', 'Output the current version')
      .description('CLI tool for the did:btcr2 method');

    // Configure top-level options and subcommands
    this.configureCommands();
  }

  /**
   * Define all commands, aliases, and options here.
   */
  private configureCommands(): void {
    // A required option for the entire CLI
    this.CLI
      .requiredOption(
        '-n, --network <network>',
        'Bitcoin network (mainnet, testnet, signet, regtest)',
        'mainnet'
      );

    // CREATE
    this.CLI
      .command('create')
      .description('Create a did:btcr2 identifier and initial DID document')
      .requiredOption('-t, --type <type>', 'Type of the identifier (key, external)', 'key')
      .option('-p, --pubkey <pubkey>', 'Hex public key (when type=key)')
      .option('-d, --document <document>', 'JSON DID document (when type=external)')
      .option('-o, --options <options>', 'JSON object of optional parameters')
      .action(async (options) => {
        // The action name is "create"
        await this.invokeCommand({
          options,
          action  : options.name(),
          command : new CRUD(),
        });
      });

    // READ / RESOLVE (Single command with alias)
    this.CLI
      .command('read')
      .alias('resolve')
      .description('Resolve the DID document of the identifier.')
      .requiredOption('-i, --identifier <identifier>', 'did:btcr2 identifier')
      .option('-o, --options <options>', 'JSON of optional parameters')
      .action(async (options) => {
        // If you prefer to differentiate "read" vs "resolve", you can check argv
        // or simply treat them identically. Commander uses "read" as the official name.
        await this.invokeCommand({
          options,
          action  : 'read', // or options.name() if you'd like, but that'll be 'read' either way
          command : new CRUD(),
        });
      });

    // UPDATE
    this.CLI
      .command('update')
      .description('Update a did:btcr2 document with an invoked ZCAP-LD capability.')
      .action(async (options) => {
        await this.invokeCommand({
          options,
          action  : options.name(), // 'update'
          command : new CRUD(),
        });
      });

    // DEACTIVATE / DELETE (Single command with alias)
    this.CLI
      .command('deactivate')
      .alias('delete')
      .description('Deactivate the did:btcr2 identifier permanently.')
      .action(async (options) => {
        // For "deactivate" or "delete"
        await this.invokeCommand({
          options,
          action  : 'deactivate',
          command : new CRUD(),
        });
      });
  }

  /**
   * A helper to invoke the command logic without forcibly exiting.
   */
  private async invokeCommand({ options, action, command }: {
    options: any;
    action: string;
    command: CRUD;
  }): Promise<void> {
    try {
      await command.execute({ options, action });
    } catch (error) {
      console.error('Error executing command:', error);
    }
  }

  /**
   * Parse and run the CLI.
   * You can supply custom argv for testing, or let it default to process.argv in production.
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

import { Identifier } from '@did-btcr2/api';
import type { Command } from 'commander';
import { readFile } from 'node:fs/promises';
import { deriveNetwork, type ApiFactory } from '../config.js';
import { CLIError } from '../error.js';
import { formatResult } from '../output.js';
import type { GlobalOptions, ResolveCommandOptions } from '../types.js';

export function registerResolveCommand(
  program : Command,
  factory : ApiFactory,
  globals : () => GlobalOptions,
): void {
  program
    .command('resolve')
    .alias('read')
    .description('Resolve the DID document of the identifier.')
    .requiredOption('-i, --identifier <identifier>', 'did:btcr2 identifier')
    .option('-r, --resolution-options <json>', 'JSON string containing resolution options')
    .option('-p, --resolution-options-path <path>', 'Path to a JSON file containing resolution options')
    .option(
      '--min-conf <n>',
      'Minimum confirmations a beacon signal must have before its update is applied (default: 6). '
        + 'Shortcut for the minConf resolution option; useful on regtest/signet demos.',
    )
    .action(async (options: {
      identifier: string;
      resolutionOptions?: string;
      resolutionOptionsPath?: string;
      minConf?: string;
    }) => {
      const parsed = await validateResolveOptions(options);
      const network = deriveNetwork(parsed.identifier);
      const api = factory(network, globals());
      const data = await api.resolveDid(parsed.identifier, parsed.options);
      const result = { action: 'resolve' as const, data };
      console.log(formatResult(result, globals()));
    });
}

async function validateResolveOptions(options: {
  identifier: string;
  resolutionOptions?: string;
  resolutionOptionsPath?: string;
  minConf?: string;
}): Promise<ResolveCommandOptions> {
  // Validate identifier format early
  Identifier.decode(options.identifier);

  let resolutionOptions = undefined;
  if (options.resolutionOptions) {
    try {
      resolutionOptions = JSON.parse(options.resolutionOptions);
    } catch {
      throw new CLIError(
        'Invalid resolution options. Must be a valid JSON string.',
        'INVALID_ARGUMENT_ERROR',
        options
      );
    }
  } else if (options.resolutionOptionsPath) {
    try {
      const content = await readFile(options.resolutionOptionsPath, 'utf-8');
      resolutionOptions = JSON.parse(content);
    } catch {
      throw new CLIError(
        'Invalid resolution options path. Must be a valid path to a JSON file.',
        'INVALID_ARGUMENT_ERROR',
        options
      );
    }
  }

  // The dedicated flag wins over a minConf carried in the -r/-p JSON: an
  // explicit flag is the more deliberate signal.
  if (options.minConf !== undefined) {
    if (!/^\d+$/.test(options.minConf)) {
      throw new CLIError(
        'Invalid --min-conf value. Must be a non-negative integer.',
        'INVALID_ARGUMENT_ERROR',
        options
      );
    }
    resolutionOptions = { ...resolutionOptions, minConf: Number(options.minConf) };
  }
  return { identifier: options.identifier, options: resolutionOptions };
}

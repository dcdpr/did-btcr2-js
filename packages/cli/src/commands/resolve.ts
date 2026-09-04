import { DEFAULT_MIN_CONF, Identifier } from '@did-btcr2/api';
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
      'Minimum block confirmations a beacon signal needs before resolution applies it '
      + `(positive integer, default: ${DEFAULT_MIN_CONF}). Overrides minConf inside -r/-p`,
      parseMinConf,
    )
    .action(async (options: {
      identifier: string;
      resolutionOptions?: string;
      resolutionOptionsPath?: string;
      minConf?: number;
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
  minConf?: number;
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
  // The flag wins over a minConf inside the JSON options.
  if (options.minConf !== undefined) {
    resolutionOptions = { ...(resolutionOptions ?? {}), minConf: options.minConf };
  }
  return { identifier: options.identifier, options: resolutionOptions };
}

/**
 * Commander argParser for `--min-conf`. Accepts a positive integer (minimum 1),
 * the domain the specification gives `minConf`. Errors at parse time otherwise.
 */
function parseMinConf(value: string): number {
  if (!/^[1-9]\d*$/.test(value)) {
    throw new CLIError(
      '--min-conf must be a positive integer (minimum 1).',
      'INVALID_ARGUMENT_ERROR',
      { value },
    );
  }
  return Number(value);
}

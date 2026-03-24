import type { DidBtcr2Api } from '@did-btcr2/api';
import { Identifier } from '@did-btcr2/api';
import { Command } from 'commander';
import { readFile } from 'node:fs/promises';
import { CLIError } from '../error.js';
import { formatResult } from '../output.js';
import { GlobalOptions, ResolveCommandOptions } from '../types.js';

export function registerResolveCommand(
  program : Command,
  api     : DidBtcr2Api,
  globals : () => GlobalOptions,
): void {
  program
    .command('resolve')
    .alias('read')
    .description('Resolve the DID document of the identifier.')
    .requiredOption('-i, --identifier <identifier>', 'did:btcr2 identifier')
    .option('-r, --resolution-options <json>', 'JSON string containing resolution options')
    .option('-p, --resolution-options-path <path>', 'Path to a JSON file containing resolution options')
    .action(async (options: {
      identifier: string;
      resolutionOptions?: string;
      resolutionOptionsPath?: string;
    }) => {
      const parsed = await validateResolveOptions(options);
      const data = await api.resolveDid(parsed.identifier, parsed.options);
      const result = { action: 'resolve' as const, data };
      console.log(formatResult(result, globals()));
    });
}

async function validateResolveOptions(options: {
  identifier: string;
  resolutionOptions?: string;
  resolutionOptionsPath?: string;
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
  return { identifier: options.identifier, options: resolutionOptions };
}

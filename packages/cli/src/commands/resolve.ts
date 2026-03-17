import { Identifier } from '@did-btcr2/method';
import { Command } from 'commander';
import { readFile } from 'node:fs/promises';
import { CLIError } from '../error.js';
import { formatResult } from '../output.js';
import { GlobalOptions, MethodOperations, ResolveCommandOptions } from '../types.js';

export function registerResolveCommand(
  program : Command,
  ops     : MethodOperations,
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
      const data = await ops.resolve(parsed.identifier, parsed.options);
      const result = { action: 'resolve' as const, data };
      console.log(formatResult(result, globals()));
    });
}

async function validateResolveOptions(options: {
  identifier: string;
  resolutionOptions?: string;
  resolutionOptionsPath?: string;
}): Promise<ResolveCommandOptions> {
  validateIdentifier(options.identifier, options);
  const resolutionOptions = await parseResolutionOptions(options);
  return {
    identifier : options.identifier,
    ...(resolutionOptions && { options: resolutionOptions }),
  };
}

function validateIdentifier(identifier: string, data: Record<string, any>): void {
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

function parseJson<T>(value: string, errorMessage: string, data: Record<string, any>): T {
  try {
    return JSON.parse(value) as T;
  } catch {
    throw new CLIError(errorMessage, 'INVALID_ARGUMENT_ERROR', data);
  }
}

async function parseResolutionOptions(options: {
  resolutionOptions?: string;
  resolutionOptionsPath?: string;
}): Promise<any> {
  if (options.resolutionOptions) {
    return parseJson(
      options.resolutionOptions,
      'Invalid resolution options. Must be a valid JSON string.',
      options
    );
  }
  if (options.resolutionOptionsPath) {
    try {
      const data = await readFile(options.resolutionOptionsPath, 'utf-8');
      return JSON.parse(data);
    } catch {
      throw new CLIError(
        'Invalid resolution options path. Must be a valid path to a JSON file.',
        'INVALID_ARGUMENT_ERROR',
        options
      );
    }
  }
  return undefined;
}

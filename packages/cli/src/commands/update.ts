import type { DidBtcr2Api } from '@did-btcr2/api';
import type { Command } from 'commander';
import { CLIError } from '../error.js';
import { formatResult } from '../output.js';
import type { GlobalOptions, UpdateCommandOptions } from '../types.js';

export function registerUpdateCommand(
  program : Command,
  api     : DidBtcr2Api,
  globals : () => GlobalOptions,
): void {
  program
    .command('update')
    .description('Update a did:btcr2 document.')
    .requiredOption(
      '-s, --source-document <json>',
      'Source DID document as JSON string',
      parseJsonArg('--source-document'),
    )
    .requiredOption(
      '--source-version-id <number>',
      'Source version ID as a number'
    )
    .requiredOption(
      '-p, --patches <json>',
      'JSON Patch operations as a JSON string array',
      parseJsonArg('--patches'),
    )
    .requiredOption(
      '-m, --verification-method-id <id>',
      'DID document verification method ID'
    )
    .requiredOption(
      '-b, --beacon-id <json>',
      'Beacon ID as a JSON string',
      parseJsonArg('--beacon-id'),
    )
    .action(async (options: {
      sourceDocument       : unknown;
      sourceVersionId      : string;
      patches              : unknown;
      verificationMethodId : string;
      beaconId             : unknown;
    }) => {
      const parsed: UpdateCommandOptions = {
        sourceDocument       : options.sourceDocument as UpdateCommandOptions['sourceDocument'],
        patches              : options.patches as UpdateCommandOptions['patches'],
        sourceVersionId      : Number(options.sourceVersionId),
        verificationMethodId : options.verificationMethodId,
        beaconId             : options.beaconId as UpdateCommandOptions['beaconId'],
      };
      const data = await api.btcr2.update(parsed);
      const result = { action: 'update' as const, data };
      console.log(formatResult(result, globals()));
    });
}

/**
 * Returns a commander argParser that validates JSON.
 * Errors at parse time with a clear flag reference.
 */
function parseJsonArg(flagName: string): (value: string) => unknown {
  return (value: string): unknown => {
    try {
      return JSON.parse(value);
    } catch {
      throw new CLIError(
        `Invalid JSON for ${flagName}. Must be a valid JSON string.`,
        'INVALID_ARGUMENT_ERROR',
        { flagName, value }
      );
    }
  };
}

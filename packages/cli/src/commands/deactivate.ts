import type { DidBtcr2Api } from '@did-btcr2/api';
import type { Command } from 'commander';
import { CLIError } from '../error.js';
import { formatResult } from '../output.js';
import type { GlobalOptions, UpdateCommandOptions } from '../types.js';

/** The JSON Patch that marks a DID document as permanently deactivated. */
const DEACTIVATION_PATCH = [{ op: 'add' as const, path: '/deactivated', value: true }];

export function registerDeactivateCommand(
  program : Command,
  api     : DidBtcr2Api,
  globals : () => GlobalOptions,
): void {
  program
    .command('deactivate')
    .alias('delete')
    .description('Deactivate the did:btcr2 identifier permanently. This is irreversible.')
    .requiredOption(
      '-s, --source-document <json>',
      'Current DID document as JSON string',
      parseJsonArg('--source-document'),
    )
    .requiredOption(
      '--source-version-id <number>',
      'Current version ID of the DID document'
    )
    .requiredOption(
      '-m, --verification-method-id <id>',
      'DID document verification method ID used to sign the deactivation'
    )
    .requiredOption(
      '-b, --beacon-id <json>',
      'Beacon ID as a JSON string',
      parseJsonArg('--beacon-id'),
    )
    .action(async (options: {
      sourceDocument       : unknown;
      sourceVersionId      : string;
      verificationMethodId : string;
      beaconId             : unknown;
    }) => {
      const parsed: UpdateCommandOptions = {
        sourceDocument       : options.sourceDocument as UpdateCommandOptions['sourceDocument'],
        patches              : DEACTIVATION_PATCH,
        sourceVersionId      : Number(options.sourceVersionId),
        verificationMethodId : options.verificationMethodId,
        beaconId             : options.beaconId as UpdateCommandOptions['beaconId'],
      };
      const data = await api.btcr2.update(parsed);
      const result = { action: 'deactivate' as const, data };
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

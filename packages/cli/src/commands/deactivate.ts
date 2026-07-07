import { KeyManagerSigner } from '@did-btcr2/key-manager';
import type { Command } from 'commander';
import { deriveNetwork, type ApiFactory } from '../config.js';
import { CLIError } from '../error.js';
import { resolveKeyRef } from '../keystore/resolve-key-ref.js';
import { formatResult } from '../output.js';
import type { GlobalOptions, UpdateCommandOptions } from '../types.js';

/** The JSON Patch that marks a DID document as permanently deactivated. */
const DEACTIVATION_PATCH = [{ op: 'add' as const, path: '/deactivated', value: true }];

export function registerDeactivateCommand(
  program : Command,
  factory : ApiFactory,
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
      if (!/^\d+$/.test(options.sourceVersionId)) {
        throw new CLIError(
          '--source-version-id must be a non-negative integer.',
          'INVALID_ARGUMENT_ERROR',
          { value: options.sourceVersionId },
        );
      }
      const parsed: UpdateCommandOptions = {
        sourceDocument       : options.sourceDocument as UpdateCommandOptions['sourceDocument'],
        patches              : DEACTIVATION_PATCH,
        sourceVersionId      : Number(options.sourceVersionId),
        verificationMethodId : options.verificationMethodId,
        beaconId             : options.beaconId as UpdateCommandOptions['beaconId'],
      };
      const did = parsed.sourceDocument?.id;
      if (!did) {
        throw new CLIError(
          'Source document must contain an "id" field.',
          'INVALID_ARGUMENT_ERROR',
          options
        );
      }
      // Deactivation is an update that applies the deactivation patch. The core
      // method has no separate deactivate path, so this routes through update.
      const network = deriveNetwork(did);
      const api = factory(network, globals());
      const keyId = resolveKeyRef(api.kms.kms, globals().signingKey);
      const signer = new KeyManagerSigner(api.kms.kms, keyId);
      // The CLI's CAS is a read-only gateway (no writable CAS is configurable
      // yet), so CAS publication is disabled explicitly. The returned artifacts
      // (txid, announcement, proof) are printed for manual sidecar distribution.
      const data = await api.btcr2.update({
        sourceDocument       : parsed.sourceDocument,
        patches              : parsed.patches,
        sourceVersionId      : parsed.sourceVersionId,
        verificationMethodId : parsed.verificationMethodId,
        beaconId             : parsed.beaconId,
        signer,
        publishToCas         : 'never',
      });
      console.log(formatResult({ action: 'deactivate', data }, globals()));
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

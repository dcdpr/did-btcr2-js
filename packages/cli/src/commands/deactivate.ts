import type { PublishToCasMode } from '@did-btcr2/api';
import { KeyManagerSigner } from '@did-btcr2/key-manager';
import type { Command } from 'commander';
import { deriveNetwork, resolveBroadcastOptions, resolveSigningKeyRef, type ApiFactory } from '../config.js';
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
    .option(
      '--publish-to-cas <mode>',
      'Publish update artifacts to a writable CAS before broadcast: auto|always|never. '
        + 'CAS publication is optional; the default distributes the returned artifacts via sidecar.',
      parsePublishToCasMode,
      'never',
    )
    .option(
      '--fee-rate <satsPerVByte>',
      'Fee rate in sats/vByte for the beacon transaction (default: 5). '
        + 'Raise it under congestion so the transaction confirms.',
    )
    .option(
      '--change-address <address>',
      'Send transaction change to this address instead of the beacon address, '
        + 'so a DID\'s announcements are not linked on-chain (ADR 044).',
    )
    .action(async (options: {
      sourceDocument       : unknown;
      sourceVersionId      : string;
      verificationMethodId : string;
      beaconId             : unknown;
      publishToCas         : PublishToCasMode;
      feeRate?             : string;
      changeAddress?       : string;
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
      const keyId = resolveKeyRef(api.kms.kms, resolveSigningKeyRef(globals()));
      const signer = new KeyManagerSigner(api.kms.kms, keyId);
      // Resolve fee-rate/change-address through the flag -> env -> profile chain
      // into beacon broadcast options. Undefined when neither is set, so the
      // SDK defaults (5 sat/vB, change back to the beacon address) still apply.
      const broadcastOptions = resolveBroadcastOptions(network, globals(), {
        feeRate       : options.feeRate,
        changeAddress : options.changeAddress,
      });
      // CAS publication is optional and never required: every beacon update can
      // be completed and shared via sidecar alone. It is opt-in and defaults to
      // 'never'; pass --publish-to-cas auto|always to publish the signed update
      // (and, for CAS beacons, the announcement) to a writable CAS configured
      // via --cas-rpc-url. The returned artifacts (txid, announcement, proof)
      // are always printed for sidecar distribution regardless.
      const data = await api.btcr2.update({
        sourceDocument       : parsed.sourceDocument,
        patches              : parsed.patches,
        sourceVersionId      : parsed.sourceVersionId,
        verificationMethodId : parsed.verificationMethodId,
        beaconId             : parsed.beaconId,
        signer,
        publishToCas         : options.publishToCas,
        ...(broadcastOptions ? { broadcastOptions } : {}),
      });
      console.log(formatResult({ action: 'deactivate', data }, globals()));
    });
}

/**
 * Commander argParser for `--publish-to-cas`. Validates the value is one of the
 * three {@link PublishToCasMode} policies, erroring at parse time otherwise.
 */
function parsePublishToCasMode(value: string): PublishToCasMode {
  if (value !== 'auto' && value !== 'always' && value !== 'never') {
    throw new CLIError(
      '--publish-to-cas must be one of "auto", "always", or "never".',
      'INVALID_ARGUMENT_ERROR',
      { value },
    );
  }
  return value;
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

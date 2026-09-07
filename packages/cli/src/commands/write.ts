import type { Btcr2DidDocument, DidBtcr2Api, PublishToCasMode } from '@did-btcr2/api';
import { KeyManagerSigner } from '@did-btcr2/key-manager';
import type { Command } from 'commander';
import {
  assertKeystoreAllowedForNetwork,
  deriveNetwork,
  resolveBroadcastOptions,
  resolveSigningKeyRef,
  type ApiFactory,
} from '../config.js';
import { CLIError } from '../error.js';
import { resolveKeyRef } from '../keystore/resolve-key-ref.js';
import { MIN_CONF_HELP, parseMinConf, readResolutionOptions, type ResolutionOptionFlags } from '../resolution-options.js';
import type { GlobalOptions, NetworkOption, UpdateCommandOptions } from '../types.js';

/** The parsed flags that `update` and `deactivate` share. */
export type WriteFlags = ResolutionOptionFlags & {
  identifier            : string;
  sourceDocument?       : unknown;
  sourceVersionId?      : number;
  verificationMethodId? : string;
  beaconId?             : string;
  publishToCas          : PublishToCasMode;
  feeRate?              : string;
  changeAddress?        : string;
};

/**
 * Registers the flags that `update` and `deactivate` share. Each command
 * registers `-i/--identifier` (and `update` its `-p/--patches`) before it
 * calls this function, so those flags lead the help output.
 */
export function registerWriteOptions(command: Command): Command {
  return command
    .option(
      '-s, --source-document <json>',
      'Source DID document as a JSON string. Requires --source-version-id. '
        + 'Omit both to resolve the current document first',
      parseJsonArg('--source-document'),
    )
    .option(
      '--source-version-id <number>',
      'Version ID of the source document, a non-negative integer. Requires --source-document',
      parseSourceVersionId,
    )
    .option(
      '-m, --verification-method-id <id>',
      'Verification method that signs the update '
        + '(default: the one method of the document that publishes the signing key)',
    )
    .option(
      '-b, --beacon-id <id>',
      'Beacon service that announces the update, as a DID URL '
        + '(default: the only beacon of the document, else the one beacon with a spendable UTXO)',
    )
    .option(
      '-r, --resolution-options <json>',
      'Resolution options as a JSON string, for the resolution of the source document',
    )
    .option(
      '--resolution-options-path <path>',
      'Path to a JSON file with resolution options, for the resolution of the source document',
    )
    .option('--min-conf <n>', MIN_CONF_HELP, parseMinConf)
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
    );
}

/**
 * Validates the shared write flags, derives the network from the identifier,
 * applies the mainnet keystore guard, builds the signer, and returns the
 * parameters for `updateDid` and `deactivateDid`.
 *
 * The checks run in this order, before any key material is read:
 * 1. The identifier decodes and names a supported network.
 * 2. `--source-document` and `--source-version-id` come together or not at
 *    all (ADR 101). The api refuses a half pair too; the cli names the flags.
 * 3. The resolution flags come only without the source pair. The api ignores
 *    `resolutionOptions` when the pair is supplied (ADR 098). A silent ignore
 *    of `--min-conf` would mislead.
 * 4. A mainnet write is refused with an unencrypted dev keystore (ADR 080).
 */
export async function prepareWrite(
  options : WriteFlags,
  factory : ApiFactory,
  g       : GlobalOptions,
): Promise<{ network: NetworkOption; api: DidBtcr2Api; params: UpdateCommandOptions }> {
  const did = options.identifier;
  const network = deriveNetwork(did);
  const hasDocument = options.sourceDocument !== undefined;
  const hasVersion = options.sourceVersionId !== undefined;
  if (hasDocument !== hasVersion) {
    throw new CLIError(
      'Provide both --source-document and --source-version-id, or neither. '
        + 'Omit both to resolve the current document first.',
      'INVALID_ARGUMENT_ERROR',
      { did },
    );
  }
  const hasResolutionFlags = options.resolutionOptions !== undefined
    || options.resolutionOptionsPath !== undefined
    || options.minConf !== undefined;
  if (hasDocument && hasResolutionFlags) {
    throw new CLIError(
      '--resolution-options, --resolution-options-path, and --min-conf apply only when '
        + '--source-document and --source-version-id are omitted. A supplied source pair skips resolution.',
      'INVALID_ARGUMENT_ERROR',
      { did },
    );
  }
  assertKeystoreAllowedForNetwork(network, g);
  const resolutionOptions = await readResolutionOptions(options);
  const api = factory(network, g);
  const keyId = resolveKeyRef(api.kms.kms, resolveSigningKeyRef(g));
  const signer = new KeyManagerSigner(api.kms.kms, keyId);
  // Resolve fee-rate/change-address through the flag, env, and profile layers
  // into beacon broadcast options. Undefined when no layer sets one, so the
  // SDK defaults (5 sat/vB, change back to the beacon address) still apply.
  const broadcastOptions = resolveBroadcastOptions(network, g, {
    feeRate       : options.feeRate,
    changeAddress : options.changeAddress,
  });
  return {
    network,
    api,
    params : {
      did,
      signer,
      sourceDocument       : options.sourceDocument as Btcr2DidDocument | undefined,
      sourceVersionId      : options.sourceVersionId,
      verificationMethodId : options.verificationMethodId,
      beaconId             : options.beaconId,
      resolutionOptions,
      publishToCas         : options.publishToCas,
      broadcastOptions,
    },
  };
}

/** Commander argParser for `--source-version-id`: digits only, a non-negative integer. */
function parseSourceVersionId(value: string): number {
  if (!/^\d+$/.test(value)) {
    throw new CLIError(
      '--source-version-id must be a non-negative integer.',
      'INVALID_ARGUMENT_ERROR',
      { value },
    );
  }
  return Number(value);
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
export function parseJsonArg(flagName: string): (value: string) => unknown {
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

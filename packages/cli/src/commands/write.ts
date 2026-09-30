import type { Btcr2DidDocument, DidBtcr2Api, PublishToCasMode } from '@did-btcr2/api';
import { DidApi } from '@did-btcr2/api';
import type { Command } from 'commander';
import {
  assertKeystoreAllowedForNetwork,
  deriveNetwork,
  resolveBroadcastOptions,
  resolveDefaultKeyRef,
  type ApiFactory,
} from '../config.js';
import { CLIError } from '../error.js';
import { GENESIS_DOCUMENT_HELP } from '../genesis-document-file.js';
import { IdentifierRecords, withRecordSidecar } from '../identifier-records.js';
import { resolveKeyRef } from '../keystore/resolve-key-ref.js';
import { warnProfileNetworkMismatch } from '../network-option.js';
import { hasResolutionFlags, MIN_CONF_HELP, parseMinConf, readResolutionOptions, type ResolutionOptionFlags } from '../resolution-options.js';
import { blankToUndef, type GlobalOptions, type NetworkOption, type UpdateCommandOptions } from '../types.js';
import { assertGenesisDocumentApplies } from './resolve.js';

/** The parsed flags that `update` and `deactivate` share. */
export type WriteFlags = ResolutionOptionFlags & {
  identifier            : string;
  sourceDocument?       : unknown;
  sourceVersionId?      : number;
  signingKey?           : string;
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
      '--signing-key <ref>',
      'Key that signs the update: a URN, fingerprint prefix, or name '
        + '(default: the signing key of the identifier record, else the profile identity.default, else the active key)',
    )
    .option(
      '-m, --verification-method-id <id>',
      'Verification method that signs the update '
        + '(default: the one method of the document that publishes the signing key)',
    )
    .option(
      '-b, --beacon-id <id>',
      'Beacon service that announces the update, as a DID URL '
        + '(default: the only beacon of the document, else the one beacon that can fund the signal)',
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
    .option('--genesis-document <path>', `${GENESIS_DOCUMENT_HELP}, for the resolution of the source document`)
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
 *    all (ADR 101). The api takes the pair as one source state, so the cli
 *    names the flags.
 * 3. A supplied `--source-document` describes the identifier.
 * 4. The resolution flags come only without the source pair. The api ignores
 *    `resolutionOptions` when the pair is supplied (ADR 098). A silent ignore
 *    of `--min-conf` would mislead.
 * 5. `--genesis-document` comes only with an external (x) identifier.
 * 6. A mainnet write is refused with an unencrypted dev keystore (ADR 080).
 *
 * After the checks, a warning names a network of the active profile that is
 * not the network of the identifier (ADR 131). The warning never blocks.
 *
 * The identifier can be the name of a record (ADR 133). If the identifier has
 * a record, the sidecar data of the record joins the resolution options of the
 * source resolution, and the signing key of the record signs if
 * `--signing-key` is not given.
 */
export async function prepareWrite(
  options : WriteFlags,
  factory : ApiFactory,
  g       : GlobalOptions,
): Promise<{
  identifier : string;
  network    : NetworkOption;
  api        : DidBtcr2Api;
  params     : UpdateCommandOptions;
  keyId      : string;
  records    : IdentifierRecords;
}> {
  const records = IdentifierRecords.forHome(g);
  const did = records.resolveRef(options.identifier);
  const record = records.get(did);
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
  const sourceDocument = options.sourceDocument as Btcr2DidDocument | undefined;
  if (hasDocument && sourceDocument?.id !== did) {
    throw new CLIError(
      `--source-document has the id ${String(sourceDocument?.id)}, but the identifier under update is ${did}.`,
      'INVALID_ARGUMENT_ERROR',
      { did, sourceDocumentId: sourceDocument?.id },
    );
  }
  if (hasDocument && hasResolutionFlags(options)) {
    throw new CLIError(
      '--resolution-options, --resolution-options-path, --min-conf, and --genesis-document apply only when '
        + '--source-document and --source-version-id are omitted. A supplied source pair skips resolution.',
      'INVALID_ARGUMENT_ERROR',
      { did },
    );
  }
  assertGenesisDocumentApplies(options, new DidApi().decode(did).hrp);
  assertKeystoreAllowedForNetwork(network, g);
  // A supplied source pair skips resolution, so the record sidecar applies only without it.
  const flagOptions = await readResolutionOptions(options);
  const resolutionOptions = hasDocument ? flagOptions : withRecordSidecar(flagOptions, record);
  warnProfileNetworkMismatch(g, network, g);
  const api = factory(network, g);
  const keyId = resolveSigningKey(api, options.signingKey, record?.signingKey, did, g);
  const signer = api.kms.signer(keyId);
  // Resolve fee-rate/change-address through the flag, env, and profile layers
  // into beacon broadcast options. Undefined when no layer sets one, so the
  // SDK defaults (5 sat/vB, change back to the beacon address) still apply.
  const broadcastOptions = resolveBroadcastOptions(network, g, {
    feeRate       : options.feeRate,
    changeAddress : options.changeAddress,
  });
  return {
    identifier : did,
    network,
    api,
    keyId,
    records,
    params     : {
      source  : sourceDocument && options.sourceVersionId !== undefined
        ? { document: sourceDocument, versionId: options.sourceVersionId }
        : did,
      signer,
      options : {
        verificationMethodId : options.verificationMethodId,
        resolutionOptions,
        announce             : {
          beaconId     : options.beaconId,
          publishToCas : options.publishToCas,
          ...broadcastOptions,
        },
      },
    },
  };
}

/**
 * Resolves the signing key of a write (ADR 133): `--signing-key`, else the
 * signing key of the identifier record, else the profile `identity.default`,
 * else the active key. Refuses a record key that the keystore does not hold:
 * a fallback to another key would sign with a key that the DID document does
 * not name.
 */
function resolveSigningKey(
  api        : DidBtcr2Api,
  explicit   : string | undefined,
  recordKey  : string | undefined,
  identifier : string,
  g          : GlobalOptions,
): string {
  if (blankToUndef(explicit) === undefined && recordKey !== undefined) {
    if (!api.kms.kms.listKeys().includes(recordKey)) {
      throw new CLIError(
        `The record of ${identifier} names the signing key ${recordKey}, but the keystore does not hold it. `
          + 'Use --signing-key <ref> to select a key. '
          + `Use "btcr2 identifier add ${identifier} -k <ref>" to change the key of the record.`,
        'INVALID_ARGUMENT_ERROR',
        { identifier, keyId: recordKey },
      );
    }
    return recordKey;
  }
  return resolveKeyRef(api.kms.kms, resolveDefaultKeyRef(explicit, g));
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

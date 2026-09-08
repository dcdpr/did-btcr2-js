import type { IdentifierReport } from '@did-btcr2/api';
import { Identifier } from '@did-btcr2/api';
import { bytesToHex, hexToBytes } from '@noble/hashes/utils.js';
import type { Command } from 'commander';
import { readFile } from 'node:fs/promises';
import type { ApiFactory } from '../config.js';
import { CLIError } from '../error.js';
import { formatResult } from '../output.js';
import type { CommandResult, GlobalOptions, IdentifierDecodeData } from '../types.js';

/**
 * Registers the `identifier` command group. `decode` prints the components of
 * a did:btcr2 identifier. `validate` checks that an identifier conforms to the
 * specification and prints a report. Both commands are offline and
 * keystore-free: they use the api with no Bitcoin connection, no CAS, and no
 * key material.
 */
export function registerIdentifierCommand(
  program : Command,
  factory : ApiFactory,
  globals : () => GlobalOptions,
): void {
  const identifier = program
    .command('identifier')
    .description('Decode and validate did:btcr2 identifiers (offline).');
  const print = (result: CommandResult): void => console.log(formatResult(result, globals()));

  identifier
    .command('decode <did>')
    .description('Print the components of a did:btcr2 identifier.')
    .option(
      '--initial-document',
      'Add the initial DID document. An external identifier (x) needs --genesis-document.',
      false,
    )
    .option(
      '--genesis-document <path>',
      'Path to the JSON genesis document of an external identifier (x). Requires --initial-document.',
    )
    .action(async (did: string, options: { initialDocument?: boolean; genesisDocument?: string }) => {
      if (options.genesisDocument !== undefined && !options.initialDocument) {
        throw new CLIError('--genesis-document requires --initial-document.', 'INVALID_ARGUMENT_ERROR');
      }
      assertValidIdentifier(did);
      const api = factory();
      const components = api.did.decode(did);
      if (options.genesisDocument !== undefined && components.hrp === 'k') {
        throw new CLIError(
          '--genesis-document applies only to external identifiers (x).',
          'INVALID_ARGUMENT_ERROR',
          { did },
        );
      }
      const data: IdentifierDecodeData = {
        did,
        idType       : components.idType,
        hrp          : components.hrp,
        version      : components.version,
        network      : components.network,
        genesisBytes : bytesToHex(components.genesisBytes),
      };
      if (options.initialDocument) {
        if (components.hrp === 'x' && options.genesisDocument === undefined) {
          throw new CLIError(
            'An external identifier (x) needs --genesis-document <path> for --initial-document.',
            'INVALID_ARGUMENT_ERROR',
            { did },
          );
        }
        const genesisDocument = options.genesisDocument === undefined
          ? undefined
          : await readGenesisDocument(options.genesisDocument);
        data.initialDocument = api.btcr2.getInitialDocument(did, genesisDocument);
      }
      print({ action: 'identifier-decode', data });
    });

  identifier
    .command('validate <did>')
    .description('Check that a did:btcr2 identifier conforms to the specification. Exit code 1 if it does not.')
    .option(
      '-b, --bytes <hex>',
      'Genesis bytes as a hex string that the identifier must encode: the 33-byte public key (k) '
      + 'or the 32-byte genesis document hash (x). Adds the genesisBytesMatch check.',
    )
    .option(
      '--genesis-document <path>',
      'Path to the JSON genesis document of an external identifier (x). Adds the genesisDocument check.',
    )
    .action(async (did: string, options: { bytes?: string; genesisDocument?: string }) => {
      const genesisBytes = options.bytes === undefined ? undefined : parseHexBytes(options.bytes);
      let genesisDocument: object | undefined;
      if (options.genesisDocument !== undefined) {
        // Refuse the flag for a KEY identifier before the file read. An invalid
        // identifier passes through: the report names its failed check.
        if (Identifier.isValid(did) && Identifier.decode(did).hrp === 'k') {
          throw new CLIError(
            '--genesis-document applies only to external identifiers (x).',
            'INVALID_ARGUMENT_ERROR',
            { did },
          );
        }
        genesisDocument = await readGenesisDocument(options.genesisDocument);
      }
      const report: IdentifierReport = factory().did.validate(did, { genesisBytes, genesisDocument });
      print({ action: 'identifier-validate', data: report });
      if (!report.valid) process.exitCode = 1;
    });
}

/**
 * Throws a `CLIError` that names the failed check if the identifier is not
 * valid. The Bech32m decoder alone throws a raw error with a stack; this
 * guard gives `decode` one message shape for every failure.
 */
function assertValidIdentifier(did: string): void {
  const report = Identifier.validate(did);
  if (report.valid) return;
  const failed = report.checks[report.checks.length - 1];
  throw new CLIError(
    `Invalid identifier (${failed.name} check): ${failed.detail ?? 'failed'}`,
    'INVALID_ARGUMENT_ERROR',
    { did, check: failed.name },
  );
}

/** Parses the `--bytes` hex string. The length is a validation result, not an argument error. */
function parseHexBytes(value: string): Uint8Array {
  try {
    return hexToBytes(value.trim());
  } catch {
    throw new CLIError('Invalid bytes: not valid hex.', 'INVALID_ARGUMENT_ERROR', { bytes: value });
  }
}

/** Reads and parses the genesis document file. The content must be a JSON object. */
async function readGenesisDocument(path: string): Promise<object> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(await readFile(path, 'utf-8'));
  } catch {
    throw new CLIError(
      'Invalid genesis document path. Must be a valid path to a JSON file.',
      'INVALID_ARGUMENT_ERROR',
      { genesisDocument: path },
    );
  }
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new CLIError(
      'Invalid genesis document. The file must contain a JSON object.',
      'INVALID_ARGUMENT_ERROR',
      { genesisDocument: path },
    );
  }
  return parsed;
}

import type { IdentifierCheck, IdentifierReport } from '@did-btcr2/api';
import { DidApi } from '@did-btcr2/api';
import { bytesToHex, hexToBytes } from '@noble/hashes/utils.js';
import type { Command } from 'commander';
import { writeFileSync } from 'node:fs';
import { assertSupportedNetwork, deriveNetwork, type ApiFactory } from '../config.js';
import { CLIError } from '../error.js';
import { readGenesisDocumentFile } from '../genesis-document-file.js';
import { describeRecord, IdentifierRecords, summarizeRecord } from '../identifier-records.js';
import { resolveKeyRef } from '../keystore/resolve-key-ref.js';
import { formatCheckResult, formatResult } from '../output.js';
import { readSidecarFile } from '../sidecar-file.js';
import type { CommandResult, GlobalOptions, IdentifierDecodeData } from '../types.js';

/** The offline identifier operations of the api. They need no connection and no key. */
const didApi = new DidApi();

/**
 * Registers the `identifier` command group. `decode` prints the components of
 * a did:btcr2 identifier. `validate` checks that an identifier conforms to the
 * specification and prints a report (`OK` or the failed check under `--quiet`).
 * Both commands are offline and keystore-free: they use the api with no Bitcoin
 * connection, no CAS, and no key material.
 *
 * `list`, `show`, `add`, `remove`, and `sidecar` manage the identifier records
 * in `<home>/dids.json` (ADR 133). They are offline. `add` and `list --key`
 * read the public keys of the keystore, which never prompts.
 */
export function registerIdentifierCommand(
  program         : Command,
  factory         : ApiFactory,
  keystoreFactory : ApiFactory,
  globals         : () => GlobalOptions,
): void {
  const identifier = program
    .command('identifier')
    .description('Decode and validate did:btcr2 identifiers, and manage the identifier records (offline).');
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
          : await readGenesisDocumentFile(options.genesisDocument);
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
        if (didApi.isValid(did) && didApi.decode(did).hrp === 'k') {
          throw new CLIError(
            '--genesis-document applies only to external identifiers (x).',
            'INVALID_ARGUMENT_ERROR',
            { did },
          );
        }
        genesisDocument = await readGenesisDocumentFile(options.genesisDocument);
      }
      const report: IdentifierReport = factory().did.validate(did, { genesisBytes, genesisDocument });
      // Text mode prints the full report. `-q/--quiet` prints OK, or the failed
      // check (ADR 130).
      const failures = report.checks.filter(check => !check.ok).map(failedCheckMessage);
      console.log(formatCheckResult({ action: 'identifier-validate', data: report }, globals(), failures));
      if (!report.valid) process.exitCode = 1;
    });

  identifier
    .command('list')
    .alias('ls')
    .description('List the identifier records.')
    .option('-n, --network <network>', 'List only the identifiers of this network.')
    .option('-k, --key <ref>', 'List only the identifiers whose record holds this key: a URN, fingerprint prefix, or name.')
    .action((options: { network?: string; key?: string }) => {
      const g = globals();
      const network = options.network === undefined ? undefined : assertSupportedNetwork(options.network);
      const keyId = options.key === undefined ? undefined : keyIdOf(keystoreFactory, g, options.key);
      const data = IdentifierRecords.forHome(g).list()
        .map(([did, record]) => summarizeRecord(did, record))
        .filter(entry => network === undefined || entry.network === network)
        .filter(entry => keyId === undefined || entry.keys.includes(keyId));
      print({ action: 'identifier-list', data });
    });

  identifier
    .command('show <ref>')
    .description('Show the record of an identifier: the name, the keys, the transactions, and the sidecar data. '
      + 'The reference is the identifier or the name of its record.')
    .action((ref: string) => {
      const records = IdentifierRecords.forHome(globals());
      const did = records.resolveRef(ref);
      const record = records.get(did);
      if (record === undefined) {
        throw new CLIError(
          `No identifier record for ${did}. Use "btcr2 identifier add ${did}" to add one.`,
          'INVALID_ARGUMENT_ERROR',
          { did },
        );
      }
      print({ action: 'identifier-show', data: describeRecord(did, record) });
    });

  identifier
    .command('add <ref>')
    .description('Add an identifier to the records, or add data to its record. '
      + 'The reference is the identifier or the name of its record.')
    .option('--name <name>', 'A unique name for the record. Other commands accept the name in place of the identifier.')
    .option(
      '-k, --key <ref>',
      'A stored key that signs the next update or message of the identifier: a URN, fingerprint prefix, or name. '
      + 'For a new record of a KEY identifier (k), the default is the stored key of the genesis bytes.',
    )
    .option(
      '--sidecar <path>',
      'Path to a JSON file with sidecar data (genesisDocument, updates, casUpdates, smtProofs), '
      + 'as "identifier sidecar" prints it. The CLI adds each new entry to the record.',
    )
    .action((ref: string, options: { name?: string; key?: string; sidecar?: string }) => {
      const g = globals();
      const records = IdentifierRecords.forHome(g);
      const did = records.resolveRef(ref);
      assertValidIdentifier(did);
      deriveNetwork(did);
      if (options.name !== undefined) records.assertNameAvailable(options.name, did);
      const sidecar = options.sidecar === undefined ? undefined : readSidecarFile(options.sidecar);
      let signingKey: string | undefined;
      if (options.key !== undefined) {
        signingKey = keyIdOf(keystoreFactory, g, options.key);
      } else if (!records.get(did)?.keys.length) {
        signingKey = genesisKeyOf(keystoreFactory, g, did);
      }
      const record = records.record(did, {
        ...(options.name !== undefined && { name: options.name }),
        ...(signingKey !== undefined && { signingKey }),
        ...(sidecar !== undefined && { sidecar }),
      });
      print({ action: 'identifier-add', data: describeRecord(did, record) });
    });

  identifier
    .command('remove <ref>')
    .alias('rm')
    .description('Remove the record of an identifier. The keys stay in the keystore. '
      + 'The reference is the identifier or the name of its record.')
    .action((ref: string) => {
      const records = IdentifierRecords.forHome(globals());
      const did = records.resolveRef(ref);
      if (!records.remove(did)) {
        throw new CLIError(`No identifier record for ${did}.`, 'INVALID_ARGUMENT_ERROR', { did });
      }
      print({ action: 'identifier-remove', data: { identifier: did, removed: true } });
    });

  identifier
    .command('sidecar <ref>')
    .description('Print the sidecar data of an identifier record, for a resolver or for "identifier add --sidecar". '
      + 'The reference is the identifier or the name of its record.')
    .option('--out <path>', 'Write the sidecar data to this new file (created 0600) and print the path.')
    .action((ref: string, options: { out?: string }) => {
      const records = IdentifierRecords.forHome(globals());
      const did = records.resolveRef(ref);
      const record = records.get(did);
      if (record === undefined) {
        throw new CLIError(`No identifier record for ${did}.`, 'INVALID_ARGUMENT_ERROR', { did });
      }
      if (options.out === undefined) {
        print({ action: 'identifier-sidecar', data: record.sidecar });
        return;
      }
      try {
        writeFileSync(options.out, `${JSON.stringify(record.sidecar, null, 2)}\n`, { flag: 'wx', mode: 0o600 });
      } catch (error) {
        if ((error as { code?: string }).code === 'EEXIST') {
          throw new CLIError(
            `The file ${options.out} exists. Choose a new --out path.`,
            'INVALID_ARGUMENT_ERROR',
            { path: options.out },
          );
        }
        throw error;
      }
      print({ action: 'identifier-sidecar', data: { identifier: did, path: options.out } });
    });
}

/** The key URN of a key reference. Reads the public keys of the keystore only. */
function keyIdOf(keystoreFactory: ApiFactory, g: GlobalOptions, ref: string): string {
  if (ref.trim() === '') {
    throw new CLIError('--key must not be empty.', 'INVALID_ARGUMENT_ERROR');
  }
  return resolveKeyRef(keystoreFactory(undefined, g).kms.kms, ref);
}

/**
 * The stored key whose public key is the genesis bytes of a KEY identifier (k),
 * or `undefined`. An external identifier (x) has no genesis key.
 */
function genesisKeyOf(keystoreFactory: ApiFactory, g: GlobalOptions, did: string): string | undefined {
  const { hrp, genesisBytes } = didApi.decode(did);
  if (hrp !== 'k') return undefined;
  const kms = keystoreFactory(undefined, g).kms;
  const genesisHex = bytesToHex(genesisBytes);
  return kms.kms.listKeys().find(keyId => bytesToHex(kms.getPublicKey(keyId)) === genesisHex);
}

/**
 * Throws a `CLIError` that names the failed check if the identifier is not
 * valid. The Bech32m decoder alone throws a raw error with a stack; this
 * guard gives `decode` one message shape for every failure.
 */
function assertValidIdentifier(did: string): void {
  const report = didApi.validate(did);
  if (report.valid) return;
  const failed = report.checks[report.checks.length - 1];
  throw new CLIError(failedCheckMessage(failed), 'INVALID_ARGUMENT_ERROR', { did, check: failed.name });
}

/** The one-line message of a failed identifier check. */
function failedCheckMessage(check: IdentifierCheck): string {
  return `Invalid identifier (${check.name} check): ${check.detail ?? 'failed'}`;
}

/** Parses the `--bytes` hex string. The length is a validation result, not an argument error. */
function parseHexBytes(value: string): Uint8Array {
  try {
    return hexToBytes(value.trim());
  } catch {
    throw new CLIError('Invalid bytes: not valid hex.', 'INVALID_ARGUMENT_ERROR', { bytes: value });
  }
}

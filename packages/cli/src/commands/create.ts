import { bytesToHex, hexToBytes } from '@noble/hashes/utils.js';
import type { Command } from 'commander';
import type { ApiFactory } from '../config.js';
import { assertKeystoreAllowedForNetwork, resolveDefaultKeyRef } from '../config.js';
import { CLIError } from '../error.js';
import { readGenesisDocumentFile } from '../genesis-document-file.js';
import { printBeaconFundingHint, printCreateFundingHint } from '../hints.js';
import { IdentifierRecords, recordAfterWork, type RecordChange } from '../identifier-records.js';
import { resolveKeyRef } from '../keystore/resolve-key-ref.js';
import { NETWORK_OPTION_HELP, overridesFromGlobals, resolveNetworkOption, warnProfileNetworkMismatch } from '../network-option.js';
import { formatResult } from '../output.js';
import type { CommandResult, GlobalOptions } from '../types.js';

/** Expected byte length per identifier type: compressed secp256k1 = 33, SHA-256 hash = 32. */
const EXPECTED_BYTES: Record<'k' | 'x', { length: number; label: string }> = {
  k : { length: 33, label: 'secp256k1 compressed public key (33 bytes)' },
  x : { length: 32, label: 'SHA-256 hash (32 bytes)' },
};

/**
 * Registers the `create` command.
 *
 * A deterministic (`-t k`) identifier has three input modes:
 * - raw (`--bytes <hex>`): a 33-byte public key as hex. Offline, keystore-free.
 * - stored key: the public key of a stored key becomes the genesis bytes. The
 *   key is `--key <ref>`, else the profile `identity.default`, else the active
 *   key, the same chain that `update` and `deactivate` sign with. Reading a
 *   public key never decrypts, so this never prompts.
 * - generate (no `--bytes` and no key from that chain): mint a fresh key,
 *   persist it to the keystore, set it active, and print the identifier.
 *   Sealing the secret prompts for the keystore passphrase.
 *
 * An external (`-t x`) identifier has two input modes: the genesis document
 * file (`--document <path>`), which the api hashes, or the 32-byte hash as
 * hex (`--bytes`). Generation and `--key` apply only to `-t k`.
 *
 * The keystore-free `factory` serves the raw-bytes and document paths; the
 * keystore-aware `keystoreFactory` serves the generate and existing-key paths.
 *
 * Each mode records the identifier in `<home>/dids.json` (ADR 133): the name of
 * `--name`, the key of a stored or generated key, and the genesis document of
 * `--document`. A name that another identifier has is refused before any work.
 */
export function registerCreateCommand(
  program         : Command,
  factory         : ApiFactory,
  keystoreFactory : ApiFactory,
  globals         : () => GlobalOptions,
): void {
  program
    .command('create')
    .description('Create an identifier and initial DID document')
    .option('-t, --type <type>', 'Identifier type <k|x>', 'k')
    .option('-n, --network <network>', NETWORK_OPTION_HELP)
    .option(
      '-k, --key <ref>',
      'For type=k, a stored key whose public key the identifier encodes: a URN, fingerprint prefix, or name '
      + '(default: the profile identity.default, else the active key, else a new key). Exclusive with --bytes.'
    )
    .option(
      '-b, --bytes <bytes>',
      'Genesis bytes as a hex string. '
      + 'For type=k, a 33-byte secp256k1 public key. '
      + 'For type=x, the 32-byte SHA-256 hash of a genesis document.'
    )
    .option(
      '--document <path>',
      'For type=x, the path of the JSON genesis document to hash (see "btcr2 genesis build"). '
      + 'Exclusive with --bytes.'
    )
    .option('--name <name>', 'A unique name for the identifier record. Other commands accept the name in place of the identifier.')
    .action(async (options: { type: string; network?: string; key?: string; bytes?: string; document?: string; name?: string }) => {
      const g = globals();
      if (options.type !== 'k' && options.type !== 'x') {
        throw new CLIError('Invalid type. Must be "k" or "x".', 'INVALID_ARGUMENT_ERROR', options);
      }
      if (options.key !== undefined && options.key.trim() === '') {
        throw new CLIError('--key must not be empty.', 'INVALID_ARGUMENT_ERROR');
      }

      const overrides = overridesFromGlobals(g);
      const network = resolveNetworkOption(options.network, overrides);
      warnProfileNetworkMismatch(g, network, overrides);

      const records = IdentifierRecords.forHome(g);
      const name = options.name;
      // Refuses a name that another identifier has, before any work.
      const checkName = (did?: string): void => {
        if (name !== undefined) records.assertNameAvailable(name, did);
      };
      const record = (did: string, change: RecordChange = {}): void => {
        recordAfterWork(records, did, { ...(name !== undefined && { name }), ...change });
      };

      // Text mode prints the identifier only. `--verbose` adds the key note and
      // the funding hint on stderr. JSON mode prints the full envelope (ADR 130).
      const print = (result: CommandResult, note?: string): void => {
        console.log(formatResult(result, g));
        if (note && g.verbose && g.output !== 'json') process.stderr.write(`${note}\n`);
      };
      const fundingHint = (did: string): void => {
        if (g.verbose) printCreateFundingHint(g, network, did);
      };

      // External: the genesis document file, or its hash as raw bytes.
      if (options.type === 'x') {
        if (options.key !== undefined) {
          throw new CLIError(
            '--key applies only to deterministic identifiers (-t k).',
            'INVALID_ARGUMENT_ERROR',
          );
        }
        if (options.bytes !== undefined && options.document !== undefined) {
          throw new CLIError('Provide at most one of --bytes or --document.', 'INVALID_ARGUMENT_ERROR');
        }
        if (options.document !== undefined) {
          const genesisDocument = await readGenesisDocumentFile(options.document);
          const api = factory();
          const { did, genesisBytes, didDocument } = api.btcr2.createExternalFromDocument(genesisDocument, { network });
          checkName(did);
          print({ action: 'create', data: did, genesisBytes: bytesToHex(genesisBytes) });
          record(did, { sidecar: { genesisDocument } });
          const beacons = api.btcr2.getBeacons(didDocument);
          if (g.verbose && beacons.length > 0) printBeaconFundingHint(g, network, beacons[0].address);
          return;
        }
        if (options.bytes === undefined) {
          throw new CLIError(
            'External identifiers (-t x) require --document <path>, the genesis document, '
            + 'or --bytes <hex>, its 32-byte hash. Key generation is only available for -t k.',
            'INVALID_ARGUMENT_ERROR',
          );
        }
        const genesisBytes = parseGenesisBytes(options.bytes, 'x');
        const did = factory().createDid('external', genesisBytes, { network });
        checkName(did);
        print({ action: 'create', data: did });
        record(did);
        return;
      }

      if (options.document !== undefined) {
        throw new CLIError('--document applies only to external identifiers (-t x).', 'INVALID_ARGUMENT_ERROR');
      }

      // Deterministic (KEY): three mutually-exclusive modes.
      if (options.bytes !== undefined && options.key !== undefined) {
        throw new CLIError(
          'Provide at most one of --bytes or --key.',
          'INVALID_ARGUMENT_ERROR',
        );
      }

      // Raw bytes: keystore-free, offline.
      if (options.bytes !== undefined) {
        const genesisBytes = parseGenesisBytes(options.bytes, 'k');
        const did = factory().createDid('deterministic', genesisBytes, { network });
        checkName(did);
        print({ action: 'create', data: did });
        record(did);
        fundingHint(did);
        return;
      }

      // Stored key: --key, else identity.default, else the active key. Reading a
      // public key never prompts for the passphrase.
      const api = keystoreFactory(undefined, overrides);
      const ref = resolveDefaultKeyRef(options.key, overrides);
      if (ref !== undefined || api.kms.kms.activeKeyId !== undefined) {
        const keyId = resolveKeyRef(api.kms.kms, ref);
        const publicKey = api.kms.getPublicKey(keyId);
        const did = api.createDid('deterministic', publicKey, { network });
        checkName(did);
        print(
          { action: 'create', data: did, keyId, publicKey: bytesToHex(publicKey) },
          `Using stored key ${keyId}.`,
        );
        record(did, { signingKey: keyId });
        fundingHint(did);
        return;
      }

      // Generate: no key to use, so mint a fresh key, persist it, and set it active
      // (passphrase prompt). Refuse to seal a fresh mainnet key into an unencrypted
      // dev keystore (ADR 080).
      assertKeystoreAllowedForNetwork(network, overrides);
      checkName();
      const { did, keyId } = api.generateDid({ network, setActive: true });
      const publicKey = bytesToHex(api.kms.getPublicKey(keyId));
      print(
        { action: 'create', data: did, keyId, publicKey },
        `Generated and stored key ${keyId} (now the active key).`,
      );
      record(did, { signingKey: keyId });
      fundingHint(did);
    });
}

/** Parses and length-checks hex genesis bytes for the given identifier type. */
function parseGenesisBytes(hex: string, type: 'k' | 'x'): Uint8Array {
  const expected = EXPECTED_BYTES[type];
  let bytes: Uint8Array;
  try {
    bytes = hexToBytes(hex.trim());
  } catch {
    throw new CLIError(
      `Invalid bytes: not valid hex. Expected ${expected.label}.`,
      'INVALID_ARGUMENT_ERROR',
      { bytes: hex },
    );
  }
  if (bytes.length !== expected.length) {
    throw new CLIError(
      `Invalid bytes length for type="${type}": expected ${expected.label}, got ${bytes.length} bytes.`,
      'INVALID_ARGUMENT_ERROR',
      { bytes: hex },
    );
  }
  return bytes;
}

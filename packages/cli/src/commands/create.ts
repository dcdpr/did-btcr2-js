import { bytesToHex, hexToBytes } from '@noble/hashes/utils.js';
import type { Command } from 'commander';
import type { ApiFactory, ConnectionOverrides } from '../config.js';
import { assertKeystoreAllowedForNetwork, profileNetworkMismatch, resolveDefaultNetwork } from '../config.js';
import { CLIError } from '../error.js';
import { resolveKeyRef } from '../keystore/resolve-key-ref.js';
import { formatResult } from '../output.js';
import type { CommandResult, GlobalOptions, NetworkOption } from '../types.js';
import { SUPPORTED_NETWORKS } from '../types.js';

/** Expected byte length per identifier type: compressed secp256k1 = 33, SHA-256 hash = 32. */
const EXPECTED_BYTES: Record<'k' | 'x', { length: number; label: string }> = {
  k : { length: 33, label: 'secp256k1 compressed public key (33 bytes)' },
  x : { length: 32, label: 'SHA-256 hash (32 bytes)' },
};

/**
 * Registers the `create` command.
 *
 * A deterministic (`-t k`) identifier has three mutually-exclusive input modes,
 * selected by which is present:
 * - generate (neither `--bytes` nor `--signing-key`): mint a fresh key, persist
 *   it to the keystore, set it active, and print the identifier. Sealing the
 *   secret prompts for the keystore passphrase.
 * - existing (`--signing-key <ref>`): use a stored key's public key as the
 *   genesis bytes. Reading a public key never decrypts, so this never prompts.
 * - raw (`--bytes <hex>`): a 33-byte public key as hex. Offline, keystore-free.
 *
 * An external (`-t x`) identifier is raw-bytes-only: a 32-byte genesis-document
 * hash via `--bytes`. Generation and `--signing-key` apply only to `-t k`.
 *
 * The keystore-free `factory` serves the raw-bytes path; the keystore-aware
 * `keystoreFactory` serves the generate and existing-key paths.
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
    .option(
      '-n, --network <network>',
      'Identifier bitcoin network <bitcoin|testnet3|testnet4|signet|mutinynet|regtest> '
      + '(default: config defaults.network, else regtest)'
    )
    .option(
      '-b, --bytes <bytes>',
      'Genesis bytes as a hex string. '
      + 'For type=k, a 33-byte secp256k1 public key (omit to generate a key). '
      + 'For type=x, the 32-byte SHA-256 hash of a genesis document.'
    )
    .action(async (options: { type: string; network?: string; bytes?: string }) => {
      const g = globals();
      if (options.type !== 'k' && options.type !== 'x') {
        throw new CLIError('Invalid type. Must be "k" or "x".', 'INVALID_ARGUMENT_ERROR', options);
      }

      const overrides = overridesFromGlobals(g);
      const network = resolveNetwork(options.network, overrides);
      const signingKey = g.signingKey;

      // Warn (never block) when the network being encoded disagrees with the
      // active profile's declared network, so a `production` profile holding
      // mainnet endpoints cannot silently mint a regtest DID.
      const mismatch = profileNetworkMismatch(network, overrides);
      if (mismatch && !g.quiet) {
        process.stderr.write(
          `Warning: creating a "${network}" identifier while the active profile `
          + `"${mismatch.profile}" declares network "${mismatch.declared}". The `
          + 'identifier\'s network and the profile\'s endpoints may not match.\n'
        );
      }

      /** Prints the result, plus a stderr provenance line in text mode. */
      const print = (result: CommandResult, note?: string): void => {
        console.log(formatResult(result, g));
        if (note && g.output !== 'json') process.stderr.write(`${note}\n`);
      };

      // External: raw-bytes only.
      if (options.type === 'x') {
        if (signingKey) {
          throw new CLIError(
            '--signing-key applies only to deterministic identifiers (-t k).',
            'INVALID_ARGUMENT_ERROR',
          );
        }
        if (options.bytes === undefined) {
          throw new CLIError(
            'External identifiers (-t x) require --bytes <hex>, the 32-byte genesis document hash. '
            + 'Key generation is only available for -t k.',
            'INVALID_ARGUMENT_ERROR',
          );
        }
        const genesisBytes = parseGenesisBytes(options.bytes, 'x');
        const did = factory().createDid('external', genesisBytes, { network });
        print({ action: 'create', data: did });
        return;
      }

      // Deterministic (KEY): three mutually-exclusive modes.
      if (options.bytes !== undefined && signingKey) {
        throw new CLIError(
          'Provide at most one of --bytes or --signing-key.',
          'INVALID_ARGUMENT_ERROR',
        );
      }

      // Raw bytes: keystore-free, offline.
      if (options.bytes !== undefined) {
        const genesisBytes = parseGenesisBytes(options.bytes, 'k');
        const did = factory().createDid('deterministic', genesisBytes, { network });
        print({ action: 'create', data: did });
        return;
      }

      // Existing key: read its public key from the keystore (no passphrase prompt).
      if (signingKey) {
        const api = keystoreFactory(undefined, overrides);
        const keyId = resolveKeyRef(api.kms.kms, signingKey);
        const publicKey = api.kms.getPublicKey(keyId);
        const did = api.createDid('deterministic', publicKey, { network });
        print(
          { action: 'create', data: did, keyId, publicKey: bytesToHex(publicKey) },
          `Using stored key ${keyId}.`,
        );
        return;
      }

      // Generate: mint a fresh key, persist it, and set it active (passphrase prompt).
      // Refuse to seal a fresh mainnet key into an unencrypted dev keystore (ADR 080).
      assertKeystoreAllowedForNetwork(network, overrides);
      const api = keystoreFactory(undefined, overrides);
      const { did, keyId } = api.generateDid({ network, setActive: true });
      const publicKey = bytesToHex(api.kms.getPublicKey(keyId));
      print(
        { action: 'create', data: did, keyId, publicKey },
        `Generated and stored key ${keyId} (now the active key).`,
      );
    });
}

/** Builds the keystore- and config-resolution overrides from the global flags. */
function overridesFromGlobals(g: GlobalOptions): ConnectionOverrides {
  return {
    home           : g.home,
    config         : g.config,
    profile        : g.profile,
    keystore       : g.keystore,
    passphraseFile : g.passphraseFile,
  };
}

/** Validates an explicit `--network`, or resolves the default from configuration. */
function resolveNetwork(explicit: string | undefined, overrides: ConnectionOverrides): NetworkOption {
  if (!explicit) return resolveDefaultNetwork(overrides);
  if (!SUPPORTED_NETWORKS.includes(explicit as NetworkOption)) {
    throw new CLIError(
      'Invalid network. Must be one of "bitcoin", "testnet3", "testnet4", "signet", "mutinynet", or "regtest".',
      'INVALID_ARGUMENT_ERROR',
      { network: explicit },
    );
  }
  return explicit as NetworkOption;
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

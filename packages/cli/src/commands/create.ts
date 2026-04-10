import type { Command } from 'commander';
import type { ApiFactory } from '../config.js';
import { CLIError } from '../error.js';
import { formatResult } from '../output.js';
import type {
  CreateCommandOptions,
  GlobalOptions,
  NetworkOption} from '../types.js';
import {
  SUPPORTED_NETWORKS,
} from '../types.js';

/** Expected byte length per identifier type: compressed secp256k1 = 33, SHA-256 hash = 32. */
const EXPECTED_BYTES: Record<'k' | 'x', { length: number; label: string }> = {
  k : { length: 33, label: 'secp256k1 compressed public key (33 bytes)' },
  x : { length: 32, label: 'SHA-256 hash (32 bytes)' },
};

export function registerCreateCommand(
  program : Command,
  factory : ApiFactory,
  globals : () => GlobalOptions,
): void {
  program
    .command('create')
    .description('Create an identifier and initial DID document')
    .requiredOption('-t, --type <type>', 'Identifier type <k|x>', 'k')
    .requiredOption(
      '-n, --network <network>',
      'Identifier bitcoin network <bitcoin|testnet3|testnet4|signet|mutinynet|regtest>'
    )
    .requiredOption(
      '-b, --bytes <bytes>',
      'Genesis bytes as a hex string. ' +
      'If type=k, MUST be secp256k1 public key. ' +
      'If type=x, MUST be SHA-256 hash of a genesis document'
    )
    .action(async (options: { type: string; network: string; bytes: string }) => {
      const parsed = validateCreateOptions(options);
      const api = factory();
      const type = parsed.type === 'k' ? 'deterministic' : 'external';
      const genesisBytes = Buffer.from(parsed.bytes, 'hex');
      const data = api.createDid(type, genesisBytes, { network: parsed.network });
      const result = { action: 'create' as const, data };
      console.log(formatResult(result, globals()));
    });
}

function validateCreateOptions(
  options: { type: string; network: string; bytes: string }
): CreateCommandOptions {
  if (!['k', 'x'].includes(options.type)) {
    throw new CLIError(
      'Invalid type. Must be "k" or "x".',
      'INVALID_ARGUMENT_ERROR',
      options
    );
  }
  if (!SUPPORTED_NETWORKS.includes(options.network as NetworkOption)) {
    throw new CLIError(
      'Invalid network. Must be one of "bitcoin", "testnet3", "testnet4", "signet", "mutinynet", or "regtest".',
      'INVALID_ARGUMENT_ERROR',
      options
    );
  }

  const buf = Buffer.from(options.bytes, 'hex');
  if (buf.length === 0) {
    throw new CLIError(
      'Invalid bytes. Must be a non-empty hex string.',
      'INVALID_ARGUMENT_ERROR',
      options
    );
  }
  const expected = EXPECTED_BYTES[options.type as 'k' | 'x'];
  if (buf.length !== expected.length) {
    throw new CLIError(
      `Invalid bytes length for type="${options.type}": expected ${expected.label}, got ${buf.length} bytes.`,
      'INVALID_ARGUMENT_ERROR',
      options
    );
  }

  return {
    type    : options.type as 'k' | 'x',
    network : options.network as NetworkOption,
    bytes   : options.bytes,
  };
}

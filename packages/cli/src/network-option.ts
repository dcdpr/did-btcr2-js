import type { ConnectionOverrides } from './config.js';
import { profileNetworkMismatch, resolveDefaultNetwork } from './config.js';
import { CLIError } from './error.js';
import type { GlobalOptions, NetworkOption } from './types.js';
import { SUPPORTED_NETWORKS } from './types.js';

/** The help text of `-n, --network` on the offline creation commands. */
export const NETWORK_OPTION_HELP =
  'Identifier bitcoin network <bitcoin|testnet3|testnet4|signet|mutinynet|regtest> '
  + '(default: config defaults.network, else regtest)';

/** Builds the keystore- and config-resolution overrides from the global flags. */
export function overridesFromGlobals(g: GlobalOptions): ConnectionOverrides {
  return {
    home           : g.home,
    config         : g.config,
    profile        : g.profile,
    keystore       : g.keystore,
    passphraseFile : g.passphraseFile,
  };
}

/** Validates an explicit `--network`, or resolves the default from configuration. */
export function resolveNetworkOption(explicit: string | undefined, overrides: ConnectionOverrides): NetworkOption {
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

/**
 * Warns on stderr, and never blocks, when the network of a new identifier
 * disagrees with the network that the active profile declares. A `production`
 * profile that holds mainnet endpoints must not mint a regtest DID in silence.
 */
export function warnProfileNetworkMismatch(g: GlobalOptions, network: NetworkOption, overrides: ConnectionOverrides): void {
  const mismatch = profileNetworkMismatch(network, overrides);
  if (mismatch && !g.quiet) {
    process.stderr.write(
      `Warning: creating a "${network}" identifier while the active profile `
      + `"${mismatch.profile}" declares network "${mismatch.declared}". The `
      + 'identifier\'s network and the profile\'s endpoints may not match.\n'
    );
  }
}

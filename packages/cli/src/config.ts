import { createApi, Identifier, type BitcoinApiConfig, type DidBtcr2Api } from '@did-btcr2/api';
import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { CLIError } from './error.js';
import { SUPPORTED_NETWORKS, type NetworkOption } from './types.js';

/**
 * Endpoint overrides provided via CLI flags, env vars, or config file.
 * These override the per-network defaults from
 * `DEFAULT_BITCOIN_NETWORK_CONFIG`.
 *
 * `config` and `profile` control config-file resolution and are only
 * meaningful when passed through the full merge chain.
 */
export type ConnectionOverrides = {
  btcRest?   : string;
  btcRpcUrl? : string;
  btcRpcUser?: string;
  btcRpcPass?: string;
  casGateway?: string;
  config?    : string;
  profile?   : string;
};

/**
 * On-disk config file schema.
 *
 * @example
 * ```json
 * {
 *   "profiles": {
 *     "regtest": {
 *       "btc": {
 *         "rest": "http://localhost:3000",
 *         "rpcUrl": "http://localhost:18443",
 *         "rpcUser": "polaruser",
 *         "rpcPass": "polarpass"
 *       }
 *     },
 *     "bitcoin": {
 *       "btc": { "rest": "https://my-mempool/api" },
 *       "cas": { "gateway": "https://ipfs.io" }
 *     }
 *   }
 * }
 * ```
 */
export type ConfigFile = {
  profiles?: Record<string, {
    btc?: {
      rest?    : string;
      rpcUrl?  : string;
      rpcUser? : string;
      rpcPass? : string;
    };
    cas?: {
      gateway?: string;
    };
  }>;
};

/**
 * Factory function that creates a configured {@link DidBtcr2Api} instance.
 *
 * When `network` is provided, the returned API is wired to that network's
 * default Bitcoin endpoints (mempool.space for public networks, localhost
 * Polar for regtest). Optional `overrides` let callers replace individual
 * endpoints on top of the defaults. When `network` is omitted, no Bitcoin
 * or CAS is configured — suitable for offline operations like `create`.
 */
export type ApiFactory = (network?: NetworkOption, overrides?: ConnectionOverrides) => DidBtcr2Api;

/**
 * Environment variable names consulted by {@link defaultApiFactory}.
 *
 * | Variable              | Equivalent flag    |
 * |-----------------------|--------------------|
 * | `BTCR2_BTC_REST`      | `--btc-rest`       |
 * | `BTCR2_BTC_RPC_URL`   | `--btc-rpc-url`    |
 * | `BTCR2_BTC_RPC_USER`  | `--btc-rpc-user`   |
 * | `BTCR2_BTC_RPC_PASS`  | `--btc-rpc-pass`   |
 * | `BTCR2_CAS_GATEWAY`   | `--cas-gateway`    |
 */
export const ENV_VARS = {
  BTC_REST     : 'BTCR2_BTC_REST',
  BTC_RPC_URL  : 'BTCR2_BTC_RPC_URL',
  BTC_RPC_USER : 'BTCR2_BTC_RPC_USER',
  BTC_RPC_PASS : 'BTCR2_BTC_RPC_PASS',
  CAS_GATEWAY  : 'BTCR2_CAS_GATEWAY',
} as const;

/**
 * Reads {@link ConnectionOverrides} from environment variables.
 * Only defined (non-empty) values are included.
 */
export function readEnvOverrides(): ConnectionOverrides {
  const env = (key: string): string | undefined => process.env[key] || undefined;
  return {
    btcRest    : env(ENV_VARS.BTC_REST),
    btcRpcUrl  : env(ENV_VARS.BTC_RPC_URL),
    btcRpcUser : env(ENV_VARS.BTC_RPC_USER),
    btcRpcPass : env(ENV_VARS.BTC_RPC_PASS),
    casGateway : env(ENV_VARS.CAS_GATEWAY),
  };
}

/**
 * Default config file path following the XDG Base Directory Specification.
 *
 * Resolution order:
 * 1. `$XDG_CONFIG_HOME/btcr2/config.json`
 * 2. `%APPDATA%/btcr2/config.json` (Windows)
 * 3. `~/.config/btcr2/config.json` (fallback)
 */
export function defaultConfigPath(): string {
  const base = process.env.XDG_CONFIG_HOME
    ?? process.env.APPDATA
    ?? join(homedir(), '.config');
  return join(base, 'btcr2', 'config.json');
}

/**
 * Reads and parses a config file. Returns `undefined` if the file does
 * not exist or cannot be parsed.
 */
export function readConfigFile(path: string): ConfigFile | undefined {
  try {
    const content = readFileSync(path, 'utf-8');
    return JSON.parse(content) as ConfigFile;
  } catch {
    return undefined;
  }
}

/**
 * Extracts {@link ConnectionOverrides} from a named profile in a
 * {@link ConfigFile}. Returns an empty object if the profile does not exist.
 */
export function profileToOverrides(
  config      : ConfigFile,
  profileName : string,
): ConnectionOverrides {
  const profile = config.profiles?.[profileName];
  if (!profile) return {};
  return {
    btcRest    : profile.btc?.rest,
    btcRpcUrl  : profile.btc?.rpcUrl,
    btcRpcUser : profile.btc?.rpcUser,
    btcRpcPass : profile.btc?.rpcPass,
    casGateway : profile.cas?.gateway,
  };
}

/**
 * Default {@link ApiFactory} backed by network defaults from
 * `@did-btcr2/bitcoin` (mempool.space for public networks, localhost for
 * regtest).
 *
 * Override precedence (highest wins):
 * CLI flags → env vars → config file profile → network defaults.
 *
 * When no `--profile` is given, the network name is used as the profile
 * key (e.g. a regtest DID auto-selects the `"regtest"` profile).
 */
export function defaultApiFactory(network?: NetworkOption, overrides?: ConnectionOverrides): DidBtcr2Api {
  if (!network) return createApi();

  // Layer 1: Config file profile (lowest precedence of the three override layers)
  const configPath = overrides?.config ?? defaultConfigPath();
  const profileName = overrides?.profile ?? network;
  const file = readConfigFile(configPath);
  const fileOverrides = file ? profileToOverrides(file, profileName) : {};

  // Layer 2: Environment variables
  const env = readEnvOverrides();

  // Merge: CLI flags → env vars → config file → (network defaults handled by BitcoinConnection)
  const merged: ConnectionOverrides = {
    btcRest    : overrides?.btcRest    ?? env.btcRest    ?? fileOverrides.btcRest,
    btcRpcUrl  : overrides?.btcRpcUrl  ?? env.btcRpcUrl  ?? fileOverrides.btcRpcUrl,
    btcRpcUser : overrides?.btcRpcUser ?? env.btcRpcUser ?? fileOverrides.btcRpcUser,
    btcRpcPass : overrides?.btcRpcPass ?? env.btcRpcPass ?? fileOverrides.btcRpcPass,
    casGateway : overrides?.casGateway ?? env.casGateway ?? fileOverrides.casGateway,
  };

  const btc: BitcoinApiConfig = { network };

  if (merged.btcRest) {
    btc.rest = { host: merged.btcRest };
  }

  if (merged.btcRpcUrl) {
    btc.rpc = {
      host     : merged.btcRpcUrl,
      username : merged.btcRpcUser,
      password : merged.btcRpcPass,
    };
  }

  const cas = merged.casGateway ? { gateway: merged.casGateway } : undefined;

  return createApi({ btc, ...(cas && { cas }) });
}

/**
 * Extracts and validates the Bitcoin network from a DID string.
 *
 * Decodes the DID via {@link Identifier.decode}, then checks that the
 * embedded network is one of the supported values.
 *
 * @param did A `did:btcr2:...` identifier string.
 * @returns The validated {@link NetworkOption}.
 * @throws {CLIError} If the network is unsupported.
 */
export function deriveNetwork(did: string): NetworkOption {
  const { network } = Identifier.decode(did);
  if (!SUPPORTED_NETWORKS.includes(network as NetworkOption)) {
    throw new CLIError(
      `Unsupported network "${network}" in DID.`,
      'INVALID_ARGUMENT_ERROR',
      { did, network }
    );
  }
  return network as NetworkOption;
}

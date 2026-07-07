import { createApi, Identifier, type BitcoinApiConfig, type CasConfig, type DidBtcr2Api } from '@did-btcr2/api';
import type { KeyManager } from '@did-btcr2/key-manager';
import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { CLIError } from './error.js';
import { ensureDir, writeFileAtomic } from './keystore/atomic.js';
import { FileBackedKeyManager } from './keystore/file-backed-key-manager.js';
import { defaultKeystorePath } from './keystore/paths.js';
import { acquirePassphrase } from './keystore/passphrase.js';
import { SUPPORTED_NETWORKS, type NetworkOption, type OutputFormat } from './types.js';

/**
 * Endpoint overrides provided via CLI flags, env vars, or config file.
 * These override the per-network defaults the SDK applies
 * (`DEFAULT_BITCOIN_NETWORK_CONFIG` in `@did-btcr2/api`).
 *
 * `config` and `profile` control config-file resolution and are only
 * meaningful when passed through the full merge chain.
 */
export type ConnectionOverrides = {
  btcRest?        : string;
  btcRpcUrl?      : string;
  btcRpcUser?     : string;
  btcRpcPass?     : string;
  /** IPFS HTTP gateway for CAS reads (read-only). */
  casGateway?     : string;
  /** IPFS HTTP RPC endpoint for a writable CAS (reads + writes). */
  casRpcUrl?      : string;
  config?         : string;
  profile?        : string;
  /** Keystore file path. Overrides the default `$XDG_DATA_HOME/btcr2/keystore.json`. */
  keystore?       : string;
  /** Path to a file holding the keystore passphrase (for unattended use). */
  passphraseFile? : string;
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
 *       "cas": { "gateway": "https://ipfs.io", "rpcUrl": "http://127.0.0.1:5001" }
 *     }
 *   }
 * }
 * ```
 */
export type ConfigFile = {
  /** Schema version, stamped on every write for forward compatibility. */
  schemaVersion?: number;
  /** Tool-wide defaults applied when not overridden by a flag or environment variable. */
  defaults?: {
    profile?: string;
    network?: NetworkOption;
    output?: OutputFormat;
  };
  profiles?: Record<string, {
    btc?: {
      rest?    : string;
      rpcUrl?  : string;
      rpcUser? : string;
      rpcPass? : string;
    };
    cas?: {
      /** IPFS HTTP gateway for CAS reads (read-only). */
      gateway?: string;
      /** IPFS HTTP RPC endpoint for a writable CAS (reads + writes). */
      rpcUrl?: string;
    };
    /** Signing identity references. Never embeds key material; the secret lives in the keystore. */
    identity?: {
      keystore?: string;
      default?: string;
    };
  }>;
};

/** Current config-file schema version, stamped on every write. */
export const CONFIG_SCHEMA_VERSION = 1;

/**
 * Read-modify-write a config file, preserving unknown keys. Reads the raw JSON
 * (so keys outside {@link ConfigFile} survive a rewrite), applies `mutate`,
 * stamps the schema version, and writes atomically (file 0600, dir 0700).
 */
export function writeConfigFile(path: string, mutate: (raw: Record<string, unknown>) => void): void {
  const raw: Record<string, unknown> = (readConfigFile(path) as Record<string, unknown> | undefined) ?? {};
  mutate(raw);
  raw.schemaVersion = CONFIG_SCHEMA_VERSION;
  ensureDir(dirname(path), 0o700);
  writeFileAtomic(path, `${JSON.stringify(raw, null, 2)}\n`, 0o600);
}

/** Reads the value at a dotted path (e.g. `profiles.regtest.btc.rest`). */
export function getConfigPath(config: Record<string, unknown>, path: string): unknown {
  return path.split('.').reduce<unknown>(
    (node, key) => (node as Record<string, unknown> | undefined)?.[key],
    config,
  );
}

/** Sets the value at a dotted path, creating intermediate objects. */
export function setConfigPath(config: Record<string, unknown>, path: string, value: unknown): void {
  const keys = path.split('.');
  const last = keys.pop();
  if (!last) throw new CLIError('Config path must be non-empty.', 'INVALID_ARGUMENT_ERROR');
  let node = config;
  for (const key of keys) {
    if (typeof node[key] !== 'object' || node[key] === null) node[key] = {};
    node = node[key] as Record<string, unknown>;
  }
  node[last] = value;
}

/** Deletes the value at a dotted path. No-op if the path does not exist. */
export function unsetConfigPath(config: Record<string, unknown>, path: string): void {
  const keys = path.split('.');
  const last = keys.pop();
  if (!last) return;
  let node: Record<string, unknown> | undefined = config;
  for (const key of keys) {
    node = node?.[key] as Record<string, unknown> | undefined;
    if (!node) return;
  }
  delete node[last];
}

/**
 * Factory function that creates a configured {@link DidBtcr2Api} instance.
 *
 * When `network` is provided, the returned API is wired to that network's
 * default Bitcoin endpoints (mempool.space for public networks, localhost
 * Polar for regtest). Optional `overrides` let callers replace individual
 * endpoints on top of the defaults. When `network` is omitted, no Bitcoin
 * or CAS is configured - suitable for offline operations like `create`.
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
 * | `BTCR2_CAS_RPC_URL`   | `--cas-rpc-url`    |
 */
export const ENV_VARS = {
  BTC_REST     : 'BTCR2_BTC_REST',
  BTC_RPC_URL  : 'BTCR2_BTC_RPC_URL',
  BTC_RPC_USER : 'BTCR2_BTC_RPC_USER',
  BTC_RPC_PASS : 'BTCR2_BTC_RPC_PASS',
  CAS_GATEWAY  : 'BTCR2_CAS_GATEWAY',
  CAS_RPC_URL  : 'BTCR2_CAS_RPC_URL',
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
    casRpcUrl  : env(ENV_VARS.CAS_RPC_URL),
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
    casRpcUrl  : profile.cas?.rpcUrl,
  };
}

/**
 * Resolves the default Bitcoin network for offline identifier creation when no
 * `--network` flag is given. Resolution order: the config file's
 * `defaults.network`, then an active profile named for a network (an explicit
 * `--profile` flag or `defaults.profile`), then `regtest` as the development
 * fallback. Generation itself is offline; this only fixes which network the
 * identifier encodes.
 */
export function resolveDefaultNetwork(overrides?: ConnectionOverrides): NetworkOption {
  const configPath = overrides?.config ?? defaultConfigPath();
  const file = readConfigFile(configPath);

  const explicit = file?.defaults?.network;
  if (explicit && SUPPORTED_NETWORKS.includes(explicit)) return explicit;

  const profile = overrides?.profile ?? file?.defaults?.profile;
  if (profile && SUPPORTED_NETWORKS.includes(profile as NetworkOption)) {
    return profile as NetworkOption;
  }

  return 'regtest';
}

/**
 * Resolves the Bitcoin and CAS connection config for a network by merging,
 * in precedence order, CLI flags, environment variables, and the config-file
 * profile on top of the per-network defaults (handled by `BitcoinConnection`).
 *
 * Returns an empty config when no network is given, since offline operations
 * (create, key management) need no connection.
 *
 * When no `--profile` is given, the network name is used as the profile key
 * (e.g. a regtest DID auto-selects the `"regtest"` profile).
 */
function resolveConnectionConfig(
  network?  : NetworkOption,
  overrides?: ConnectionOverrides,
): { btc?: BitcoinApiConfig; cas?: CasConfig } {
  if (!network) return {};

  // Layer 1: Config file profile (lowest precedence of the three override layers)
  const configPath = overrides?.config ?? defaultConfigPath();
  const file = readConfigFile(configPath);
  const profileName = overrides?.profile ?? file?.defaults?.profile ?? network;
  const fileOverrides = file ? profileToOverrides(file, profileName) : {};

  // Layer 2: Environment variables
  const env = readEnvOverrides();

  // Merge: CLI flags -> env vars -> config file -> (network defaults handled by BitcoinConnection)
  const merged: ConnectionOverrides = {
    btcRest    : overrides?.btcRest    ?? env.btcRest    ?? fileOverrides.btcRest,
    btcRpcUrl  : overrides?.btcRpcUrl  ?? env.btcRpcUrl  ?? fileOverrides.btcRpcUrl,
    btcRpcUser : overrides?.btcRpcUser ?? env.btcRpcUser ?? fileOverrides.btcRpcUser,
    btcRpcPass : overrides?.btcRpcPass ?? env.btcRpcPass ?? fileOverrides.btcRpcPass,
    casGateway : overrides?.casGateway ?? env.casGateway ?? fileOverrides.casGateway,
    casRpcUrl  : overrides?.casRpcUrl  ?? env.casRpcUrl  ?? fileOverrides.casRpcUrl,
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

  // A configured RPC endpoint is writable and takes precedence over the
  // read-only gateway (matching the api's CasConfig priority: rpcUrl > gateway).
  // Both may be set; the api selects one executor from them.
  const cas: CasConfig = {};
  if (merged.casGateway) cas.gateway = merged.casGateway;
  if (merged.casRpcUrl) cas.rpcUrl = merged.casRpcUrl;
  const hasCas = merged.casGateway || merged.casRpcUrl;

  return { btc, ...(hasCas && { cas }) };
}

/**
 * Default {@link ApiFactory} backed by network defaults from
 * `@did-btcr2/bitcoin` (mempool.space for public networks, localhost for
 * regtest). Keystore-free: suitable for offline `create` and read-only
 * `resolve`, which never need a signing identity.
 *
 * Override precedence (highest wins):
 * CLI flags -> env vars -> config file profile -> network defaults.
 */
export function defaultApiFactory(network?: NetworkOption, overrides?: ConnectionOverrides): DidBtcr2Api {
  return createApi(resolveConnectionConfig(network, overrides));
}

/**
 * Builds a keystore-backed {@link KeyManager} reading secret keys from the
 * encrypted on-disk keystore. The passphrase is acquired lazily, so building
 * this never prompts; a prompt happens only when a secret is actually sealed
 * or opened. The persisted active-key pointer is re-applied (a non-decrypting
 * existence check) so "the active key" survives across invocations.
 */
function buildKeystoreKms(overrides?: ConnectionOverrides): KeyManager {
  return new FileBackedKeyManager({
    path          : overrides?.keystore ?? defaultKeystorePath(),
    getPassphrase : () => acquirePassphrase({ passphraseFile: overrides?.passphraseFile }),
  });
}

/**
 * Keystore-aware {@link ApiFactory} for commands that need a signing identity
 * (key management, update, deactivate). Identical to {@link defaultApiFactory}
 * for Bitcoin and CAS, plus an injected keystore-backed KeyManager. Offline key
 * commands (no network) still get the keystore.
 */
export function keystoreApiFactory(network?: NetworkOption, overrides?: ConnectionOverrides): DidBtcr2Api {
  return createApi({
    ...resolveConnectionConfig(network, overrides),
    kms : buildKeystoreKms(overrides),
  });
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

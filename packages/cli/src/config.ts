import { createApi, DEFAULT_BITCOIN_NETWORK_CONFIG, DEFAULT_CAS_GATEWAY, Identifier, type BitcoinApiConfig, type CasConfig, type DidBtcr2Api } from '@did-btcr2/api';
import type { KeyManager } from '@did-btcr2/key-manager';
import { StaticFeeEstimator } from '@did-btcr2/method';
import type { BroadcastOptions } from '@did-btcr2/method';
import { readFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { CLIError } from './error.js';
import { ensureDir, writeFileAtomic } from './keystore/atomic.js';
import { FileBackedKeyManager } from './keystore/file-backed-key-manager.js';
import { keystoreProtection, keystoreVerifierId } from './keystore/file-key-store.js';
import { defaultKeystorePath } from './keystore/paths.js';
import { acquirePassphrase } from './keystore/passphrase.js';
import { readLiveSessionPassphrase } from './keystore/session.js';
import { defaultConfigPath, defaultSessionPath } from './paths.js';
import { blankToUndef, SUPPORTED_NETWORKS, type KeystoreProtectionLabel, type NetworkOption, type OutputFormat } from './types.js';

export { defaultConfigPath };

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
  /** Bitcoin REST/RPC request timeout in milliseconds (raw flag/env string). */
  btcTimeout?     : string;
  /** CAS request timeout in milliseconds (raw flag/env string; `0` disables). */
  casTimeout?     : string;
  /** Extra Bitcoin REST headers as raw `Key: Value` flag values (repeatable). */
  btcRestHeader?  : string[];
  /** Bitcoin Core RPC wallet name for wallet-scoped RPCs. */
  btcRpcWallet?   : string;
  /** Extra Bitcoin Core RPC headers as raw `Key: Value` flag values (repeatable). */
  btcRpcHeader?   : string[];
  /** CLI home root from `--home`. Colocates config.json + keystore.json (ADR 079). */
  home?           : string;
  config?         : string;
  profile?        : string;
  /** Keystore file path. Overrides the home default `<home>/keystore.json`. */
  keystore?       : string;
  /** Path to a file holding the keystore passphrase (for unattended use). */
  passphraseFile? : string;
  /** Signing key reference (URN, fingerprint prefix, or name) from `--signing-key`. */
  signingKey?     : string;
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
    /**
     * The Bitcoin network this profile's endpoints target. Declaring it lets a
     * profile that is not named after a network (e.g. `production`) still fix
     * the network its `create` runs encode, and lets the CLI warn when the
     * network being encoded disagrees with the profile's endpoints.
     */
    network? : NetworkOption;
    btc?: {
      rest?          : string;
      rpcUrl?        : string;
      rpcUser?       : string;
      rpcPass?       : string;
      /** Fee rate in sats/vByte for beacon transactions (update/deactivate). */
      feeRate?       : number;
      /** Change address for beacon transactions (ADR 044 unlinkability opt-out). */
      changeAddress? : string;
      /** Request timeout in milliseconds for REST/RPC calls. No default (unbounded). */
      timeoutMs?     : number;
      /** Extra headers sent on REST (Esplora) requests, e.g. an API key. */
      headers?       : Record<string, string>;
      /** Bitcoin Core wallet name for wallet-scoped RPCs. */
      wallet?        : string;
      /** Extra headers sent on Bitcoin Core RPC requests. */
      rpcHeaders?    : Record<string, string>;
    };
    cas?: {
      /** IPFS HTTP gateway for CAS reads (read-only). */
      gateway?: string;
      /** IPFS HTTP RPC endpoint for a writable CAS (reads + writes). */
      rpcUrl?: string;
      /** Request timeout in milliseconds for CAS operations. Default 30000; `0` disables. */
      timeoutMs?: number;
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
 *
 * A file that exists but cannot be parsed makes {@link readConfigFile} throw, so
 * a write never starts from `{}` over a malformed-but-recoverable file and can
 * never clobber the other profiles and defaults it still holds. A genuinely
 * absent file (ENOENT) still starts from `{}`.
 */
export function writeConfigFile(path: string, mutate: (raw: Record<string, unknown>) => void): void {
  const raw: Record<string, unknown> = (readConfigFile(path) as Record<string, unknown> | undefined) ?? {};
  mutate(raw);
  raw.schemaVersion = CONFIG_SCHEMA_VERSION;
  ensureDir(dirname(path), 0o700);
  writeFileAtomic(path, `${JSON.stringify(raw, null, 2)}\n`, 0o600);
}

/**
 * Writes a default config scaffold to `path`: schema version, a `text` output
 * default, and one empty profile per supported network. Shared by `config init`
 * and `btcr2 init` so the seeded config is identical. Writes atomically (file
 * 0600, dir 0700); the caller decides whether to overwrite an existing file.
 */
export function writeDefaultConfigFile(path: string): void {
  const scaffold = {
    schemaVersion : CONFIG_SCHEMA_VERSION,
    defaults      : { output: 'text' },
    profiles      : Object.fromEntries(SUPPORTED_NETWORKS.map(n => [ n, {} ])),
  };
  ensureDir(dirname(path), 0o700);
  writeFileAtomic(path, `${JSON.stringify(scaffold, null, 2)}\n`, 0o600);
}

/** Reads the value at a dotted path (e.g. `profiles.regtest.btc.rest`). */
export function getConfigPath(config: Record<string, unknown>, path: string): unknown {
  return path.split('.').reduce<unknown>(
    (node, key) => (node as Record<string, unknown> | undefined)?.[key],
    config,
  );
}

/** Dotted-path segments that would let a write reach the prototype chain. */
const UNSAFE_KEYS = new Set([ '__proto__', 'constructor', 'prototype' ]);

/** Rejects a path segment that would let a `config set`/`unset` reach the prototype chain. */
function assertSafeKey(key: string, path: string): void {
  if (UNSAFE_KEYS.has(key)) {
    throw new CLIError(`Illegal config path segment "${key}" in "${path}".`, 'INVALID_ARGUMENT_ERROR', { path, key });
  }
}

/** Sets the value at a dotted path, creating intermediate objects. */
export function setConfigPath(config: Record<string, unknown>, path: string, value: unknown): void {
  const keys = path.split('.');
  keys.forEach(key => assertSafeKey(key, path));
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
  keys.forEach(key => assertSafeKey(key, path));
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
 * | `BTCR2_BTC_TIMEOUT`   | `--btc-timeout`    |
 * | `BTCR2_CAS_TIMEOUT`   | `--cas-timeout`    |
 * | `BTCR2_FEE_RATE`      | `--fee-rate`       |
 */
export const ENV_VARS = {
  BTC_REST     : 'BTCR2_BTC_REST',
  BTC_RPC_URL  : 'BTCR2_BTC_RPC_URL',
  BTC_RPC_USER : 'BTCR2_BTC_RPC_USER',
  BTC_RPC_PASS : 'BTCR2_BTC_RPC_PASS',
  CAS_GATEWAY  : 'BTCR2_CAS_GATEWAY',
  CAS_RPC_URL  : 'BTCR2_CAS_RPC_URL',
  BTC_TIMEOUT  : 'BTCR2_BTC_TIMEOUT',
  CAS_TIMEOUT  : 'BTCR2_CAS_TIMEOUT',
  FEE_RATE     : 'BTCR2_FEE_RATE',
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
 * Reads and JSON-parses a config file without applying the schema-version
 * ceiling check. Returns `undefined` only for a genuinely absent file (ENOENT).
 * Any other read failure, and any JSON parse failure, throws a {@link CLIError}
 * that names the file. Used by `config validate`, which reports a newer-than-
 * supported `schemaVersion` as a finding rather than aborting on it.
 */
export function parseConfigFileRaw(path: string): Record<string, unknown> | undefined {
  let content: string;
  try {
    content = readFileSync(path, 'utf-8');
  } catch (error: unknown) {
    if ((error as { code?: string }).code === 'ENOENT') return undefined;
    throw new CLIError(
      `Failed to read config file at ${path}: ${(error as Error).message}`,
      'CONFIG_READ_ERROR',
      { path },
    );
  }
  try {
    return JSON.parse(content) as Record<string, unknown>;
  } catch (error: unknown) {
    throw new CLIError(
      `Config file at ${path} is not valid JSON: ${(error as Error).message}. `
      + 'Fix the file by hand; the CLI will not overwrite it while it is unparseable.',
      'CONFIG_PARSE_ERROR',
      { path },
    );
  }
}

/**
 * Reads and parses a config file. Returns `undefined` only when the file is
 * genuinely absent (ENOENT), so callers can safely treat "no file" as "use
 * defaults". Any other read failure, and any JSON parse failure, throws a
 * {@link CLIError} that names the file, rather than silently degrading to the
 * public network defaults. A file written by a newer CLI (higher `schemaVersion`)
 * is also refused.
 */
export function readConfigFile(path: string): ConfigFile | undefined {
  const parsed = parseConfigFileRaw(path);
  if (parsed === undefined) return undefined;
  migrateConfigShape(parsed, path);
  return parsed as ConfigFile;
}

/**
 * Validates a parsed config's `schemaVersion` against {@link CONFIG_SCHEMA_VERSION}
 * and brings an older shape up to the current version in place. A file written by
 * a newer CLI is refused so today's assumptions are never applied blindly to an
 * unknown shape. An absent version is treated as the earliest and migrated
 * forward. No structural migrations are registered yet (the schema is at version
 * 1); future versions register their transforms here in ascending order.
 */
function migrateConfigShape(raw: Record<string, unknown>, path: string): void {
  const version = typeof raw.schemaVersion === 'number' ? raw.schemaVersion : 0;
  if (version > CONFIG_SCHEMA_VERSION) {
    throw new CLIError(
      `Config file at ${path} has schemaVersion ${version}, but this CLI supports up to `
      + `${CONFIG_SCHEMA_VERSION}. Upgrade the btcr2 CLI to read it.`,
      'CONFIG_SCHEMA_VERSION_ERROR',
      { path, fileVersion: version, supported: CONFIG_SCHEMA_VERSION },
    );
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
 * Resolves the active profile name and the network it targets, shared by
 * {@link resolveDefaultNetwork} and {@link resolveConnectionConfig} so the two
 * can never disagree about which profile is active or which network it means.
 *
 * The active profile name is the explicit `--profile` flag, else the config
 * file's `defaults.profile`. The network is the profile's own `network` field
 * when set to a supported value, else the profile name itself when it is a
 * network name (the historical convention). A profile that declares no network
 * and is not named after one yields `network: undefined`.
 */
export function resolveActiveProfile(
  file      : ConfigFile | undefined,
  overrides?: ConnectionOverrides,
): { name: string | undefined; network: NetworkOption | undefined } {
  const name = blankToUndef(overrides?.profile) ?? file?.defaults?.profile;
  if (!name) return { name: undefined, network: undefined };

  const declared = file?.profiles?.[name]?.network;
  const network = (declared && SUPPORTED_NETWORKS.includes(declared))
    ? declared
    : (SUPPORTED_NETWORKS.includes(name as NetworkOption) ? name as NetworkOption : undefined);
  return { name, network };
}

/**
 * Resolves the default Bitcoin network for offline identifier creation when no
 * `--network` flag is given. Resolution order: the config file's
 * `defaults.network`, then the active profile's network (its explicit `network`
 * field, else its network-derived name), then `regtest` as the development
 * fallback. Generation itself is offline; this only fixes which network the
 * identifier encodes.
 */
export function resolveDefaultNetwork(overrides?: ConnectionOverrides): NetworkOption {
  const configPath = overrides?.config ?? defaultConfigPath(overrides);
  const file = readConfigFile(configPath);

  const explicit = file?.defaults?.network;
  if (explicit && SUPPORTED_NETWORKS.includes(explicit)) return explicit;

  const { network } = resolveActiveProfile(file, overrides);
  if (network) return network;

  return 'regtest';
}

/**
 * Reports a coherence conflict between the network a `create` run is about to
 * encode and the network the active profile declares, so the CLI can warn
 * instead of silently minting an identifier on one network while wiring
 * endpoints for another. Returns `undefined` when the active profile declares
 * no network or agrees with the one being encoded.
 */
export function profileNetworkMismatch(
  network   : NetworkOption,
  overrides?: ConnectionOverrides,
): { profile: string; declared: NetworkOption } | undefined {
  // This drives only a warning, so a malformed config must not break an otherwise
  // offline `create`; a genuinely broken config is still surfaced loudly by any
  // command that actually resolves a connection.
  let file: ConfigFile | undefined;
  try {
    file = readConfigFile(overrides?.config ?? defaultConfigPath(overrides));
  } catch {
    return undefined;
  }
  const { name, network: declared } = resolveActiveProfile(file, overrides);
  if (name && declared && declared !== network) return { profile: name, declared };
  return undefined;
}

/**
 * Resolves the effective output format: the `-o/--output` flag, then the
 * `BTCR2_OUTPUT` environment variable, then the config file's `defaults.output`,
 * then `'text'`. A malformed config never blocks output resolution (the command's
 * own read path surfaces it); output format falls back to `'text'` instead.
 */
export function resolveOutputFormat(options: { output?: string; config?: string; home?: string }): OutputFormat {
  const candidates: Array<string | undefined> = [
    blankToUndef(options.output),
    process.env.BTCR2_OUTPUT || undefined,
  ];
  try {
    candidates.push(readConfigFile(options.config ?? defaultConfigPath(options))?.defaults?.output);
  } catch {
    // Output format is cosmetic; a broken config is reported by the command
    // itself rather than aborting here (which would block a recovery command).
  }
  for (const candidate of candidates) {
    if (candidate === 'json' || candidate === 'text') return candidate;
  }
  return 'text';
}

/**
 * The resolved RPC credential unit: url, user, and pass drawn from a single
 * precedence layer, tagged with that layer's provenance. `pass` is kept raw so a
 * secret-ref (`env:`/`file:`) can be resolved by the caller.
 */
interface RpcUnit {
  src   : Provenance;
  url?  : string;
  user? : string;
  pass? : string;
}

/**
 * Resolves the RPC credential unit atomically: the highest-precedence layer that
 * supplies a url, else the highest that supplies a username or password. url,
 * user, and pass therefore always come from one layer, so a host from one layer
 * is never handed another layer's credentials (ADR 074). When no layer supplies a
 * url, the credentials still resolve (so they reach the SDK's per-network default
 * host, e.g. regtest's, without the url being restated). Returns `undefined` when
 * no layer supplies a url or a credential.
 */
function resolveRpcUnit(
  overrides?    : ConnectionOverrides,
  env?          : ConnectionOverrides,
  fileOverrides?: ConnectionOverrides,
): RpcUnit | undefined {
  const layers: Array<{ src: Provenance; url?: string; user?: string; pass?: string }> = [
    { src: 'flag', url: overrides?.btcRpcUrl,     user: overrides?.btcRpcUser,     pass: overrides?.btcRpcPass },
    { src: 'env',  url: env?.btcRpcUrl,           user: env?.btcRpcUser,           pass: env?.btcRpcPass },
    { src: 'file', url: fileOverrides?.btcRpcUrl, user: fileOverrides?.btcRpcUser, pass: fileOverrides?.btcRpcPass },
  ];
  const withUrl = layers.find(l => blankToUndef(l.url) !== undefined);
  if (withUrl) {
    return { src: withUrl.src, url: blankToUndef(withUrl.url), user: blankToUndef(withUrl.user), pass: blankToUndef(withUrl.pass) };
  }
  const withCreds = layers.find(l => blankToUndef(l.user) !== undefined || blankToUndef(l.pass) !== undefined);
  if (withCreds) {
    return { src: withCreds.src, url: undefined, user: blankToUndef(withCreds.user), pass: blankToUndef(withCreds.pass) };
  }
  return undefined;
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
export function resolveConnectionConfig(
  network?  : NetworkOption,
  overrides?: ConnectionOverrides,
): { btc?: BitcoinApiConfig; cas?: CasConfig } {
  if (!network) return {};

  // Layer 1: Config file profile (lowest precedence of the three override layers).
  // The active-profile name is resolved through the same shared helper as
  // resolveDefaultNetwork so the two cannot disagree about which profile is live.
  const configPath = overrides?.config ?? defaultConfigPath(overrides);
  const file = readConfigFile(configPath);
  const { name: activeProfile } = resolveActiveProfile(file, overrides);
  const profileName = activeProfile ?? network;
  const fileOverrides = file ? profileToOverrides(file, profileName) : {};

  // Layer 2: Environment variables
  const env = readEnvOverrides();

  // Blank-aware precedence merge: CLI flag -> env var -> config file. A blank at
  // any layer defers to the next instead of masking it (mirrors the env layer's
  // `|| undefined`), so an empty flag or profile field no longer silently reverts
  // resolution to the SDK network default.
  const pick = (flag?: string, envVal?: string, fileVal?: string): string | undefined =>
    blankToUndef(flag) ?? blankToUndef(envVal) ?? blankToUndef(fileVal);

  const profileBtc = file?.profiles?.[profileName]?.btc;
  const profileCas = file?.profiles?.[profileName]?.cas;

  const btc: BitcoinApiConfig = { network };

  // REST host and headers. Headers apply even without a host override, layering
  // onto the per-network default host inside the api's config merge, so an
  // authenticated Esplora/mempool endpoint can be reached with the default host.
  const btcRest = pick(overrides?.btcRest, env.btcRest, fileOverrides.btcRest);
  const restHeaders = mergeHeaders(profileBtc?.headers, parseHeaderList(overrides?.btcRestHeader, '--btc-rest-header'));
  if (btcRest || restHeaders) {
    btc.rest = { ...(btcRest ? { host: btcRest } : {}), ...(restHeaders ? { headers: restHeaders } : {}) };
  }

  // Resolve the RPC endpoint as one atomic credential unit (url + user + pass from
  // one layer), plus the orthogonal wallet and header augmentations.
  const rpcUnit = resolveRpcUnit(overrides, env, fileOverrides);
  const rpcWallet = pick(overrides?.btcRpcWallet, undefined, profileBtc?.wallet);
  const rpcHeaders = mergeHeaders(profileBtc?.rpcHeaders, parseHeaderList(overrides?.btcRpcHeader, '--btc-rpc-header'));

  // Build an RPC config only when a host will actually exist to talk to: either
  // the unit supplies a url, or the network has a default RPC host (regtest).
  // Wallet/header (or credential) knobs alone with no host would otherwise point
  // a phantom client at the default 127.0.0.1:8332 and, on public networks, flip
  // the connection to "has RPC" spuriously (and could leak a header credential
  // meant for a remote proxy). The pass-file fallback is read lazily inside this
  // block, so a set-but-unreadable BTCR2_BTC_RPC_PASS_FILE never aborts a command
  // that uses no RPC at all.
  const networkHasDefaultRpc = DEFAULT_BITCOIN_NETWORK_CONFIG[network].rpc !== undefined;
  const wantsRpc = rpcUnit !== undefined || rpcWallet !== undefined || rpcHeaders !== undefined;
  const hasRpcHost = rpcUnit?.url !== undefined || networkHasDefaultRpc;
  if (wantsRpc && hasRpcHost) {
    const password = resolveSecretRef(rpcUnit?.pass) ?? readRpcPassFile();
    btc.rpc = {
      ...(rpcUnit?.url  !== undefined ? { host: rpcUnit.url } : {}),
      ...(rpcUnit?.user !== undefined ? { username: rpcUnit.user } : {}),
      ...(password      !== undefined ? { password } : {}),
      ...(rpcWallet ? { wallet: rpcWallet } : {}),
      ...(rpcHeaders ? { headers: rpcHeaders } : {}),
    };
  }

  // Bitcoin request timeout. No default: honored only when explicitly set, so
  // callers that rely on unbounded waits are unaffected (ADR 076).
  const btcTimeout = resolveTimeout(overrides?.btcTimeout, process.env[ENV_VARS.BTC_TIMEOUT], profileBtc?.timeoutMs, '--btc-timeout', 1);
  if (btcTimeout !== undefined) btc.timeoutMs = btcTimeout;

  // A configured RPC endpoint is writable and takes precedence over the
  // read-only gateway (matching the api's CasConfig priority: rpcUrl > gateway).
  // Both may be set; the api selects one executor from them.
  const casGateway = pick(overrides?.casGateway, env.casGateway, fileOverrides.casGateway);
  const casRpcUrl  = pick(overrides?.casRpcUrl,  env.casRpcUrl,  fileOverrides.casRpcUrl);
  const casTimeout = resolveTimeout(overrides?.casTimeout, process.env[ENV_VARS.CAS_TIMEOUT], profileCas?.timeoutMs, '--cas-timeout');
  const cas: CasConfig = {};
  if (casGateway) cas.gateway = casGateway;
  if (casRpcUrl)  cas.rpcUrl  = casRpcUrl;
  if (casTimeout !== undefined) {
    cas.timeoutMs = casTimeout;
    // A timeout needs an endpoint to attach to. When none is configured, fall
    // back to the same default gateway the api would otherwise apply, so the
    // timeout is honored rather than dropped (the api only defaults the gateway
    // when the whole cas config is absent).
    if (!casGateway && !casRpcUrl) cas.gateway = DEFAULT_CAS_GATEWAY;
  }
  const hasCas = casGateway || casRpcUrl || casTimeout !== undefined;

  return { btc, ...(hasCas && { cas }) };
}

/**
 * Resolves a millisecond timeout from a flag string, an env string, then a
 * config-file number, in precedence order. Returns `undefined` when none is set
 * (preserving unbounded behavior). Throws a {@link CLIError} for a value below
 * `min` or not a finite number. `min` is `0` for CAS (where `0` disables the
 * timeout) and `1` for the Bitcoin timeout (where `0` would abort every request
 * immediately, which is never intended).
 */
function resolveTimeout(flag?: string, envVal?: string, fileVal?: number, flagName = 'timeout', min = 0): number | undefined {
  const raw = blankToUndef(flag) ?? blankToUndef(envVal) ?? (typeof fileVal === 'number' ? String(fileVal) : undefined);
  if (raw === undefined) return undefined;
  const ms = Number(raw);
  if (!Number.isFinite(ms) || ms < min) {
    throw new CLIError(
      `Invalid ${flagName} value "${raw}": expected a number of milliseconds >= ${min}.`,
      'INVALID_ARGUMENT_ERROR',
      { value: raw },
    );
  }
  return ms;
}

/**
 * Parses repeatable `Key: Value` header flag values into a header map. Returns
 * `undefined` for an empty list. Throws a {@link CLIError} for an entry missing a
 * colon or with an empty key.
 */
export function parseHeaderList(list?: string[], flagName = '--header'): Record<string, string> | undefined {
  if (!list || list.length === 0) return undefined;
  const headers: Record<string, string> = {};
  for (const entry of list) {
    const idx = entry.indexOf(':');
    const key = idx === -1 ? '' : entry.slice(0, idx).trim();
    if (idx === -1 || key === '') {
      throw new CLIError(
        `Invalid ${flagName} "${entry}": expected "Key: Value".`,
        'INVALID_ARGUMENT_ERROR',
        { header: entry },
      );
    }
    headers[key] = entry.slice(idx + 1).trim();
  }
  return headers;
}

/**
 * Merges a base header map (from the config-file profile) with an override map
 * (from flags), with the override winning per key. Returns `undefined` when both
 * are absent so callers can skip attaching an empty header map.
 */
function mergeHeaders(
  base?     : Record<string, string>,
  override? : Record<string, string>,
): Record<string, string> | undefined {
  if (!base && !override) return undefined;
  return { ...base, ...override };
}

/** Environment variable naming a file whose contents are the Bitcoin Core RPC password. */
export const ENV_RPC_PASS_FILE = 'BTCR2_BTC_RPC_PASS_FILE';

/** Removes at most one trailing newline, matching the keystore-passphrase normalization. */
function trimTrailingNewline(value: string): string {
  return value.replace(/\r?\n$/, '');
}

/** Reads a secret file, throwing a {@link CLIError} (not a raw Node error) that names the path and source. */
function readSecretFile(path: string, source: string): string {
  try {
    return trimTrailingNewline(readFileSync(path, 'utf-8'));
  } catch (error: unknown) {
    throw new CLIError(
      `Could not read the RPC password ${source} at ${path}: ${(error as Error).message}`,
      'CONFIG_READ_ERROR',
      { path },
    );
  }
}

/**
 * Resolves an RPC-password secret reference to its literal value: `env:<VAR>`
 * reads the named environment variable, `file:<path>` reads the file, and any
 * other value is returned as-is. A trailing newline is trimmed from file/env
 * sources so a secret written by `echo` matches an inline value (ADR 077).
 */
export function resolveSecretRef(value?: string): string | undefined {
  if (value === undefined) return undefined;
  if (value.startsWith('env:')) {
    const fromEnv = process.env[value.slice(4)];
    return fromEnv === undefined ? undefined : trimTrailingNewline(fromEnv);
  }
  if (value.startsWith('file:')) {
    return readSecretFile(value.slice(5), 'file reference');
  }
  return value;
}

/** Reads the RPC password from an {@link ENV_RPC_PASS_FILE}-named file, if set. */
function readRpcPassFile(): string | undefined {
  const path = process.env[ENV_RPC_PASS_FILE];
  if (!path) return undefined;
  return readSecretFile(path, `file named by ${ENV_RPC_PASS_FILE}`);
}

/**
 * Resolves the beacon {@link BroadcastOptions} for an update/deactivate from the
 * fee-rate and change-address knobs, following the CLI precedence chain.
 *
 * - Fee rate: `--fee-rate` flag, then `BTCR2_FEE_RATE`, then profile
 *   `btc.feeRate`. A positive sats/vByte value wrapped in a `StaticFeeEstimator`.
 * - Change address: `--change-address` flag, then profile `btc.changeAddress`
 *   (no env, since a change address is DID/network-specific). Validated against
 *   the DID network by the beacon at broadcast time.
 *
 * Returns `undefined` when neither is set, so the SDK defaults (5 sat/vB, change
 * back to the beacon address) still apply.
 */
export function resolveBroadcastOptions(
  network  : NetworkOption,
  overrides: ConnectionOverrides | undefined,
  flags    : { feeRate?: string; changeAddress?: string },
): BroadcastOptions | undefined {
  const file = readConfigFile(overrides?.config ?? defaultConfigPath(overrides));
  const { name: activeProfile } = resolveActiveProfile(file, overrides);
  const profileBtc = file?.profiles?.[activeProfile ?? network]?.btc;

  const options: BroadcastOptions = {};

  const feeRateRaw = blankToUndef(flags.feeRate)
    ?? blankToUndef(process.env[ENV_VARS.FEE_RATE])
    ?? (typeof profileBtc?.feeRate === 'number' ? String(profileBtc.feeRate) : undefined);
  if (feeRateRaw !== undefined) options.feeEstimator = new StaticFeeEstimator(parseFeeRate(feeRateRaw));

  const changeAddress = blankToUndef(flags.changeAddress) ?? blankToUndef(profileBtc?.changeAddress);
  if (changeAddress) options.changeAddress = changeAddress;

  return options.feeEstimator || options.changeAddress ? options : undefined;
}

/** Parses a positive sats/vByte fee rate, throwing a {@link CLIError} otherwise. */
function parseFeeRate(raw: string): number {
  const rate = Number(raw);
  if (!Number.isFinite(rate) || rate <= 0) {
    throw new CLIError(
      `Invalid --fee-rate "${raw}": expected a positive number of sats per vByte.`,
      'INVALID_ARGUMENT_ERROR',
      { value: raw },
    );
  }
  return rate;
}

/** Which precedence layer a resolved value came from. */
export type Provenance = 'flag' | 'env' | 'file' | 'default';

/** A resolved value paired with the layer it came from. */
export interface EffectiveEntry {
  value  : string | number | undefined;
  source : Provenance;
}

/**
 * The resolved connection config with per-value provenance, the shape behind
 * `config effective`. Values are read through the real resolver (the constructed
 * api and {@link resolveConnectionConfig}) so they cannot drift from what a live
 * command would use; the `source` tag names the layer the merge selected.
 */
export interface EffectiveConfig {
  network : NetworkOption;
  profile : string | undefined;
  btc : {
    rest      : EffectiveEntry;
    rpcUrl    : EffectiveEntry;
    rpcUser   : EffectiveEntry;
    rpcPass   : EffectiveEntry;
    rpcWallet : EffectiveEntry;
    timeoutMs : EffectiveEntry;
  };
  cas : {
    gateway   : EffectiveEntry;
    rpcUrl    : EffectiveEntry;
    timeoutMs : EffectiveEntry;
  };
}

/**
 * Resolves the effective connection config with provenance for `config effective`.
 * The btc values are read back from the constructed api (so SDK network defaults
 * are reflected), the cas and timeout values from {@link resolveConnectionConfig},
 * and each `source` is derived by the same precedence order the merge uses.
 */
export function resolveEffectiveConfig(network: NetworkOption, overrides?: ConnectionOverrides): EffectiveConfig {
  const file = readConfigFile(overrides?.config ?? defaultConfigPath(overrides));
  const { name: activeProfile } = resolveActiveProfile(file, overrides);
  const profileName = activeProfile ?? network;
  const fileOv = file ? profileToOverrides(file, profileName) : {};
  const profileBtc = file?.profiles?.[profileName]?.btc;
  const profileCas = file?.profiles?.[profileName]?.cas;
  const env = readEnvOverrides();

  const api = defaultApiFactory(network, overrides);
  const restCfg = api.btc.connection.rest.config;
  const rpcCfg = api.btc.connection.rpc?.config;
  const conn = resolveConnectionConfig(network, overrides);

  const src = (flag?: string, envVal?: string, fileVal?: unknown): Provenance =>
    blankToUndef(flag) !== undefined ? 'flag'
      : blankToUndef(envVal) !== undefined ? 'env'
        : (fileVal !== undefined && fileVal !== null && String(fileVal).trim() !== '') ? 'file'
          : 'default';

  // CAS has no client to read back from; derive its resolved endpoint from the
  // connection resolver, defaulting the gateway the way the api would.
  const casGatewayVal = conn.cas?.gateway ?? (conn.cas?.rpcUrl ? undefined : DEFAULT_CAS_GATEWAY);

  // RPC url/user/pass provenance follows the atomic-credential unit, so a value's
  // reported source is the layer the merge actually bound it to (never an
  // independent per-field guess that could disagree with the resolver). A password
  // taken from BTCR2_BTC_RPC_PASS_FILE when the unit supplied none is env-sourced.
  const rpcUnit = resolveRpcUnit(overrides, env, fileOv);
  const rpcSrc = rpcUnit?.src ?? 'default';
  const passFromFile = rpcUnit?.pass === undefined
    && process.env[ENV_RPC_PASS_FILE] !== undefined
    && rpcCfg?.password !== undefined;

  return {
    network,
    profile : activeProfile,
    btc     : {
      rest      : { value: restCfg.host,     source: src(overrides?.btcRest, env.btcRest, fileOv.btcRest) },
      rpcUrl    : { value: rpcCfg?.host,      source: rpcUnit?.url  !== undefined ? rpcSrc : 'default' },
      rpcUser   : { value: rpcCfg?.username,  source: rpcUnit?.user !== undefined ? rpcSrc : 'default' },
      rpcPass   : { value: rpcCfg?.password,  source: rpcUnit?.pass !== undefined ? rpcSrc : (passFromFile ? 'env' : 'default') },
      rpcWallet : { value: rpcCfg?.wallet,    source: src(overrides?.btcRpcWallet, undefined, profileBtc?.wallet) },
      timeoutMs : { value: conn.btc?.timeoutMs, source: src(overrides?.btcTimeout, process.env[ENV_VARS.BTC_TIMEOUT], profileBtc?.timeoutMs) },
    },
    cas : {
      gateway   : { value: casGatewayVal,       source: src(overrides?.casGateway, env.casGateway,                    fileOv.casGateway) },
      rpcUrl    : { value: conn.cas?.rpcUrl,     source: src(overrides?.casRpcUrl,  env.casRpcUrl,                     fileOv.casRpcUrl) },
      timeoutMs : { value: conn.cas?.timeoutMs,  source: src(overrides?.casTimeout, process.env[ENV_VARS.CAS_TIMEOUT], profileCas?.timeoutMs) },
    },
  };
}

/** One endpoint reachability check produced by `config doctor`. */
export interface DoctorCheck {
  endpoint : 'btc-rest' | 'btc-rpc' | 'cas';
  target   : string;
  ok       : boolean;
  detail?  : string;
}

/** Result of `config doctor`: per-endpoint reachability and any coherence warning. */
export interface DoctorReport {
  checks     : DoctorCheck[];
  coherence? : { profile: string; declared: NetworkOption; encoding: NetworkOption };
}

/** Default per-probe timeout (ms) for `config doctor`. */
const DOCTOR_PROBE_TIMEOUT_MS = 5000;

/** Fetches a URL with a bounded timeout, reporting reachability rather than throwing. */
async function probeEndpoint(
  endpoint : DoctorCheck['endpoint'],
  target   : string,
  url      : string,
  opts?    : { method?: 'GET' | 'POST'; headers?: Record<string, string> },
): Promise<DoctorCheck> {
  try {
    const res = await fetch(url, {
      method  : opts?.method ?? 'GET',
      headers : opts?.headers,
      signal  : AbortSignal.timeout(DOCTOR_PROBE_TIMEOUT_MS),
    });
    return res.ok
      ? { endpoint, target, ok: true }
      : { endpoint, target, ok: false, detail: `HTTP ${res.status}` };
  } catch (error) {
    return { endpoint, target, ok: false, detail: (error as Error).message };
  }
}

/** Races a promise against a timeout so a stalled RPC call cannot hang `doctor`. */
function withProbeTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout>;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`timed out after ${ms}ms`)), ms);
  });
  return Promise.race([ promise, timeout ]).finally(() => clearTimeout(timer));
}

/**
 * Probes reachability of the resolved endpoints for `config doctor`: a
 * lightweight REST call against btc-rest, a `getblockchaininfo` against btc-rpc
 * when configured, and a reachability check against the resolved CAS. Also
 * surfaces the profile/network coherence warning. Reads and touches the network;
 * never writes.
 */
export async function runDoctor(network: NetworkOption, overrides?: ConnectionOverrides): Promise<DoctorReport> {
  const api = defaultApiFactory(network, overrides);
  const checks: DoctorCheck[] = [];

  const restHost = api.btc.connection.rest.config.host.replace(/\/+$/, '');
  checks.push(await probeEndpoint('btc-rest', restHost, `${restHost}/blocks/tip/height`, { headers: api.btc.connection.rest.config.headers }));

  const rpc = api.btc.connection.rpc;
  if (rpc) {
    const target = rpc.config.host ?? '(default rpc)';
    try {
      await withProbeTimeout(rpc.getBlockchainInfo(), DOCTOR_PROBE_TIMEOUT_MS);
      checks.push({ endpoint: 'btc-rpc', target, ok: true });
    } catch (error) {
      checks.push({ endpoint: 'btc-rpc', target, ok: false, detail: (error as Error).message });
    }
  }

  // A writable IPFS RPC (Kubo) answers only POST, so a bare GET would falsely
  // report a healthy node as down; probe its version endpoint with POST. A
  // read-only gateway answers a plain GET on its base URL.
  const conn = resolveConnectionConfig(network, overrides);
  if (conn.cas?.rpcUrl) {
    const base = conn.cas.rpcUrl.replace(/\/+$/, '');
    checks.push(await probeEndpoint('cas', conn.cas.rpcUrl, `${base}/api/v0/version`, { method: 'POST' }));
  } else {
    const gateway = (conn.cas?.gateway ?? DEFAULT_CAS_GATEWAY).replace(/\/+$/, '');
    checks.push(await probeEndpoint('cas', gateway, gateway));
  }

  const mismatch = profileNetworkMismatch(network, overrides);
  return {
    checks,
    ...(mismatch ? { coherence: { profile: mismatch.profile, declared: mismatch.declared, encoding: network } } : {}),
  };
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
function buildKeystoreKms(overrides?: ConnectionOverrides, network?: NetworkOption): KeyManager {
  const keystorePath = resolveKeystorePath(overrides);
  const sessionPath = defaultSessionPath(overrides);
  // The network the operation will sign under, known here because the factory
  // receives it. A `bitcoin` operation must not consume a session that was not
  // unlocked with `--allow-mainnet`, so mainnet keeps per-use authentication even
  // while a session is live (ADR 081). Key commands pass no network, so the
  // session serves them as before.
  const isMainnetOperation = network === 'bitcoin';
  return new FileBackedKeyManager({
    path          : keystorePath,
    // The store decides when to confirm: it passes `confirm: true` only while
    // establishing a fresh keystore's passphrase, so a first-key typo is caught
    // by a second entry (ADR 080). confirm is a no-op for env/file sources.
    //
    // On the non-establishing path, a cached session (ADR 081) is consulted below
    // the env var / --passphrase-file and above the interactive prompt. It is
    // wired ONLY when not confirming, so establishment never consults the session
    // and a first passphrase is always entered fresh and twice. The session is
    // bound to this keystore's verifier, so a rotated passphrase invalidates it.
    getPassphrase : (opts) => acquirePassphrase({
      passphraseFile : overrides?.passphraseFile,
      confirm        : opts?.confirm,
      ...(opts?.confirm ? {} : {
        beforePrompt : (): string | undefined =>
          readLiveSessionPassphrase(sessionPath, keystorePath, keystoreVerifierId(keystorePath), isMainnetOperation),
      }),
    }),
  });
}

/**
 * The protection mode of the resolved keystore, read without decrypting or
 * prompting: `encrypted`, `dev` (plaintext), or `absent`. Used by `keystore
 * status`, `config path`, and the mainnet guard.
 */
export function resolveKeystoreProtection(overrides?: ConnectionOverrides): KeystoreProtectionLabel {
  return keystoreProtection(resolveKeystorePath(overrides));
}

/**
 * Hard-refuses using an unencrypted dev keystore for a mainnet operation (ADR
 * 080). A plaintext key must never sign or seal a `bitcoin` did:btcr2; the check
 * reads only the keystore's protection header, so it never decrypts or prompts.
 * A no-op for every other network and for encrypted/absent keystores.
 */
export function assertKeystoreAllowedForNetwork(network: NetworkOption, overrides?: ConnectionOverrides): void {
  if (network !== 'bitcoin') return;
  if (resolveKeystoreProtection(overrides) !== 'dev') return;
  const path = resolveKeystorePath(overrides);
  throw new CLIError(
    `Refusing a mainnet (bitcoin) operation with the unencrypted dev keystore at ${path}. `
    + 'Dev keystores hold plaintext keys and are for testnet/regtest throwaway material only. '
    + 'Establish an encrypted keystore (btcr2 keystore init) for mainnet keys.',
    'DEV_KEYSTORE_MAINNET_ERROR',
    { path, network },
  );
}

/**
 * Resolves the keystore file path: the `--keystore` flag, else the active
 * profile's `identity.keystore`, else the default `<home>/keystore.json` (ADR
 * 079). The flag always wins over the profile default and never reads the config.
 *
 * A malformed config aborts loudly by default so a keystore-mutating command
 * never silently reads or writes the wrong store. Pass `lenient: true` only for
 * diagnostic/recovery commands (`config path`, `keystore status`) that must still
 * report a path instead of crashing on the very config you ran them to fix; those
 * fall back to the home default when the profile identity cannot be read.
 */
export function resolveKeystorePath(overrides?: ConnectionOverrides, options?: { lenient?: boolean }): string {
  // The flag wins outright and short-circuits before any config read. A blank
  // flag defers to the profile, and a blank profile `identity.keystore` defers to
  // the default, so neither resolves the keystore to an empty path.
  const fromFlag = blankToUndef(overrides?.keystore);
  if (fromFlag) return fromFlag;
  let identity: { keystore?: string; default?: string } | undefined;
  try {
    identity = activeProfileIdentity(overrides);
  } catch (error) {
    if (!options?.lenient) throw error;
  }
  return blankToUndef(identity?.keystore) ?? defaultKeystorePath(overrides);
}

/**
 * Reads the active profile's `identity` block (keystore + default signing key),
 * or `undefined` when no profile is active. A profile is active only when
 * selected by `--profile` or the config's `defaults.profile`.
 */
function activeProfileIdentity(overrides?: ConnectionOverrides): { keystore?: string; default?: string } | undefined {
  // Intentionally propagates a malformed-config error rather than swallowing it.
  // This feeds resolveKeystorePath for keystore-mutating commands (key generate/
  // import, keystore init/change-passphrase) and the mainnet dev-keystore guard,
  // so a broken config must abort loudly instead of silently resolving to the
  // default keystore and stranding key material there. Diagnostic-only commands
  // opt into a graceful fallback via resolveKeystorePath's `lenient` option; do
  // not add a try/catch here (it would re-hide the keystore misdirection).
  const file = readConfigFile(overrides?.config ?? defaultConfigPath(overrides));
  const { name } = resolveActiveProfile(file, overrides);
  return name ? file?.profiles?.[name]?.identity : undefined;
}

/**
 * Resolves the signing-key reference for update/deactivate: the `--signing-key`
 * flag, else the active profile's `identity.default`, else `undefined` (letting
 * the KMS fall back to its active key). The flag always wins over the profile
 * default, consistent with the flag -> profile precedence used elsewhere.
 */
export function resolveSigningKeyRef(overrides?: ConnectionOverrides): string | undefined {
  return blankToUndef(overrides?.signingKey) ?? blankToUndef(activeProfileIdentity(overrides)?.default);
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
    kms : buildKeystoreKms(overrides, network),
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

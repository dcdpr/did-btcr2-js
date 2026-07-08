import type { Command } from 'commander';
import { existsSync } from 'node:fs';
import {
  CONFIG_SCHEMA_VERSION,
  defaultConfigPath,
  getConfigPath,
  parseConfigFileRaw,
  readConfigFile,
  resolveDefaultNetwork,
  resolveEffectiveConfig,
  resolveKeystorePath,
  runDoctor,
  setConfigPath,
  unsetConfigPath,
  writeConfigFile,
  writeDefaultConfigFile,
} from '../config.js';
import { findConfigIssues, validateConfigSet } from '../config-schema.js';
import { CLIError } from '../error.js';
import { formatResult, REDACTED, redactSecrets, scrubUrlUserinfo } from '../output.js';
import { resolveHome } from '../paths.js';
import type { CommandResult, GlobalOptions, NetworkOption } from '../types.js';
import { SUPPORTED_NETWORKS } from '../types.js';

/** Registers the `config` command group for reading and writing CLI configuration. */
export function registerConfigCommand(program: Command, globals: () => GlobalOptions): void {
  const config = program.command('config').description('Read and write CLI configuration.');
  const path = (): string => globals().config ?? defaultConfigPath(globals());
  const print = (result: CommandResult): void => console.log(formatResult(result, globals()));

  config
    .command('init')
    .description('Create a default config file with one profile per network.')
    .option('--force', 'Overwrite an existing config file.', false)
    .action((options: { force?: boolean }) => {
      const p = path();
      if (existsSync(p) && !options.force) {
        throw new CLIError(`Config already exists at ${p}. Use --force to overwrite.`, 'INVALID_ARGUMENT_ERROR', { path: p });
      }
      writeDefaultConfigFile(p);
      print({ action: 'config-init', data: { path: p } });
    });

  config
    .command('get [path]')
    .description('Print a value at a dotted path, or the whole config.')
    .option('--show-secrets', 'Reveal secret values (RPC password, etc.) instead of redacting them.', false)
    .action((dotted: string | undefined, opts: { showSecrets?: boolean }) => {
      const file = (readConfigFile(path()) ?? {}) as Record<string, unknown>;
      const raw = (dotted ? getConfigPath(file, dotted) : file) ?? null;
      const leaf = dotted ? dotted.split('.').pop() : undefined;
      print({ action: 'config-get', data: opts.showSecrets ? raw : redactSecrets(raw, leaf) });
    });

  config
    .command('set <path> <value>')
    .description('Set a value at a dotted path. The value is parsed as JSON when valid, else stored as a string.')
    .action((dotted: string, value: string) => {
      const parsed = parseValue(dotted, value);
      // Reject an invalid enum value for a known key up-front; warn (but still
      // write) an unknown path so forward-compatible and third-party keys work.
      const { unknownPath } = validateConfigSet(dotted, parsed);
      if (unknownPath && !globals().quiet) {
        console.error(`Warning: "${dotted}" is not a known config path; writing it anyway.`);
      }
      writeConfigFile(path(), raw => setConfigPath(raw, dotted, parsed));
      print({ action: 'config-set', data: { path: dotted } });
    });

  config
    .command('unset <path>')
    .description('Delete a value at a dotted path.')
    .action((dotted: string) => {
      writeConfigFile(path(), raw => unsetConfigPath(raw, dotted));
      print({ action: 'config-unset', data: { path: dotted } });
    });

  config
    .command('list')
    .alias('ls')
    .description('Print the entire config file.')
    .option('--show-secrets', 'Reveal secret values (RPC password, etc.) instead of redacting them.', false)
    .action((opts: { showSecrets?: boolean }) => {
      const file = readConfigFile(path()) ?? {};
      print({ action: 'config-list', data: opts.showSecrets ? file : redactSecrets(file) });
    });

  config
    .command('validate')
    .description('Check the config for unknown keys, invalid enum values, and an unsupported schema version.')
    .action(() => {
      // Read raw (bypassing the schema-version ceiling that readConfigFile
      // enforces) so a newer-than-supported version is reported as a finding
      // rather than aborting the very command meant to diagnose it.
      const file = parseConfigFileRaw(path()) ?? {};
      const issues = findConfigIssues(file, CONFIG_SCHEMA_VERSION);
      if (issues.length > 0) process.exitCode ??= 1;
      print({ action: 'config-validate', data: { ok: issues.length === 0, issues } });
    });

  config
    .command('effective')
    .description('Print the resolved connection config with per-value provenance (flag|env|file|default).')
    .option('-n, --network <network>', 'Network to resolve for (default: config default network)')
    .option('--show-secrets', 'Reveal secret values (RPC password) instead of redacting them.', false)
    .action((opts: { network?: string; showSecrets?: boolean }) => {
      const network = resolveIntrospectionNetwork(opts.network, globals());
      const data = resolveEffectiveConfig(network, globals());
      // Redact the resolved RPC password and any password embedded in an endpoint
      // URL by default; provenance still shows where each value came from.
      // --show-secrets reveals them for deliberate debugging.
      if (!opts.showSecrets) {
        if (data.btc.rpcPass.value !== undefined) {
          data.btc.rpcPass = { ...data.btc.rpcPass, value: REDACTED };
        }
        for (const entry of [ data.btc.rest, data.btc.rpcUrl, data.cas.gateway, data.cas.rpcUrl ]) {
          if (typeof entry.value === 'string') entry.value = scrubUrlUserinfo(entry.value);
        }
      }
      print({ action: 'config-effective', data });
    });

  config
    .command('path')
    .description('Print the resolved home directory, config-file, and keystore paths.')
    .action(() => {
      const g = globals();
      const data = {
        home     : resolveHome(g),
        config   : g.config ?? defaultConfigPath(g),
        // Diagnostic command: report the path even when the config is malformed
        // (this is a command you run to find and fix a broken config).
        keystore : resolveKeystorePath(g, { lenient: true }),
      };
      print({ action: 'config-path', data });
    });

  config
    .command('doctor')
    .description('Probe reachability of the resolved endpoints (read-only; touches the network).')
    .option('-n, --network <network>', 'Network to resolve for (default: config default network)')
    .action(async (opts: { network?: string }) => {
      const network = resolveIntrospectionNetwork(opts.network, globals());
      const report = await runDoctor(network, globals());
      if (report.checks.some(check => !check.ok)) process.exitCode ??= 1;
      print({ action: 'config-doctor', data: report });
    });
}

/**
 * Resolves the network an introspection command (`effective`/`doctor`) operates
 * on: an explicit `--network`, validated, else the config's default network.
 */
function resolveIntrospectionNetwork(explicit: string | undefined, globals: GlobalOptions): NetworkOption {
  if (explicit) {
    if (!SUPPORTED_NETWORKS.includes(explicit as NetworkOption)) {
      throw new CLIError(
        `Invalid network "${explicit}". Must be one of ${SUPPORTED_NETWORKS.join(', ')}.`,
        'INVALID_ARGUMENT_ERROR',
        { network: explicit },
      );
    }
    return explicit as NetworkOption;
  }
  return resolveDefaultNetwork(globals);
}

/**
 * Parses a `config set` value. Known scalar endpoint, credential, and defaults
 * paths are stored as raw strings so a bare `8080` is not coerced to the number
 * `8080` (which would flow into a host field as a non-string). Every other path
 * is parsed as JSON when valid, else stored as a plain string, so structured
 * values (objects, arrays, booleans, and genuinely numeric fields) still work.
 */
function parseValue(dotted: string, value: string): unknown {
  if (isStringScalarPath(dotted)) return value;
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}

/**
 * Whether a dotted config path addresses a leaf that must be stored as a string
 * (an endpoint URL, a credential, a network/profile/output name), so JSON
 * coercion never turns it into a non-string.
 */
function isStringScalarPath(dotted: string): boolean {
  const segments = dotted.split('.');

  if (segments.length === 2 && segments[0] === 'defaults') {
    return [ 'profile', 'network', 'output' ].includes(segments[1]);
  }

  if (segments.length === 3 && segments[0] === 'profiles' && segments[2] === 'network') {
    return true;
  }

  if (segments.length === 4 && segments[0] === 'profiles') {
    const group = segments[2];
    const leaf = segments[3];
    if (group === 'btc') return [ 'rest', 'rpcUrl', 'rpcUser', 'rpcPass', 'changeAddress', 'wallet' ].includes(leaf);
    if (group === 'cas') return [ 'gateway', 'rpcUrl' ].includes(leaf);
    if (group === 'identity') return [ 'keystore', 'default' ].includes(leaf);
  }

  return false;
}

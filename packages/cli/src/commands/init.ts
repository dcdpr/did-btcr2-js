import type { Command } from 'commander';
import { existsSync } from 'node:fs';
import {
  assertSupportedNetwork,
  defaultConfigPath,
  persistDefaultNetwork,
  resolveKeystorePath,
  writeDefaultConfigFile,
} from '../config.js';
import { ensureDir } from '../keystore/atomic.js';
import { initKeystore, keystoreSummary } from '../keystore/file-key-store.js';
import { acquirePassphrase } from '../keystore/passphrase.js';
import { clearSession } from '../keystore/session.js';
import { formatResult } from '../output.js';
import { defaultSessionPath, resolveHome } from '../paths.js';
import type { CommandResult, GlobalOptions, KeystoreProtectionLabel, NetworkOption } from '../types.js';

/** Options for the shared {@link runInit} scaffolding step. */
export interface RunInitOptions {
  /** Establish an UNENCRYPTED dev keystore (plaintext keys, testnet only). */
  dev?     : boolean;
  /** Re-scaffold the regenerable config even if it exists (never the keystore). */
  force?   : boolean;
  /** Explicit network from `-n/--network`, already validated. Persisted to `defaults.network`. */
  network? : NetworkOption;
  /**
   * Network to persist when `-n` is absent and `defaults.network` is unset: a
   * command's opinionated default (mutinynet for `quickstart`). Omitted by plain
   * `init`, which never persists a merely-defaulted network.
   */
  fallbackNetwork? : NetworkOption;
  /**
   * Capture the establish-time confirmed passphrase so the caller can seed a
   * session with no second prompt (`quickstart --unlock`). Only populated when a
   * fresh ENCRYPTED keystore is established in this call. Never printed.
   */
  captureEstablishedPassphrase? : boolean;
}

/** Result of the shared {@link runInit} scaffolding step. */
export interface RunInitResult {
  home       : string;
  config     : string;
  keystore   : string;
  network    : NetworkOption;
  created    : string[];
  protection : KeystoreProtectionLabel;
  /**
   * The confirmed passphrase from a fresh ENCRYPTED establishment in this call,
   * present only when {@link RunInitOptions.captureEstablishedPassphrase} was set
   * and a keystore was established. Consumed to seed a session; never printed.
   */
  establishedPassphrase? : string;
}

/**
 * The shared scaffolding step behind `btcr2 init` and `btcr2 quickstart` (ADR
 * 079/080/083): create the home, a default config if none exists, and establish
 * the keystore if none exists (encrypted by default, `--dev` for unencrypted).
 * Idempotent: existing files are left untouched, and `--force` re-scaffolds only
 * the regenerable config, never the keystore. Records `defaults.network` via
 * {@link persistDefaultNetwork}. Returns the resolved paths, network, protection,
 * and (when asked) the establish-time passphrase for session seeding.
 */
export function runInit(g: GlobalOptions, options: RunInitOptions = {}): RunInitResult {
  const home = resolveHome(g);
  const configPath = g.config ?? defaultConfigPath(g);
  const keystorePath = resolveKeystorePath(g);
  ensureDir(home, 0o700);

  const created: string[] = [];

  // The config is regenerable, so --force may re-scaffold it.
  if (!existsSync(configPath) || options.force) {
    writeDefaultConfigFile(configPath);
    created.push('config');
  }

  // The keystore holds unrecoverable secret keys, so init never overwrites an
  // existing one, even with --force: re-establishing a keystore is the explicit,
  // deliberate `keystore init --force`. init only establishes when none exists.
  const keystoreExists = existsSync(keystorePath);
  if (keystoreExists && options.force && !g.quiet) {
    process.stderr.write(
      `note: a keystore already exists at ${keystorePath} and was left intact. `
      + 'To re-establish it (discarding its keys), run "btcr2 keystore init --force".\n',
    );
  }

  let establishedPassphrase: string | undefined;
  if (!keystoreExists) {
    if (options.dev && !g.quiet) {
      process.stderr.write(
        'warning: establishing an UNENCRYPTED dev keystore. Keys are stored in plaintext. '
        + 'Use it only for disposable testnet material; mainnet operations will be refused.\n',
      );
    }
    initKeystore(keystorePath, {
      protection    : options.dev ? 'none' : 'passphrase',
      getPassphrase : (opts) => {
        const passphrase = acquirePassphrase({
          passphraseFile : g.passphraseFile,
          confirm        : opts?.confirm,
          prompt         : 'New keystore passphrase: ',
        });
        // Capture only a fresh ENCRYPTED establishment, for session seeding.
        if (options.captureEstablishedPassphrase && !options.dev) establishedPassphrase = passphrase;
        return passphrase;
      },
    });
    // A freshly established keystore mints a new verifier (or none, for --dev), so
    // any cached session holds a passphrase for a keystore that no longer exists.
    // Drop it, matching `keystore init` / `change-passphrase` (ADR 081).
    clearSession(defaultSessionPath(g));
    created.push('keystore');
  }

  // Record the network as defaults.network idempotently (ADR 083): an explicit
  // -n always writes; a merely-defaulted network writes only when the raw config
  // has none yet, so a re-run never clobbers an operator's earlier choice.
  const { network } = persistDefaultNetwork(configPath, {
    explicit  : options.network,
    fallback  : options.fallbackNetwork,
    overrides : g,
  });

  const protection = keystoreSummary(keystorePath).protection;
  return { home, config: configPath, keystore: keystorePath, network, created, protection, establishedPassphrase };
}

/**
 * Registers the top-level `btcr2 init`: the one-command entry point that creates
 * the btcr2 home (ADR 079), writes a default config if none exists, and
 * establishes the keystore if none exists (encrypted with a confirmed passphrase
 * by default, or `--dev` for an unencrypted testnet keystore). `-n/--network`
 * records `defaults.network` so later commands can drop `-n` (ADR 083).
 * Idempotent: existing files are left untouched unless `--force` is given.
 * Establishing the passphrase here, up front and confirmed, is what keeps the
 * first `key generate` off the accidental-first-seal path (ADR 080).
 */
export function registerInitCommand(program: Command, globals: () => GlobalOptions): void {
  const print = (result: CommandResult): void => console.log(formatResult(result, globals()));

  program
    .command('init')
    .description('Set up the btcr2 home: create the directory, a default config, and establish the keystore.')
    .option(
      '-n, --network <network>',
      'Bitcoin network to record as defaults.network <bitcoin|testnet3|testnet4|signet|mutinynet|regtest>',
    )
    .option('--dev', 'Establish an UNENCRYPTED dev keystore: plaintext keys, no passphrase. Testnet only.', false)
    .option('--force', 'Re-create the config even if it already exists (never the keystore).', false)
    .action((options: { network?: string; dev?: boolean; force?: boolean }) => {
      const g = globals();
      const network = options.network ? assertSupportedNetwork(options.network) : undefined;
      const result = runInit(g, { dev: options.dev, force: options.force, network });
      print({
        action : 'init',
        data   : {
          home       : result.home,
          config     : result.config,
          keystore   : result.keystore,
          network    : result.network,
          created    : result.created,
          protection : result.protection,
        },
      });
      if (!g.quiet && g.output !== 'json') {
        process.stderr.write(`btcr2 home ready at ${result.home} on ${result.network}. Next: btcr2 key generate --set-active\n`);
      }
    });
}

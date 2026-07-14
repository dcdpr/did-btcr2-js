import type { Command } from 'commander';
import { existsSync } from 'node:fs';
import { defaultConfigPath, resolveKeystorePath, writeDefaultConfigFile } from '../config.js';
import { ensureDir } from '../keystore/atomic.js';
import { initKeystore, keystoreSummary } from '../keystore/file-key-store.js';
import { acquirePassphrase } from '../keystore/passphrase.js';
import { clearSession } from '../keystore/session.js';
import { formatResult } from '../output.js';
import { defaultSessionPath, resolveHome } from '../paths.js';
import type { CommandResult, GlobalOptions } from '../types.js';

/**
 * Registers the top-level `btcr2 init`: the one-command entry point that creates
 * the btcr2 home (ADR 079), writes a default config if none exists, and
 * establishes the keystore if none exists (encrypted with a confirmed passphrase
 * by default, or `--dev` for an unencrypted testnet keystore). Idempotent:
 * existing files are left untouched unless `--force` is given. Establishing the
 * passphrase here, up front and confirmed, is what keeps the first `key generate`
 * off the accidental-first-seal path (ADR 080).
 */
export function registerInitCommand(program: Command, globals: () => GlobalOptions): void {
  const print = (result: CommandResult): void => console.log(formatResult(result, globals()));

  program
    .command('init')
    .description('Set up the btcr2 home: create the directory, a default config, and establish the keystore.')
    .option('--dev', 'Establish an UNENCRYPTED dev keystore: plaintext keys, no passphrase. Testnet only.', false)
    .option('--force', 'Re-create the config and keystore even if they already exist.', false)
    .action((options: { dev?: boolean; force?: boolean }) => {
      const g = globals();
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

      // The keystore holds unrecoverable secret keys, so `init` never overwrites
      // an existing one, even with --force: re-establishing a keystore is the
      // explicit, deliberate `keystore init --force`. `init` only establishes a
      // keystore when none exists.
      const keystoreExists = existsSync(keystorePath);
      if (keystoreExists && options.force && !g.quiet) {
        process.stderr.write(
          `note: a keystore already exists at ${keystorePath} and was left intact. `
          + 'To re-establish it (discarding its keys), run "btcr2 keystore init --force".\n',
        );
      }
      if (!keystoreExists) {
        if (options.dev && !g.quiet) {
          process.stderr.write(
            'warning: establishing an UNENCRYPTED dev keystore. Keys are stored in plaintext. '
            + 'Use it only for disposable testnet material; mainnet operations will be refused.\n',
          );
        }
        initKeystore(keystorePath, {
          protection    : options.dev ? 'none' : 'passphrase',
          getPassphrase : (opts) => acquirePassphrase({ passphraseFile: g.passphraseFile, confirm: opts?.confirm, prompt: 'New keystore passphrase: ' }),
        });
        // A freshly established keystore mints a new verifier (or none, for --dev),
        // so any cached session holds a passphrase for a keystore that no longer
        // exists. Drop it, matching `keystore init` / `change-passphrase`, rather
        // than leave a stale plaintext passphrase behind (ADR 081).
        clearSession(defaultSessionPath(g));
        created.push('keystore');
      }

      const protection = keystoreSummary(keystorePath).protection;
      print({ action: 'init', data: { home, config: configPath, keystore: keystorePath, created, protection } });
      if (!g.quiet && g.output !== 'json') {
        process.stderr.write(`btcr2 home ready at ${home}. Next: btcr2 key generate --set-active\n`);
      }
    });
}

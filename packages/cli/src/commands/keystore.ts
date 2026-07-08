import type { Command } from 'commander';
import { existsSync } from 'node:fs';
import { resolveKeystorePath } from '../config.js';
import { CLIError } from '../error.js';
import { changeKeystorePassphrase, initKeystore, keystoreSummary } from '../keystore/file-key-store.js';
import { acquirePassphrase } from '../keystore/passphrase.js';
import { formatResult } from '../output.js';
import type { CommandResult, GlobalOptions } from '../types.js';

/**
 * Registers the `keystore` command group: establish, inspect, and re-key the
 * encrypted keystore (ADR 080). These operate on the keystore file directly (no
 * Bitcoin connection or KeyManager) and never decrypt a key except when
 * re-sealing during `change-passphrase`.
 */
export function registerKeystoreCommand(program: Command, globals: () => GlobalOptions): void {
  const keystore = program.command('keystore').description('Establish, inspect, and re-key the keystore.');
  const print = (result: CommandResult): void => console.log(formatResult(result, globals()));

  keystore
    .command('init')
    .description('Establish the keystore (encrypted by default). Prompts for a passphrase and confirms it.')
    .option('--dev', 'Create an UNENCRYPTED dev keystore: plaintext keys, no passphrase. Testnet only; mainnet operations are refused.', false)
    .option('--force', 'Re-establish even if a keystore already exists (discards its keys).', false)
    .action((options: { dev?: boolean; force?: boolean }) => {
      const g = globals();
      const path = resolveKeystorePath(g);
      if (existsSync(path) && !options.force) {
        throw new CLIError(
          `A keystore already exists at ${path}. Use --force to re-establish it (this discards its keys).`,
          'INVALID_ARGUMENT_ERROR',
          { path },
        );
      }
      // --force re-establishes over an existing keystore; make the key loss loud.
      if (existsSync(path) && options.force && !g.quiet) {
        const { keyCount } = keystoreSummary(path);
        if (keyCount > 0) {
          process.stderr.write(
            `warning: re-establishing the keystore at ${path} permanently discards its ${keyCount} existing key(s).\n`,
          );
        }
      }
      if (options.dev && !g.quiet) {
        process.stderr.write(
          'warning: creating an UNENCRYPTED dev keystore. Keys are stored in plaintext. '
          + 'Use it only for disposable testnet material; mainnet operations will be refused.\n',
        );
      }
      initKeystore(path, {
        protection    : options.dev ? 'none' : 'passphrase',
        getPassphrase : (opts) => acquirePassphrase({ passphraseFile: g.passphraseFile, confirm: opts?.confirm, prompt: 'New keystore passphrase: ' }),
      });
      print({ action: 'keystore-init', data: { path, protection: options.dev ? 'dev' : 'encrypted' } });
    });

  keystore
    .command('status')
    .description('Show the keystore path, protection mode, and key count. Never decrypts or prompts.')
    .action(() => {
      const g = globals();
      // Diagnostic command: report status even when the config is malformed,
      // rather than crashing on the config you ran this to inspect.
      const path = resolveKeystorePath(g, { lenient: true });
      const summary = keystoreSummary(path);
      if (summary.protection === 'dev' && !g.quiet && g.output !== 'json') {
        process.stderr.write('warning: this is an UNENCRYPTED dev keystore; keys are stored in plaintext.\n');
      }
      print({ action: 'keystore-status', data: { path, ...summary } });
    });

  keystore
    .command('change-passphrase')
    .alias('passwd')
    .description('Change the keystore passphrase, re-sealing every key under the new one. Encrypted keystores only.')
    .action(() => {
      const g = globals();
      const path = resolveKeystorePath(g);
      const summary = keystoreSummary(path);
      if (summary.protection === 'absent') {
        throw new CLIError(`No keystore at ${path}. Run "btcr2 keystore init" first.`, 'INVALID_ARGUMENT_ERROR', { path });
      }
      if (summary.protection === 'dev') {
        throw new CLIError(
          `The keystore at ${path} is an unencrypted dev keystore; there is no passphrase to change.`,
          'INVALID_ARGUMENT_ERROR',
          { path },
        );
      }
      // Current passphrase may come from the env var / file (unattended); the new
      // one must be entered fresh (forcePrompt) so it cannot be silently satisfied
      // by the same source and make the change a no-op.
      const oldPassphrase = acquirePassphrase({ passphraseFile: g.passphraseFile, prompt: 'Current keystore passphrase: ' });
      const newPassphrase = acquirePassphrase({ forcePrompt: true, confirm: true, prompt: 'New keystore passphrase: ' });
      const rekeyed = changeKeystorePassphrase(path, oldPassphrase, newPassphrase);
      print({ action: 'keystore-change-passphrase', data: { path, rekeyed } });
    });
}

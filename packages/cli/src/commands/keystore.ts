import type { Command } from 'commander';
import { existsSync } from 'node:fs';
import { resolveDefaultNetwork, resolveKeystorePath } from '../config.js';
import { CLIError } from '../error.js';
import {
  changeKeystorePassphrase,
  initKeystore,
  keystoreSummary,
  keystoreVerifierId,
  verifyKeystorePassphrase,
} from '../keystore/file-key-store.js';
import { acquirePassphrase } from '../keystore/passphrase.js';
import {
  clearSession,
  DEFAULT_SESSION_TTL_MS,
  ENV_KEYSTORE_TTL,
  MAX_SESSION_TTL_MS,
  parseTtlToMs,
  readSessionStatus,
  writeSession,
} from '../keystore/session.js';
import { formatResult } from '../output.js';
import { defaultSessionPath } from '../paths.js';
import { blankToUndef, type CommandResult, type GlobalOptions } from '../types.js';

/**
 * Registers the `keystore` command group: establish, inspect, and re-key the
 * encrypted keystore (ADR 080), plus the session unlock agent (ADR 081). These
 * operate on the keystore and session files directly (no Bitcoin connection or
 * KeyManager) and never decrypt a key except when re-sealing during
 * `change-passphrase`.
 */
export function registerKeystoreCommand(program: Command, globals: () => GlobalOptions): void {
  const keystore = program.command('keystore').description('Establish, inspect, re-key, and unlock the keystore.');
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
      // A re-established keystore mints a new verifier (or none, for --dev), so any
      // cached session now holds a passphrase for a keystore that no longer exists.
      // Drop it rather than leave a stale plaintext passphrase behind (ADR 081).
      clearSession(defaultSessionPath(g));
      print({ action: 'keystore-init', data: { path, protection: options.dev ? 'dev' : 'encrypted' } });
    });

  keystore
    .command('status')
    .description('Show the keystore path, protection mode, key count, and session state. Never decrypts or prompts.')
    .action(() => {
      const g = globals();
      // Diagnostic command: report status even when the config is malformed,
      // rather than crashing on the config you ran this to inspect.
      const path = resolveKeystorePath(g, { lenient: true });
      const summary = keystoreSummary(path);
      const session = readSessionStatus(defaultSessionPath(g), path, keystoreVerifierId(path));
      if (summary.protection === 'dev' && !g.quiet && g.output !== 'json') {
        process.stderr.write('warning: this is an UNENCRYPTED dev keystore; keys are stored in plaintext.\n');
      }
      print({ action: 'keystore-status', data: { path, ...summary, session } });
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
      // The rotated verifier already invalidates a cached session by fingerprint,
      // but the session file still holds the OLD passphrase in plaintext; delete it.
      clearSession(defaultSessionPath(g));
      print({ action: 'keystore-change-passphrase', data: { path, rekeyed } });
    });

  keystore
    .command('unlock')
    .description('Cache the keystore passphrase for a session so later commands do not re-prompt (ADR 081).')
    .option('--ttl <duration>', `Session lifetime: bare seconds or an s/m/h suffix (default 1h, max 24h). Also $${ENV_KEYSTORE_TTL}.`)
    .option('--allow-mainnet', 'Permit unlocking when the active network is mainnet (bitcoin); this suspends per-use passphrase auth for the session.', false)
    .action((options: { ttl?: string; allowMainnet?: boolean }) => {
      const g = globals();
      const path = resolveKeystorePath(g);
      const summary = keystoreSummary(path);
      if (summary.protection === 'absent') {
        throw new CLIError(`No keystore at ${path}. Run "btcr2 init" or "btcr2 keystore init" first.`, 'INVALID_ARGUMENT_ERROR', { path });
      }
      if (summary.protection === 'dev') {
        throw new CLIError(
          `The keystore at ${path} is an unencrypted dev keystore; it has no passphrase to cache, so no unlock is needed.`,
          'INVALID_ARGUMENT_ERROR',
          { path },
        );
      }
      if (!summary.established) {
        throw new CLIError(
          `The keystore at ${path} has no passphrase established yet. `
          + 'Establish one with "btcr2 keystore init" or the first "btcr2 key generate".',
          'INVALID_ARGUMENT_ERROR',
          { path },
        );
      }
      // An unlocked encrypted keystore signs prompt-free for the whole TTL,
      // silently removing per-use passphrase auth. Two guards, both keyed to
      // --allow-mainnet (ADR 081): this early refusal when the *configured* default
      // network is mainnet (a clear signal before caching anything), plus the
      // authoritative one at consumption, where the session records `allowMainnet`
      // (below) and a `bitcoin` operation, whose network is derived from the DID
      // rather than the config, is withheld from a session that lacks it. The
      // active network defaults to a testnet, so this early refusal never fires
      // for the demo.
      if (!options.allowMainnet && resolveDefaultNetwork(g) === 'bitcoin') {
        throw new CLIError(
          `Refusing to unlock for a mainnet (bitcoin) context: caching the passphrase suspends per-use `
          + 'authentication for the session. Pass --allow-mainnet to override, or keep signing mainnet '
          + 'updates with a per-use passphrase prompt.',
          'MAINNET_UNLOCK_REFUSED_ERROR',
          { path },
        );
      }
      const ttlMs = resolveSessionTtl(options.ttl);
      // Acquire the passphrase directly (env / file / prompt) with NO session
      // consultation and NO confirm, verify it against the keystore verifier, and
      // only then cache it. A wrong passphrase writes no session file.
      const passphrase = acquirePassphrase({ passphraseFile: g.passphraseFile, prompt: 'Keystore passphrase: ' });
      if (!verifyKeystorePassphrase(path, passphrase)) {
        throw new CLIError(`Incorrect passphrase for the keystore at ${path}; no session was created.`, 'DECRYPT_ERROR', { path });
      }
      const verifierId = keystoreVerifierId(path);
      if (!verifierId) {
        // An established keystore always carries a verifier; defensive guard.
        throw new CLIError(`The keystore at ${path} has no verifier to bind a session to.`, 'INVALID_ARGUMENT_ERROR', { path });
      }
      const session = writeSession(defaultSessionPath(g), {
        keystorePath : path,
        verifierId,
        passphrase,
        ttlMs,
        allowMainnet : !!options.allowMainnet,
      });
      print({ action: 'keystore-unlock', data: { keystore: path, expiresAt: session.expiresAt, ttlSeconds: session.ttlSeconds } });
    });

  keystore
    .command('lock')
    .description('Revoke the cached session so later commands prompt for the passphrase again (ADR 081).')
    .action(() => {
      const g = globals();
      // Resolve the session from the home only (defaultSessionPath never reads the
      // config), so lock revokes even under a malformed config.
      const sessionPath = defaultSessionPath(g);
      const cleared = clearSession(sessionPath);
      print({ action: 'keystore-lock', data: { path: sessionPath, cleared } });
    });
}

/**
 * Resolves the session TTL in milliseconds from the `--ttl` flag, then
 * `$BTCR2_KEYSTORE_TTL`, then the one-hour default. Rejects a non-positive,
 * malformed, or over-24h value with a {@link CLIError} that names the actual
 * source (the flag or the env var) so the operator fixes the right input.
 */
function resolveSessionTtl(flag?: string): number {
  const fromFlag = blankToUndef(flag);
  const raw = fromFlag ?? blankToUndef(process.env[ENV_KEYSTORE_TTL]);
  if (raw === undefined) return DEFAULT_SESSION_TTL_MS;
  const source = fromFlag !== undefined ? '--ttl' : `$${ENV_KEYSTORE_TTL}`;
  const ms = parseTtlToMs(raw);
  if (ms === undefined || ms <= 0) {
    throw new CLIError(
      `Invalid ${source} "${raw}": expected seconds or a value with an s/m/h suffix, e.g. 3600, 45m, or 2h.`,
      'INVALID_ARGUMENT_ERROR',
      { value: raw, source },
    );
  }
  if (ms > MAX_SESSION_TTL_MS) {
    throw new CLIError(
      `${source} "${raw}" exceeds the 24h maximum for a cached passphrase.`,
      'INVALID_ARGUMENT_ERROR',
      { value: raw, source },
    );
  }
  return ms;
}

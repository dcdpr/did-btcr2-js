import { readFileSync, readSync } from 'node:fs';
import { KeyStoreError } from './error.js';

/** Environment variable that supplies the keystore passphrase for unattended use. */
export const ENV_KEYSTORE_PASSPHRASE = 'BTCR2_KEYSTORE_PASSPHRASE';

/** Options controlling how a passphrase is acquired. */
export type PassphraseOptions = {
  /** Path to a file whose contents (a trailing newline is trimmed) are the passphrase. */
  passphraseFile?: string;
  /** Prompt label shown on a terminal. */
  prompt?: string;
  /** When true, prompt twice and require the entries to match (for a new keystore). */
  confirm?: boolean;
  /**
   * When true, skip the environment variable and passphrase file and require a
   * fresh terminal entry. Used for the *new* passphrase in `change-passphrase`,
   * where the env var / file holds the *current* passphrase and must not silently
   * satisfy the new one (which would make the change a no-op).
   */
  forcePrompt?: boolean;
  /**
   * An optional non-interactive source consulted *after* the env var and
   * passphrase file and *before* the terminal prompt (and before the "no TTY"
   * failure). The session unlock agent (ADR 081) wires this to a cached
   * passphrase, so a returning command consumes the session instead of
   * prompting, and a non-interactive follow-on command does not hard-fail. It
   * returns `undefined` when no session is available. Skipped when `forcePrompt`
   * is set, and never wired during passphrase establishment (`confirm`).
   */
  beforePrompt?: () => string | undefined;
};

/**
 * Acquires a passphrase without ever reading it from a command-line flag value
 * (which would leak into process listings and shell history). Resolution order:
 * the {@link ENV_KEYSTORE_PASSPHRASE} environment variable, a passphrase file,
 * then a non-echoing terminal prompt. Throws if none is available and standard
 * input is not a terminal. When `forcePrompt` is set, the env var and file are
 * skipped and a terminal entry is required.
 */
export function acquirePassphrase(options: PassphraseOptions = {}): string {
  // All sources are normalized identically (at most one trailing newline
  // removed) so the KDF input is source-independent.
  if (!options.forcePrompt) {
    const fromEnv = process.env[ENV_KEYSTORE_PASSPHRASE];
    if (fromEnv) return assertNonEmpty(fromEnv.replace(/\r?\n$/, ''));

    if (options.passphraseFile) {
      return assertNonEmpty(readFileSync(options.passphraseFile, 'utf-8').replace(/\r?\n$/, ''));
    }

    // A cached session (ADR 081) sits below the env var and file but above the
    // interactive prompt, so it is consulted before the "no TTY" failure: a
    // scripted or piped follow-on command consumes the session instead of
    // hard-failing. Establishment never reaches here (its caller omits it).
    //
    // The session already holds the exact, keystore-verified passphrase (encoded
    // and decoded byte-for-byte), not a raw source needing newline normalization.
    // Return it verbatim: re-stripping a trailing newline here would corrupt the
    // KDF input for a passphrase that legitimately ends in one, even though unlock
    // itself succeeded. assertNonEmpty is a defensive guard only.
    const fromSession = options.beforePrompt?.();
    if (fromSession) return assertNonEmpty(fromSession);
  }

  if (!process.stdin.isTTY) {
    throw new KeyStoreError(
      `No passphrase available. Set ${ENV_KEYSTORE_PASSPHRASE}, pass --passphrase-file, or run in a terminal.`,
      'PASSPHRASE_REQUIRED_ERROR',
    );
  }

  const passphrase = promptHidden(options.prompt ?? 'Keystore passphrase: ');
  if (options.confirm) {
    const again = promptHidden('Confirm passphrase: ');
    if (passphrase !== again) {
      throw new KeyStoreError('Passphrases did not match.', 'PASSPHRASE_MISMATCH_ERROR');
    }
  }
  return assertNonEmpty(passphrase);
}

/** Rejects an empty or whitespace-only passphrase, which would seal the keystore with no protection. */
function assertNonEmpty(passphrase: string): string {
  if (passphrase.trim() === '') {
    throw new KeyStoreError('A non-empty keystore passphrase is required.', 'PASSPHRASE_REQUIRED_ERROR');
  }
  return passphrase;
}

/**
 * A 4-byte shared buffer used only as an {@link Atomics.wait} target. It lets
 * {@link promptHidden} block briefly on an empty non-blocking TTY instead of
 * busy-spinning. It is never written to, so the wait always times out.
 */
const IDLE_WAIT = new Int32Array(new SharedArrayBuffer(4));

/**
 * Milliseconds to block on each empty read. Imperceptible to a typist yet long
 * enough that an open prompt sits idle rather than pegging a CPU core.
 */
const IDLE_POLL_MS = 20;

/**
 * Removes the last whole UTF-8 character from an accumulating byte array in
 * place: pops any trailing continuation bytes (0b10xxxxxx) then the leading
 * byte. Exported for testing; a backspace mid-entry must not strand a fragment
 * that later decodes to U+FFFD.
 */
export function dropLastUtf8Char(bytes: number[]): void {
  while (bytes.length > 0 && (bytes[bytes.length - 1] & 0xc0) === 0x80) bytes.pop();
  bytes.pop();
}

/**
 * Reads a line from the terminal synchronously without echoing keystrokes.
 * Bytes are accumulated and decoded as UTF-8 so multibyte passphrases survive,
 * including a backspace that spans a whole multibyte character.
 * This path runs only when standard input is a terminal.
 */
function promptHidden(label: string): string {
  process.stderr.write(label);
  const stdin = process.stdin;
  const wasRaw = stdin.isRaw ?? false;
  stdin.setRawMode(true);
  const byte = Buffer.alloc(1);
  const bytes: number[] = [];
  try {
    for (;;) {
      let read = 0;
      try {
        read = readSync(stdin.fd, byte, 0, 1, null);
      } catch (error) {
        const code = (error as { code?: string }).code;
        if (code === 'EAGAIN') {
          // No byte ready yet on a non-blocking TTY. Block briefly instead of
          // spinning so an open prompt does not peg a CPU core while it waits.
          Atomics.wait(IDLE_WAIT, 0, 0, IDLE_POLL_MS);
          continue;
        }
        if (code === 'EOF') break;
        throw error;
      }
      if (read === 0) break;
      const ch = byte[0];
      if (ch === 0x0a || ch === 0x0d) break; // LF or CR ends the line
      if (ch === 0x03) { // Ctrl-C aborts
        throw new KeyStoreError('Passphrase entry aborted.', 'PASSPHRASE_REQUIRED_ERROR');
      }
      if (ch === 0x7f || ch === 0x08) { // DEL or backspace
        dropLastUtf8Char(bytes);
        continue;
      }
      bytes.push(ch);
    }
  } finally {
    stdin.setRawMode(wasRaw);
    process.stderr.write('\n');
  }
  return Buffer.from(bytes).toString('utf-8');
}

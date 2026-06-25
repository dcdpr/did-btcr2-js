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
};

/**
 * Acquires a passphrase without ever reading it from a command-line flag value
 * (which would leak into process listings and shell history). Resolution order:
 * the {@link ENV_KEYSTORE_PASSPHRASE} environment variable, a passphrase file,
 * then a non-echoing terminal prompt. Throws if none is available and standard
 * input is not a terminal.
 */
export function acquirePassphrase(options: PassphraseOptions = {}): string {
  // All sources are normalized identically (at most one trailing newline
  // removed) so the KDF input is source-independent.
  const fromEnv = process.env[ENV_KEYSTORE_PASSPHRASE];
  if (fromEnv) return assertNonEmpty(fromEnv.replace(/\r?\n$/, ''));

  if (options.passphraseFile) {
    return assertNonEmpty(readFileSync(options.passphraseFile, 'utf-8').replace(/\r?\n$/, ''));
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
 * Reads a line from the terminal synchronously without echoing keystrokes.
 * Bytes are accumulated and decoded as UTF-8 so multibyte passphrases survive.
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
        if (code === 'EAGAIN') continue; // no byte ready yet on a non-blocking TTY
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
        bytes.pop();
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

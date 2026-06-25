import { chmodSync, mkdirSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { KeyStoreError } from './error.js';

const isWindows = process.platform === 'win32';
let permsWarned = false;
let tmpCounter = 0;

/**
 * Creates a directory (recursively) and, on POSIX systems, tightens it to the
 * requested mode. `mkdir`'s mode is subject to the umask, so it is reapplied
 * with an explicit `chmod`.
 */
export function ensureDir(dir: string, mode: number): void {
  mkdirSync(dir, { recursive: true, mode });
  if (!isWindows) {
    try {
      chmodSync(dir, mode);
    } catch {
      // A pre-existing directory we do not own cannot be re-moded; best effort.
    }
  }
}

/**
 * Writes a file atomically: serialize to a sibling temporary file, tighten its
 * permissions, then rename over the target so a crash mid-write cannot leave a
 * truncated or partially-written file. The temporary file is removed on failure.
 */
export function writeFileAtomic(path: string, data: string, mode: number): void {
  const tmp = join(dirname(path), `.${basename(path)}.${process.pid}.${tmpCounter++}.tmp`);
  try {
    writeFileSync(tmp, data, { mode });
    if (!isWindows) chmodSync(tmp, mode);
    renameSync(tmp, path);
  } catch (error) {
    try {
      rmSync(tmp, { force: true });
    } catch {
      // Ignore cleanup failure; surface the original write error.
    }
    throw new KeyStoreError(
      `Failed to write keystore at ${path}.`,
      'ATOMIC_WRITE_ERROR',
      { path, cause: error instanceof Error ? error.message : String(error) },
    );
  }
}

/**
 * Fails closed if a keystore file is readable or writable by group or other.
 * On Windows, where POSIX mode bits are not enforced, this is a no-op that
 * warns once on standard error.
 */
export function assertSecurePerms(path: string): void {
  if (isWindows) {
    if (!permsWarned) {
      process.stderr.write(
        'warning: file permissions are not enforced on Windows; protect the keystore directory manually.\n',
      );
      permsWarned = true;
    }
    return;
  }
  const mode = statSync(path).mode & 0o777;
  if ((mode & 0o077) !== 0) {
    throw new KeyStoreError(
      `Keystore at ${path} has insecure permissions 0${mode.toString(8)}; expected 0600.`,
      'KEYSTORE_PERMISSION_ERROR',
      { path, mode: `0${mode.toString(8)}` },
    );
  }
}

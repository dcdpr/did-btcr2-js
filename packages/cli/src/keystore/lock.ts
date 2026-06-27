import { closeSync, openSync, readFileSync, rmSync, statSync, writeSync } from 'node:fs';
import { KeyStoreError } from './error.js';

/** Tuning for {@link withFileLock}; all values are milliseconds. */
export interface LockOptions {
  /** Maximum total time to wait to acquire the lock before failing. Default 10000. */
  timeoutMs?: number;
  /** A held lock older than this, or whose writer process is gone, is treated as abandoned and broken. Default 30000. */
  staleMs?: number;
  /** Poll interval between acquisition attempts while the lock is held. Default 50. */
  retryMs?: number;
}

const DEFAULT_TIMEOUT_MS = 10_000;
const DEFAULT_STALE_MS = 30_000;
const DEFAULT_RETRY_MS = 50;

// A per-process counter so a lock token is unambiguous even when one process
// runs several stores over the same path (as the tests do): the pid alone would
// collide, the pid plus counter never does.
let tokenCounter = 0;

/**
 * Sleeps synchronously for `ms` without spinning the CPU. The keystore store is
 * a synchronous interface, so the wait must block the thread rather than yield a
 * promise. `Atomics.wait` on a private buffer no other thread can notify always
 * runs the full duration. Node-only, which the keystore already is.
 */
function sleepSync(ms: number): void {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

/**
 * Reports whether a process is still running. `process.kill(pid, 0)` sends no
 * signal but performs the existence/permission check: ESRCH means the process
 * is gone, EPERM means it exists under another user (still alive).
 */
function isProcessAlive(pid: number): boolean {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as { code?: string }).code === 'EPERM';
  }
}

/**
 * Removes the lock if its writer process is gone or it has aged past `staleMs`,
 * so a process that crashed mid-mutation cannot wedge the keystore permanently.
 * Returns true when the lock was broken or had already vanished (caller should
 * retry the create immediately), false when a live, fresh holder still owns it.
 */
function breakIfStale(lockPath: string, staleMs: number): boolean {
  let ageMs: number;
  let pid: number;
  try {
    const stat = statSync(lockPath);
    ageMs = Date.now() - stat.mtimeMs;
    pid = Number.parseInt(readFileSync(lockPath, 'utf-8').split('.')[0] ?? '', 10);
  } catch {
    // The lock disappeared between our failed create and this inspection; the
    // caller can race for it again straight away.
    return true;
  }
  if (ageMs > staleMs || !isProcessAlive(pid)) {
    try {
      rmSync(lockPath, { force: true });
    } catch {
      // Another waiter broke it first; either way it is gone, so retry.
    }
    return true;
  }
  return false;
}

/** Releases the lock only while it still holds our token, never one broken from us as stale. */
function releaseIfOwner(lockPath: string, token: string): void {
  try {
    if (readFileSync(lockPath, 'utf-8') === token) rmSync(lockPath, { force: true });
  } catch {
    // Already removed (broken as stale, or never created); nothing to release.
  }
}

/**
 * Runs `fn` while holding an exclusive, cross-process advisory lock on
 * `lockPath`, then releases it.
 *
 * The lock is an `O_EXCL` lockfile: creating it fails when another holder
 * exists, which serializes mutators across separate `btcr2` processes. This is
 * the missing half of a safe read-modify-write on the keystore file: an atomic
 * rename keeps the file from tearing, but only mutual exclusion (paired with a
 * reload inside the lock) keeps two concurrent writers from clobbering each
 * other's changes. A lock whose writer has died, or that has aged past
 * `staleMs`, is broken so a crash cannot deadlock future invocations.
 *
 * @throws {KeyStoreError} `KEYSTORE_LOCKED_ERROR` if the lock cannot be acquired
 *   within `timeoutMs`, or `KEYSTORE_LOCK_ERROR` on an unexpected filesystem error.
 */
export function withFileLock<T>(lockPath: string, fn: () => T, options: LockOptions = {}): T {
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const staleMs = options.staleMs ?? DEFAULT_STALE_MS;
  const retryMs = options.retryMs ?? DEFAULT_RETRY_MS;
  const token = `${process.pid}.${tokenCounter++}`;
  const deadline = Date.now() + timeoutMs;

  for (;;) {
    try {
      const fd = openSync(lockPath, 'wx', 0o600);
      try {
        writeSync(fd, token);
      } finally {
        closeSync(fd);
      }
      break;
    } catch (error) {
      if ((error as { code?: string }).code !== 'EEXIST') {
        throw new KeyStoreError(
          `Failed to acquire keystore lock at ${lockPath}.`,
          'KEYSTORE_LOCK_ERROR',
          { lockPath, cause: error instanceof Error ? error.message : String(error) },
        );
      }
      if (breakIfStale(lockPath, staleMs)) continue;
      if (Date.now() >= deadline) {
        throw new KeyStoreError(
          `Timed out after ${timeoutMs}ms waiting for the keystore lock at ${lockPath}. `
          + 'Another btcr2 process may be writing; retry, or remove the lock file if no other process is running.',
          'KEYSTORE_LOCKED_ERROR',
          { lockPath, timeoutMs },
        );
      }
      sleepSync(retryMs);
    }
  }

  try {
    return fn();
  } finally {
    releaseIfOwner(lockPath, token);
  }
}

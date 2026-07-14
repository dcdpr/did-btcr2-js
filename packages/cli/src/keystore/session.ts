import { closeSync, constants, existsSync, fstatSync, openSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { utf8ToBytes } from '@noble/hashes/utils.js';
import { base64urlnopad } from '@scure/base';
import { ensureDir, writeFileAtomic } from './atomic.js';

/**
 * The session unlock agent (ADR 081). `keystore unlock` caches the verified
 * keystore passphrase in a single `<home>/session.json`, and subsequent commands
 * read it in place of a prompt until it expires or `keystore lock` revokes it.
 *
 * This is an on-disk v1 design. The cached passphrase is base64url-*encoded*, not
 * encrypted: its only protection at rest is the file's `0600` mode. That is the
 * deliberate, documented cost of a portable, minimal-diff convenience; a future
 * in-memory agent (v2) that never persists the secret is the real fix. Every read
 * here is defensive and never throws, so a bad or hostile session degrades to a
 * passphrase prompt rather than a crash.
 */

/** Current session-file format version. */
export const SESSION_VERSION = 1 as const;

/** Default session lifetime: one hour. */
export const DEFAULT_SESSION_TTL_MS = 60 * 60 * 1000;
/** Hard cap on a cached-passphrase lifetime: 24 hours. A longer TTL is refused. */
export const MAX_SESSION_TTL_MS = 24 * 60 * 60 * 1000;
/** Environment variable supplying a default TTL below the `--ttl` flag. */
export const ENV_KEYSTORE_TTL = 'BTCR2_KEYSTORE_TTL';

/**
 * The on-disk session file. `passphrase` is base64url(utf8(passphrase)): an
 * encoding, not encryption. `keystore` binds the session to one keystore, and
 * `verifierId` (a hash of that keystore's verifier) invalidates the session when
 * the passphrase is rotated. `allowMainnet` records whether the operator unlocked
 * with `--allow-mainnet`; a session without it is withheld from a `bitcoin`
 * operation so mainnet keeps per-use authentication (ADR 081). No derived key,
 * keystore ciphertext, or signing-key bytes ever appear here.
 */
export interface SessionFile {
  v            : typeof SESSION_VERSION;
  keystore     : string;
  verifierId   : string;
  passphrase   : string;
  allowMainnet : boolean;
  createdAt    : number;
  expiresAt    : number;
  ttlSeconds   : number;
}

/** Inputs for {@link writeSession}. */
export interface WriteSessionInput {
  /** The keystore this session unlocks (stored resolved/normalized). */
  keystorePath  : string;
  /** Fingerprint of the keystore verifier, from `keystoreVerifierId`. */
  verifierId    : string;
  /** The verified passphrase to cache. */
  passphrase    : string;
  /** Lifetime in milliseconds. */
  ttlMs         : number;
  /**
   * Whether this session may be consumed for a mainnet (`bitcoin`) operation,
   * from the `unlock --allow-mainnet` flag. Defaults to `false` (deny), so
   * mainnet operations fall through to a per-use passphrase prompt (ADR 081).
   */
  allowMainnet? : boolean;
}

/**
 * Writes the session file atomically at `0600` (temp sibling + rename), returning
 * the written record so the caller can report expiry without re-reading. The
 * caller is responsible for verifying the passphrase first; this only persists it.
 */
export function writeSession(sessionPath: string, input: WriteSessionInput): SessionFile {
  const createdAt = Date.now();
  const session: SessionFile = {
    v            : SESSION_VERSION,
    keystore     : resolve(input.keystorePath),
    verifierId   : input.verifierId,
    passphrase   : base64urlnopad.encode(utf8ToBytes(input.passphrase)),
    allowMainnet : input.allowMainnet ?? false,
    createdAt,
    expiresAt    : createdAt + input.ttlMs,
    ttlSeconds   : Math.round(input.ttlMs / 1000),
  };
  ensureDir(dirname(sessionPath), 0o700);
  writeFileAtomic(sessionPath, `${JSON.stringify(session, null, 2)}\n`, 0o600);
  return session;
}

/**
 * Deletes the session file and any crash-orphaned `writeFileAtomic` temp sibling
 * (each of which would hold a plaintext passphrase). Idempotent; needs no
 * passphrase. Returns whether a session file was present. Unlink is best-effort:
 * it removes the name, it does not securely erase the bytes (see ADR 081).
 */
export function clearSession(sessionPath: string): boolean {
  let existed = false;
  try {
    existed = existsSync(sessionPath);
    if (existed) rmSync(sessionPath, { force: true });
  } catch {
    // Best effort: a session we cannot remove is reported as not-cleared below.
    existed = false;
  }
  sweepSessionTemps(sessionPath);
  return existed;
}

/** Removes `.session.json.<pid>.<n>.tmp` leftovers from an interrupted atomic write. */
function sweepSessionTemps(sessionPath: string): void {
  const dir = dirname(sessionPath);
  const prefix = `.${basename(sessionPath)}.`;
  try {
    for (const name of readdirSync(dir)) {
      if (name.startsWith(prefix) && name.endsWith('.tmp')) {
        try {
          rmSync(join(dir, name), { force: true });
        } catch {
          // A temp file we cannot remove is left for the next sweep.
        }
      }
    }
  } catch {
    // Directory unreadable or absent: nothing to sweep.
  }
}

/**
 * Returns the cached passphrase for `keystorePath` when a live, matching session
 * exists, else `undefined`. Never throws. A session that is expired, stale (the
 * keystore passphrase rotated), future-dated, or malformed is pruned on read; a
 * live session bound to a *different* keystore is left in place (it prompts for
 * the current keystore instead).
 *
 * `isMainnetOperation` gates the one case the network is known at consumption: a
 * live session that was not unlocked with `--allow-mainnet` is withheld from a
 * `bitcoin` operation (returning `undefined` so the caller falls through to a
 * per-use prompt) but *not* pruned, since it remains valid for the non-mainnet
 * operations the operator unlocked for (ADR 081).
 */
export function readLiveSessionPassphrase(
  sessionPath        : string,
  keystorePath       : string,
  currentVerifierId  : string | undefined,
  isMainnetOperation = false,
): string | undefined {
  const verdict = evaluateSession(sessionPath, keystorePath, currentVerifierId, Date.now());
  if (verdict.status === 'live') {
    // Withhold a session lacking mainnet allowance from a mainnet operation, so
    // signing a `bitcoin` DID still authenticates per use. Leave it in place: it
    // is a valid session, just not for this operation (like a foreign keystore).
    if (isMainnetOperation && !verdict.session.allowMainnet) return undefined;
    try {
      return Buffer.from(base64urlnopad.decode(verdict.session.passphrase)).toString('utf-8');
    } catch {
      clearSession(sessionPath);
      return undefined;
    }
  }
  // Prune a session that is dead for everyone or dead for this keystore. A
  // 'foreign' (live, different keystore) or 'none' session is left untouched.
  if (verdict.status === 'expired' || verdict.status === 'stale'
    || verdict.status === 'future' || verdict.status === 'malformed') {
    clearSession(sessionPath);
  }
  return undefined;
}

/** Public, redacted view of the session state for `keystore status`. Never emits the passphrase. */
export interface SessionStatus {
  active            : boolean;
  expiresAt?        : number;
  secondsRemaining? : number;
  /** Whether the session may sign a mainnet operation prompt-free (unlocked with `--allow-mainnet`). */
  allowMainnet?     : boolean;
}

/**
 * Reports whether a live session exists for `keystorePath` and its remaining
 * lifetime, without decrypting, prompting, throwing, or emitting the passphrase.
 * An expired, foreign, stale, or malformed session reports inactive. Read-only:
 * unlike {@link readLiveSessionPassphrase}, it does not prune.
 */
export function readSessionStatus(
  sessionPath       : string,
  keystorePath      : string,
  currentVerifierId : string | undefined,
): SessionStatus {
  const now = Date.now();
  const verdict = evaluateSession(sessionPath, keystorePath, currentVerifierId, now);
  if (verdict.status !== 'live') return { active: false };
  return {
    active           : true,
    expiresAt        : verdict.session.expiresAt,
    secondsRemaining : Math.max(0, Math.round((verdict.session.expiresAt - now) / 1000)),
    allowMainnet     : verdict.session.allowMainnet,
  };
}

/**
 * Parses a TTL string into milliseconds: a bare integer is seconds; an `s`, `m`,
 * or `h` suffix scales it. Returns `undefined` for any malformed input. The
 * caller applies the default, the 24h cap, and the `<= 0` rejection.
 */
export function parseTtlToMs(raw: string): number | undefined {
  const match = /^(\d+)([smh]?)$/.exec(raw.trim());
  if (!match) return undefined;
  const n = Number(match[1]);
  if (!Number.isFinite(n)) return undefined;
  const unitMs = match[2] === 'h' ? 3_600_000 : match[2] === 'm' ? 60_000 : 1_000;
  return n * unitMs;
}

/** The outcome of inspecting a session file against the current keystore and clock. */
type SessionVerdict =
  | { status: 'live'; session: SessionFile }
  | { status: 'none' | 'foreign' | 'expired' | 'stale' | 'future' | 'malformed' };

/**
 * Classifies the session file: read it securely, then check version, shape,
 * clock, keystore binding, and verifier fingerprint in that order. Ordering
 * `expired` before `foreign` means an expired session is pruned regardless of
 * which keystore it was for. Never throws.
 */
function evaluateSession(
  sessionPath       : string,
  keystorePath      : string,
  currentVerifierId : string | undefined,
  now               : number,
): SessionVerdict {
  const session = secureReadSession(sessionPath);
  if (!session) return { status: 'none' };
  if (session.v !== SESSION_VERSION) return { status: 'malformed' };
  if (typeof session.passphrase !== 'string' || typeof session.keystore !== 'string'
    || typeof session.verifierId !== 'string' || typeof session.allowMainnet !== 'boolean'
    || typeof session.createdAt !== 'number' || typeof session.expiresAt !== 'number') {
    return { status: 'malformed' };
  }
  if (session.createdAt > now) return { status: 'future' };
  if (now >= session.expiresAt) return { status: 'expired' };
  if (resolve(session.keystore) !== resolve(keystorePath)) return { status: 'foreign' };
  if (currentVerifierId === undefined || session.verifierId !== currentVerifierId) return { status: 'stale' };
  return { status: 'live', session };
}

/**
 * Reads and parses the session file with a plaintext secret in mind. On POSIX,
 * opens with `O_NOFOLLOW` (refusing a symlink) and refuses a non-regular file, a
 * file not owned by this user, or one accessible by group or other, best-effort
 * deleting a rejected file and reading only from the opened descriptor (no TOCTOU
 * re-open). On Windows those POSIX guards are skipped (they would throw), so the
 * file is read normally under the same directory ACL the keystore trusts, keeping
 * the session usable rather than silently ignored. Returns `undefined` on any
 * failure; never throws.
 */
function secureReadSession(sessionPath: string): SessionFile | undefined {
  let raw: string;
  if (process.platform === 'win32') {
    try {
      raw = readFileSync(sessionPath, 'utf-8');
    } catch {
      return undefined;
    }
  } else {
    let fd: number;
    try {
      fd = openSync(sessionPath, constants.O_RDONLY | constants.O_NOFOLLOW);
    } catch {
      // ENOENT (no session), ELOOP (symlink refused by O_NOFOLLOW), or any other
      // open failure: no usable session.
      return undefined;
    }
    try {
      const st = fstatSync(fd);
      const myUid = typeof process.getuid === 'function' ? process.getuid() : undefined;
      if (!st.isFile() || (myUid !== undefined && st.uid !== myUid) || (st.mode & 0o077) !== 0) {
        // Not a regular file we own with 0600 perms: it was not written by this
        // process. Best-effort remove it (it may hold a plaintext passphrase) and
        // fall back to a prompt.
        try {
          rmSync(sessionPath, { force: true });
        } catch {
          // Cannot remove a file we do not own; ignoring it is enough.
        }
        return undefined;
      }
      raw = readFileSync(fd, 'utf-8');
    } catch {
      return undefined;
    } finally {
      try {
        closeSync(fd);
      } catch {
        // Descriptor already gone; nothing to close.
      }
    }
  }
  try {
    return JSON.parse(raw) as SessionFile;
  } catch {
    return undefined;
  }
}

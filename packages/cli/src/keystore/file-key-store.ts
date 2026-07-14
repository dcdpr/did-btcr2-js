import { existsSync, readFileSync } from 'node:fs';
import { dirname } from 'node:path';
import type { KeyEntry, KeyIdentifier, KeyValueStore } from '@did-btcr2/key-manager';
import { sha256 } from '@noble/hashes/sha2.js';
import { utf8ToBytes } from '@noble/hashes/utils.js';
import { base64urlnopad } from '@scure/base';
import type { KeystoreProtectionLabel } from '../types.js';
import { assertSecurePerms, ensureDir, writeFileAtomic } from './atomic.js';
import { DEFAULT_ARGON_PARAMS, decryptSecret, encryptSecret } from './envelope.js';
import type { ArgonParams, SecretEnvelope } from './envelope.js';
import { KeyStoreError } from './error.js';
import { withFileLock, type LockOptions } from './lock.js';
import { defaultKeystorePath } from './paths.js';

/** Current on-disk keystore file format version. */
export const KEYSTORE_VERSION = 1 as const;

/**
 * How a keystore protects its secrets on disk:
 * - `passphrase`: each secret is sealed in its own argon2id + XChaCha20-Poly1305
 *   envelope, all opened by one shared, verifier-checked passphrase.
 * - `none`: a dev keystore; secrets are stored as plaintext bytes. Never prompts;
 *   refused for mainnet (ADR 080). For disposable testnet material only.
 */
export type KeystoreProtection = 'passphrase' | 'none';

/**
 * Fixed sentinel sealed under the keystore passphrase and stored as the file's
 * `verifier`. Decrypting it checks a candidate passphrase before any real secret
 * is sealed or opened, so a typo fails loudly instead of corrupting the store.
 */
const VERIFIER_PLAINTEXT = utf8ToBytes('did-btcr2-keystore-verifier-v1');

/** Constant-length-independent byte compare for the verifier sentinel. */
function bytesEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}

/** Whether two secret envelopes are byte-identical (structural JSON compare). */
function sameEnvelope(a: SecretEnvelope | undefined, b: SecretEnvelope | undefined): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

/**
 * One key as stored on disk: public material in clear, and the secret either
 * sealed (`secret`, encrypted keystore), stored in the clear (`plainSecret`, dev
 * keystore), or absent (watch-only).
 */
type StoredKey = {
  publicKey    : string;
  tags?        : Record<string, string>;
  secret?      : SecretEnvelope;
  plainSecret? : string;
};

/** The whole keystore file. */
type KeystoreFile = {
  v           : typeof KEYSTORE_VERSION;
  /** Protection mode, present on every keystore this CLI writes: `passphrase` (encrypted) or `none` (dev). */
  protection? : KeystoreProtection;
  /** Passphrase verifier, present once an encrypted keystore's passphrase is established. */
  verifier?   : SecretEnvelope;
  active?     : string;
  keys        : Record<string, StoredKey>;
};

/** One key in the in-memory cache; the materialized secret is retained per session once decrypted. */
type CacheEntry = {
  publicKey  : Uint8Array;
  tags?      : Record<string, string>;
  secret?    : SecretEnvelope;
  /** True for a dev-keystore entry whose `decrypted` bytes are stored plaintext, not sealed. */
  plaintext? : boolean;
  decrypted? : Uint8Array;
};

/** Options for constructing a {@link FileKeyStore}. */
export type FileKeyStoreOptions = {
  /** Keystore file path. Defaults to {@link defaultKeystorePath}. */
  path?: string;
  /**
   * Supplies the passphrase lazily, called only when a secret must be sealed or
   * opened. `confirm` is passed as `true` only while establishing a fresh
   * encrypted keystore's passphrase, so the provider prompts twice and requires
   * a match; it is a no-op for non-interactive sources.
   */
  getPassphrase: (opts?: { confirm?: boolean }) => string;
  /** argon2id cost parameters used when sealing new secrets. Defaults to {@link DEFAULT_ARGON_PARAMS}. */
  argonParams?: ArgonParams;
  /** Tuning for the cross-process write lock. Defaults documented on {@link LockOptions}. */
  lock?: LockOptions;
  /**
   * Protection mode to use when *establishing* a fresh keystore. Defaults to
   * `passphrase` (encrypted). Ignored for an existing keystore, whose on-disk
   * `protection` always wins.
   */
  protection?: KeystoreProtection;
};

/**
 * A Node-only, file-backed {@link KeyValueStore} that protects secret keys at
 * rest. It satisfies the synchronous store contract by caching the parsed file
 * in memory at construction and flushing the whole file atomically on every
 * mutation.
 *
 * Encrypted keystores seal each secret in its own argon2id + XChaCha20-Poly1305
 * envelope under one shared passphrase, and store a `verifier` sentinel so a
 * candidate passphrase is checked before it is used (ADR 080): the first
 * passphrase is established with a confirm prompt, and every later use is
 * verified, so a typo is a loud failure rather than a key sealed under an
 * unknown or divergent passphrase. Dev keystores (`protection: 'none'`) store
 * secrets as plaintext and never prompt; they are refused for mainnet by the
 * command layer.
 *
 * Every mutation runs under an exclusive cross-process lock and, inside that
 * lock, reloads the file from disk before applying its change and flushing, so
 * concurrent `btcr2` invocations compose instead of clobbering. Reads stay
 * lock-free: an atomic rename means a concurrent reader always sees a complete
 * file, old or new.
 *
 * Secrets are materialized only through {@link FileKeyStore.get}. The
 * {@link FileKeyStore.list} and {@link FileKeyStore.entries} projections omit
 * secret keys and never decrypt, so enumerating the store never triggers a
 * passphrase prompt.
 */
export class FileKeyStore implements KeyValueStore<KeyIdentifier, KeyEntry> {
  readonly #path: string;
  readonly #lockPath: string;
  readonly #lockOptions: LockOptions;
  readonly #getPassphrase: (opts?: { confirm?: boolean }) => string;
  readonly #argonParams: ArgonParams;
  readonly #cache: Map<KeyIdentifier, CacheEntry> = new Map();
  #active: string | undefined;
  #protection: KeystoreProtection;
  #verifier: SecretEnvelope | undefined;

  constructor(options: FileKeyStoreOptions) {
    this.#path = options.path ?? defaultKeystorePath();
    this.#lockPath = `${this.#path}.lock`;
    this.#lockOptions = options.lock ?? {};
    this.#getPassphrase = options.getPassphrase;
    this.#argonParams = options.argonParams ?? DEFAULT_ARGON_PARAMS;
    // The requested mode applies only when establishing a fresh keystore; an
    // existing file's on-disk protection overrides it in #loadFromDisk.
    this.#protection = options.protection ?? 'passphrase';
    ensureDir(dirname(this.#path), 0o700);
    this.#loadFromDisk();
  }

  #loadFromDisk(): void {
    if (!existsSync(this.#path)) return;
    assertSecurePerms(this.#path);
    let parsed: KeystoreFile;
    try {
      parsed = JSON.parse(readFileSync(this.#path, 'utf-8')) as KeystoreFile;
    } catch {
      throw new KeyStoreError(
        `Keystore at ${this.#path} is corrupt or unreadable.`,
        'KEYSTORE_CORRUPT_ERROR',
        { path: this.#path },
      );
    }
    if (parsed.v !== KEYSTORE_VERSION) {
      throw new KeyStoreError(
        `Unsupported keystore version: ${String(parsed.v)}.`,
        'KEYSTORE_VERSION_ERROR',
        { version: parsed.v },
      );
    }
    // Every keystore this CLI writes carries a recognized protection header. A
    // file without one was not written by this CLI (there is no pre-header
    // format to accommodate); refuse it rather than guess how its secrets are
    // protected.
    if (parsed.protection !== 'none' && parsed.protection !== 'passphrase') {
      throw new KeyStoreError(
        `Keystore at ${this.#path} has no recognized protection header; it was not written by this CLI.`,
        'KEYSTORE_CORRUPT_ERROR',
        { path: this.#path },
      );
    }
    this.#protection = parsed.protection;
    this.#verifier = parsed.verifier;
    this.#active = parsed.active;
    // An encrypted keystore that holds sealed keys must carry the verifier that
    // established its passphrase. Without it, the verify-or-establish decision in
    // #sealPassphrase could take the establish path over existing sealed keys and
    // seal a new key under a divergent passphrase; refuse the file instead.
    const sealedPresent = Object.values(parsed.keys ?? {}).some(
      k => k && typeof k === 'object' && (k as StoredKey).secret !== undefined,
    );
    if (this.#protection === 'passphrase' && sealedPresent && this.#verifier === undefined) {
      throw new KeyStoreError(
        `Keystore at ${this.#path} holds sealed keys but no passphrase verifier; it is corrupt or was tampered with.`,
        'KEYSTORE_CORRUPT_ERROR',
        { path: this.#path },
      );
    }
    for (const [ id, stored ] of Object.entries(parsed.keys ?? {})) {
      let publicKey: Uint8Array;
      try {
        if (typeof stored.publicKey !== 'string') throw new Error('missing publicKey');
        publicKey = base64urlnopad.decode(stored.publicKey);
      } catch {
        throw new KeyStoreError(
          `Keystore entry ${id} has a malformed public key.`,
          'KEYSTORE_CORRUPT_ERROR',
          { path: this.#path, keyId: id },
        );
      }
      if (publicKey.length !== 33) {
        throw new KeyStoreError(
          `Keystore entry ${id} has a ${publicKey.length}-byte public key; expected 33.`,
          'KEYSTORE_CORRUPT_ERROR',
          { path: this.#path, keyId: id },
        );
      }
      const entry: CacheEntry = { publicKey, ...(stored.tags && { tags: stored.tags }) };
      // A secret's storage form must match the keystore's protection mode: a dev
      // keystore holds plaintext, an encrypted keystore holds sealed envelopes. A
      // mismatch is a tampered or foreign file, not something to open blindly.
      if (stored.plainSecret !== undefined) {
        if (this.#protection !== 'none') {
          throw new KeyStoreError(
            `Keystore entry ${id} holds a plaintext secret in an encrypted keystore at ${this.#path}.`,
            'KEYSTORE_CORRUPT_ERROR',
            { path: this.#path, keyId: id },
          );
        }
        entry.plaintext = true;
        entry.decrypted = this.#decodePlainSecret(stored.plainSecret, id);
      } else if (stored.secret) {
        if (this.#protection !== 'passphrase') {
          throw new KeyStoreError(
            `Keystore entry ${id} holds a sealed secret in a dev keystore at ${this.#path}.`,
            'KEYSTORE_CORRUPT_ERROR',
            { path: this.#path, keyId: id },
          );
        }
        entry.secret = stored.secret;
      }
      this.#cache.set(id, entry);
    }
  }

  /** Decodes and length-checks a dev-keystore plaintext secret. */
  #decodePlainSecret(encoded: string, id: KeyIdentifier): Uint8Array {
    let secret: Uint8Array;
    try {
      secret = base64urlnopad.decode(encoded);
    } catch {
      throw new KeyStoreError(
        `Keystore entry ${id} has a malformed plaintext secret.`,
        'KEYSTORE_CORRUPT_ERROR',
        { path: this.#path, keyId: id },
      );
    }
    if (secret.length !== 32) {
      throw new KeyStoreError(
        `Keystore entry ${id} has a ${secret.length}-byte secret; expected 32.`,
        'KEYSTORE_CORRUPT_ERROR',
        { path: this.#path, keyId: id },
      );
    }
    return secret;
  }

  #flush(): void {
    const keys: Record<string, StoredKey> = {};
    for (const [ id, entry ] of this.#cache) {
      const stored: StoredKey = { publicKey: base64urlnopad.encode(entry.publicKey) };
      if (entry.tags) stored.tags = entry.tags;
      if (entry.plaintext && entry.decrypted) {
        stored.plainSecret = base64urlnopad.encode(entry.decrypted);
      } else if (entry.secret) {
        stored.secret = entry.secret;
      }
      keys[id] = stored;
    }
    // Every keystore this CLI writes self-describes: the protection header is
    // always present (`passphrase` for encrypted, `none` for dev), so a file is
    // never ambiguous about how its secrets are protected.
    const file: KeystoreFile = {
      v          : KEYSTORE_VERSION,
      protection : this.#protection,
      ...(this.#verifier && { verifier: this.#verifier }),
      ...(this.#active && { active: this.#active }),
      keys,
    };
    writeFileAtomic(this.#path, `${JSON.stringify(file, null, 2)}\n`, 0o600);
  }

  /**
   * Re-reads the file into the cache, discarding the prior in-memory view so a
   * mutation applies on top of whatever other processes have written. Secrets
   * already decrypted this session are carried over for entries whose sealed
   * envelope is byte-identical on disk, so a mid-session write does not force a
   * re-prompt for keys it did not touch. (Dev-keystore plaintext secrets are
   * reloaded from disk, so they need no carry.)
   */
  #reload(): void {
    const carried = new Map<KeyIdentifier, { secret: SecretEnvelope; decrypted: Uint8Array }>();
    for (const [ id, entry ] of this.#cache) {
      if (entry.secret && entry.decrypted) carried.set(id, { secret: entry.secret, decrypted: entry.decrypted });
    }
    this.#cache.clear();
    this.#active = undefined;
    this.#loadFromDisk();
    for (const [ id, prior ] of carried) {
      const entry = this.#cache.get(id);
      if (entry?.secret && JSON.stringify(entry.secret) === JSON.stringify(prior.secret)) {
        entry.decrypted = prior.decrypted;
      }
    }
  }

  /**
   * Runs a cache mutation under the exclusive write lock, reloading the file
   * first so the change merges with any concurrent writer's change rather than
   * overwriting it, then flushing the result atomically. Callers must do any
   * expensive work (such as sealing a secret with argon2id) before calling this,
   * so the locked critical section stays short.
   */
  #mutate(apply: () => void): void {
    withFileLock(this.#lockPath, () => {
      this.#reload();
      apply();
      this.#flush();
    }, this.#lockOptions);
  }

  /**
   * Verifies a candidate passphrase against the keystore verifier, throwing when
   * it does not open the sentinel. A no-op only on a fresh keystore whose
   * passphrase has not been established yet (no verifier to check against).
   */
  #assertPassphrase(passphrase: string): void {
    if (!this.#verifier) return;
    let plain: Uint8Array;
    try {
      plain = decryptSecret(this.#verifier, passphrase);
    } catch {
      throw new KeyStoreError(
        `Incorrect passphrase for the keystore at ${this.#path}.`,
        'DECRYPT_ERROR',
        { path: this.#path },
      );
    }
    if (!bytesEqual(plain, VERIFIER_PLAINTEXT)) {
      throw new KeyStoreError(
        `Keystore verifier at ${this.#path} did not match; the file may be corrupt.`,
        'KEYSTORE_CORRUPT_ERROR',
        { path: this.#path },
      );
    }
  }

  /** Passphrase for opening an existing secret: verified when a verifier exists. */
  #openPassphrase(): string {
    const passphrase = this.#getPassphrase();
    this.#assertPassphrase(passphrase);
    return passphrase;
  }

  /**
   * Passphrase for sealing a secret. When the keystore's passphrase is already
   * established (a verifier exists), prompt once and verify it. Otherwise this is
   * establishment on a fresh keystore: prompt with confirm and mint a verifier for
   * the caller to persist alongside the first sealed key.
   */
  #sealPassphrase(): { passphrase: string; newVerifier?: SecretEnvelope } {
    if (this.#verifier) {
      const passphrase = this.#getPassphrase();
      this.#assertPassphrase(passphrase);
      return { passphrase };
    }
    const passphrase = this.#getPassphrase({ confirm: true });
    const newVerifier = encryptSecret(VERIFIER_PLAINTEXT, passphrase, this.#argonParams);
    return { passphrase, newVerifier };
  }

  get(id: KeyIdentifier): KeyEntry | undefined {
    const entry = this.#cache.get(id);
    if (!entry) return undefined;
    const result: KeyEntry = {
      publicKey : entry.publicKey,
      ...(entry.tags && { tags: entry.tags }),
    };
    if (entry.plaintext && entry.decrypted) {
      // Dev keystore: plaintext already materialized; expose without a prompt.
      const secret = entry.decrypted;
      Object.defineProperty(result, 'secretKey', {
        configurable : true,
        enumerable   : false,
        get          : (): Uint8Array => secret,
      });
    } else if (entry.secret) {
      // Materialize the sealed secret lazily, only when it is actually accessed,
      // so reads that need just public material never trigger a passphrase
      // prompt. The property is non-enumerable so spreading or serializing the
      // entry cannot silently decrypt the secret.
      const sealed = entry.secret;
      Object.defineProperty(result, 'secretKey', {
        configurable : true,
        enumerable   : false,
        get          : (): Uint8Array => {
          entry.decrypted ??= decryptSecret(sealed, this.#openPassphrase());
          return entry.decrypted;
        },
      });
    }
    return result;
  }

  has(id: KeyIdentifier): boolean {
    return this.#cache.has(id);
  }

  set(id: KeyIdentifier, value: KeyEntry): void {
    if (this.#protection === 'none') {
      // Dev keystore: store the secret in the clear, never prompt.
      this.#mutate(() => {
        this.#cache.set(id, {
          publicKey : value.publicKey,
          ...(value.tags && { tags: value.tags }),
          ...(value.secretKey && { plaintext: true, decrypted: value.secretKey }),
        });
      });
      return;
    }

    // Encrypted keystore. Resolve (and, if establishing, confirm) the passphrase
    // and seal the secret before taking the lock: argon2id is deliberately slow
    // and must not extend the critical section that blocks other processes.
    const verifierAtSeal = this.#verifier;
    let sealed: SecretEnvelope | undefined;
    let newVerifier: SecretEnvelope | undefined;
    let passphrase: string | undefined;
    if (value.secretKey) {
      const resolved = this.#sealPassphrase();
      passphrase = resolved.passphrase;
      newVerifier = resolved.newVerifier;
      sealed = encryptSecret(value.secretKey, passphrase, this.#argonParams);
    }
    this.#mutate(() => {
      // A secret sealed outside the lock must never be persisted under a
      // passphrase that diverges from the keystore verifier (the key-loss class
      // ADR 080 exists to prevent). Reconcile our seal-time view with whatever the
      // reload sees before committing.
      if (value.secretKey) {
        if (this.#verifier === undefined && newVerifier !== undefined) {
          // Establishing, and no concurrent writer beat us to it: record our verifier.
          this.#verifier = newVerifier;
        } else if (this.#verifier !== undefined && passphrase !== undefined) {
          // A verifier exists: it pre-existed, was established concurrently while we
          // sealed, or was rotated by a concurrent change-passphrase. If it was
          // rotated out from under our seal, abort with a clear message; otherwise
          // assert our passphrase still opens it before persisting the key.
          if (verifierAtSeal !== undefined && !sameEnvelope(this.#verifier, verifierAtSeal)) {
            throw new KeyStoreError(
              `The keystore passphrase at ${this.#path} changed concurrently; re-run the command.`,
              'KEYSTORE_CONCURRENT_CHANGE_ERROR',
              { path: this.#path },
            );
          }
          this.#assertPassphrase(passphrase);
        }
      }
      this.#cache.set(id, {
        publicKey : value.publicKey,
        ...(value.tags && { tags: value.tags }),
        ...(sealed && { secret: sealed }),
        ...(value.secretKey && { decrypted: value.secretKey }),
      });
    });
  }

  delete(id: KeyIdentifier): boolean {
    // `existed` reflects the freshly-reloaded state inside the lock, so a key a
    // concurrent process already removed reads as absent rather than resurrected.
    let existed = false;
    this.#mutate(() => {
      existed = this.#cache.delete(id);
      if (existed && this.#active === id) this.#active = undefined;
    });
    return existed;
  }

  clear(): void {
    this.#mutate(() => {
      this.#cache.clear();
      this.#active = undefined;
    });
  }

  /** All stored values with secret keys omitted. Never decrypts, never prompts. */
  list(): Array<KeyEntry> {
    return this.entries().map(([ , value ]) => value);
  }

  /**
   * All entries as id-value tuples with secret keys omitted. Never decrypts,
   * never prompts: {@link FileKeyStore.get} is the only secret-materializing
   * path, so callers that only need identifiers (such as `listKeys`) do not
   * force a passphrase prompt. This deviates intentionally from the in-memory
   * store, which returns stored values verbatim.
   */
  entries(): Array<[KeyIdentifier, KeyEntry]> {
    const out: Array<[KeyIdentifier, KeyEntry]> = [];
    for (const [ id, entry ] of this.#cache) {
      out.push([ id, {
        publicKey : entry.publicKey,
        ...(entry.tags && { tags: entry.tags }),
      } ]);
    }
    return out;
  }

  close(): void {
    for (const entry of this.#cache.values()) {
      entry.decrypted?.fill(0);
      entry.decrypted = undefined;
    }
    this.#cache.clear();
  }

  /** The persisted active-key identifier, or undefined if none is set. */
  getActive(): string | undefined {
    return this.#active;
  }

  /**
   * Persists the active-key pointer in the keystore file. Passing undefined
   * clears it. Throws if the identifier is not a known key.
   */
  setActive(id: KeyIdentifier | undefined): void {
    this.#mutate(() => {
      // The existence check runs against the reloaded state, so a key another
      // process added in the meantime is a valid active target.
      if (id !== undefined && !this.#cache.has(id)) {
        throw new KeyStoreError(`Cannot set unknown key as active: ${id}.`, 'KEY_NOT_FOUND_ERROR', { keyId: id });
      }
      this.#active = id;
    });
  }

  /** The keystore's protection mode. */
  get protection(): KeystoreProtection {
    return this.#protection;
  }

  /**
   * Re-seals every sealed secret and the verifier under a new passphrase (ADR
   * 080), returning the number of secrets re-sealed. Verifies the current
   * passphrase against the verifier first. Refused on a dev keystore, which has
   * no passphrase.
   */
  changePassphrase(oldPassphrase: string, newPassphrase: string): number {
    if (this.#protection === 'none') {
      throw new KeyStoreError(
        `The keystore at ${this.#path} is an unencrypted dev keystore; it has no passphrase to change.`,
        'KEYSTORE_PROTECTION_ERROR',
        { path: this.#path },
      );
    }
    // Fail a wrong current passphrase up front (when a verifier exists) so a typo
    // does not pay for a full re-seal before failing.
    if (this.#verifier) this.#assertPassphrase(oldPassphrase);
    // Precompute every re-seal and the new verifier BEFORE taking the lock:
    // argon2id is deliberately slow, and holding the exclusive lock across many
    // derivations could exceed the lock's stale threshold and let a concurrent
    // process break a still-live lock. Each re-seal records the source envelope
    // it derived from, so the locked section can abort on any concurrent change
    // instead of corrupting. This follows the same do-expensive-work-before-the-
    // lock contract as set().
    const resealed = new Map<KeyIdentifier, { from: SecretEnvelope; to: SecretEnvelope; plain: Uint8Array }>();
    for (const [ id, entry ] of this.#cache) {
      if (!entry.secret) continue;
      let plain: Uint8Array;
      try {
        plain = decryptSecret(entry.secret, oldPassphrase);
      } catch {
        throw new KeyStoreError(
          `Incorrect current passphrase for the keystore at ${this.#path}.`,
          'DECRYPT_ERROR',
          { path: this.#path },
        );
      }
      resealed.set(id, { from: entry.secret, to: encryptSecret(plain, newPassphrase, this.#argonParams), plain });
    }
    const newVerifier = encryptSecret(VERIFIER_PLAINTEXT, newPassphrase, this.#argonParams);
    let rekeyed = 0;
    this.#mutate(() => {
      // The reload reflects any concurrent writer. Apply a precomputed re-seal
      // only where the on-disk envelope still matches what it was derived from;
      // abort if any sealed key changed or a new sealed key appeared that was not
      // re-sealed, rather than leave a key under the old passphrase.
      for (const [ id, entry ] of this.#cache) {
        if (!entry.secret) continue;
        const pre = resealed.get(id);
        if (!pre || !sameEnvelope(pre.from, entry.secret)) {
          throw new KeyStoreError(
            `The keystore at ${this.#path} changed while its passphrase was being changed; re-run the command.`,
            'KEYSTORE_CONCURRENT_CHANGE_ERROR',
            { path: this.#path },
          );
        }
        entry.secret = pre.to;
        entry.decrypted = pre.plain;
        rekeyed++;
      }
      this.#verifier = newVerifier;
    });
    return rekeyed;
  }
}

/** A no-decrypt, no-prompt summary of a keystore file for `keystore status`. */
export interface KeystoreSummary {
  protection  : KeystoreProtectionLabel;
  established : boolean;
  keyCount    : number;
  active      : string | undefined;
}

/**
 * Summarizes a keystore file by structure alone: protection mode, whether a
 * passphrase is established, key count, and active key. Never decrypts, never
 * prompts, and never throws (a missing or unreadable file reports `absent`), so
 * it is safe for `keystore status`, `config path`, and the mainnet dev-keystore
 * guard.
 */
export function keystoreSummary(path: string): KeystoreSummary {
  const absent: KeystoreSummary = { protection: 'absent', established: false, keyCount: 0, active: undefined };
  if (!existsSync(path)) return absent;
  let parsed: KeystoreFile;
  try {
    parsed = JSON.parse(readFileSync(path, 'utf-8')) as KeystoreFile;
  } catch {
    return absent;
  }
  const keys = (parsed.keys && typeof parsed.keys === 'object') ? parsed.keys : {};
  const keyCount = Object.keys(keys).length;
  const active = typeof parsed.active === 'string' ? parsed.active : undefined;

  if (parsed.protection === 'none') {
    return { protection: 'dev', established: true, keyCount, active };
  }
  if (parsed.protection === 'passphrase') {
    // An encrypted keystore is "established" once its passphrase verifier exists
    // (written by `init` or the first key-seal). Without it the passphrase has not
    // been set yet: a freshly-created, still-empty encrypted keystore.
    return { protection: 'encrypted', established: parsed.verifier !== undefined, keyCount, active };
  }
  // No recognized protection header: not a keystore this CLI wrote. Report absent
  // (never throw) so `keystore status` stays a safe, no-decrypt introspection; an
  // actual open of such a file is refused by FileKeyStore.
  return absent;
}

/** The protection label of a keystore file, without decrypting or prompting. */
export function keystoreProtection(path: string): KeystoreProtectionLabel {
  return keystoreSummary(path).protection;
}

/**
 * A stable fingerprint of a keystore's passphrase verifier, or `undefined` when
 * the file is absent, unparsable, or carries no verifier. Compared by equality
 * to detect a rotated passphrase (`change-passphrase`, `init --force`) or a
 * re-established keystore, so a cached session (ADR 081) stops matching a
 * keystore whose passphrase has changed. Never decrypts, never throws.
 */
export function keystoreVerifierId(path: string): string | undefined {
  if (!existsSync(path)) return undefined;
  let parsed: KeystoreFile;
  try {
    parsed = JSON.parse(readFileSync(path, 'utf-8')) as KeystoreFile;
  } catch {
    return undefined;
  }
  if (!parsed.verifier) return undefined;
  return base64urlnopad.encode(sha256(utf8ToBytes(JSON.stringify(parsed.verifier))));
}

/**
 * Checks a candidate passphrase against the keystore's verifier without
 * constructing a store or opening any key. Returns `false` for an absent,
 * unparsable, dev, or verifier-less keystore and for a wrong passphrase; `true`
 * only when the passphrase opens the verifier sentinel. Never throws. Used by
 * `keystore unlock` (ADR 081) to refuse caching a wrong passphrase.
 */
export function verifyKeystorePassphrase(path: string, passphrase: string): boolean {
  if (!existsSync(path)) return false;
  let parsed: KeystoreFile;
  try {
    parsed = JSON.parse(readFileSync(path, 'utf-8')) as KeystoreFile;
  } catch {
    return false;
  }
  if (parsed.protection !== 'passphrase' || !parsed.verifier) return false;
  try {
    return bytesEqual(decryptSecret(parsed.verifier, passphrase), VERIFIER_PLAINTEXT);
  } catch {
    return false;
  }
}

/** Options for {@link initKeystore}. */
export interface InitKeystoreOptions {
  protection    : KeystoreProtection;
  getPassphrase : (opts?: { confirm?: boolean }) => string;
  argonParams?  : ArgonParams;
}

/**
 * Establishes a fresh keystore file (ADR 080). An encrypted keystore prompts
 * (with confirm) for the passphrase and writes the verifier; a dev keystore
 * writes a plaintext-mode header with no passphrase. The caller is responsible
 * for refusing to overwrite an existing keystore; this always writes the file.
 */
export function initKeystore(path: string, options: InitKeystoreOptions): void {
  ensureDir(dirname(path), 0o700);
  let file: KeystoreFile;
  if (options.protection === 'none') {
    file = { v: KEYSTORE_VERSION, protection: 'none', keys: {} };
  } else {
    const passphrase = options.getPassphrase({ confirm: true });
    const verifier = encryptSecret(VERIFIER_PLAINTEXT, passphrase, options.argonParams ?? DEFAULT_ARGON_PARAMS);
    file = { v: KEYSTORE_VERSION, protection: 'passphrase', verifier, keys: {} };
  }
  writeFileAtomic(path, `${JSON.stringify(file, null, 2)}\n`, 0o600);
}

/**
 * Re-seals every secret in an encrypted keystore under a new passphrase (ADR
 * 080), returning the count re-sealed. The old and new passphrases are supplied
 * explicitly, so the store's own passphrase provider is never invoked (a wrong
 * current passphrase is caught by the verifier). Refused on a dev keystore.
 */
export function changeKeystorePassphrase(
  path          : string,
  oldPassphrase : string,
  newPassphrase : string,
  argonParams?  : ArgonParams,
): number {
  const store = new FileKeyStore({
    path,
    ...(argonParams && { argonParams }),
    getPassphrase : () => {
      throw new KeyStoreError(
        `Unexpected passphrase prompt while changing the passphrase for ${path}.`,
        'KEYSTORE_INTERNAL_ERROR',
        { path },
      );
    },
  });
  return store.changePassphrase(oldPassphrase, newPassphrase);
}

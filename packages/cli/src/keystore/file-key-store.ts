import { existsSync, readFileSync } from 'node:fs';
import { dirname } from 'node:path';
import type { KeyEntry, KeyIdentifier, KeyValueStore } from '@did-btcr2/key-manager';
import { base64urlnopad } from '@scure/base';
import { assertSecurePerms, ensureDir, writeFileAtomic } from './atomic.js';
import { DEFAULT_ARGON_PARAMS, decryptSecret, encryptSecret } from './envelope.js';
import type { ArgonParams, SecretEnvelope } from './envelope.js';
import { KeyStoreError } from './error.js';
import { withFileLock, type LockOptions } from './lock.js';
import { defaultKeystorePath } from './paths.js';

/** Current on-disk keystore file format version. */
export const KEYSTORE_VERSION = 1 as const;

/** One key as stored on disk: public material in clear, secret sealed (or absent for watch-only). */
type StoredKey = {
  publicKey : string;
  tags?     : Record<string, string>;
  secret?   : SecretEnvelope;
};

/** The whole keystore file. */
type KeystoreFile = {
  v       : typeof KEYSTORE_VERSION;
  active? : string;
  keys    : Record<string, StoredKey>;
};

/** One key in the in-memory cache; the materialized secret is retained per session once decrypted. */
type CacheEntry = {
  publicKey  : Uint8Array;
  tags?      : Record<string, string>;
  secret?    : SecretEnvelope;
  decrypted? : Uint8Array;
};

/** Options for constructing a {@link FileKeyStore}. */
export type FileKeyStoreOptions = {
  /** Keystore file path. Defaults to {@link defaultKeystorePath}. */
  path?: string;
  /** Supplies the passphrase lazily, called only when a secret must be sealed or opened. */
  getPassphrase: () => string;
  /** argon2id cost parameters used when sealing new secrets. Defaults to {@link DEFAULT_ARGON_PARAMS}. */
  argonParams?: ArgonParams;
  /** Tuning for the cross-process write lock. Defaults documented on {@link LockOptions}. */
  lock?: LockOptions;
};

/**
 * A Node-only, file-backed {@link KeyValueStore} that encrypts secret keys at
 * rest. It satisfies the synchronous store contract by caching the parsed file
 * in memory at construction and flushing the whole file atomically on every
 * mutation.
 *
 * Every mutation runs under an exclusive cross-process lock and, inside that
 * lock, reloads the file from disk before applying its change and flushing.
 * Caching at construction and flushing the whole file is otherwise a lost-update
 * race: two `btcr2` processes that each load, then each write, would have the
 * second overwrite the first. The lock serializes the writers and the reload
 * merges any change the other made, so concurrent invocations compose instead of
 * clobbering. Reads stay lock-free: an atomic rename means a concurrent reader
 * always sees a complete file, old or new.
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
  readonly #getPassphrase: () => string;
  readonly #argonParams: ArgonParams;
  readonly #cache: Map<KeyIdentifier, CacheEntry> = new Map();
  #active: string | undefined;

  constructor(options: FileKeyStoreOptions) {
    this.#path = options.path ?? defaultKeystorePath();
    this.#lockPath = `${this.#path}.lock`;
    this.#lockOptions = options.lock ?? {};
    this.#getPassphrase = options.getPassphrase;
    this.#argonParams = options.argonParams ?? DEFAULT_ARGON_PARAMS;
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
    this.#active = parsed.active;
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
      this.#cache.set(id, {
        publicKey,
        ...(stored.tags && { tags: stored.tags }),
        ...(stored.secret && { secret: stored.secret }),
      });
    }
  }

  #flush(): void {
    const keys: Record<string, StoredKey> = {};
    for (const [ id, entry ] of this.#cache) {
      keys[id] = {
        publicKey : base64urlnopad.encode(entry.publicKey),
        ...(entry.tags && { tags: entry.tags }),
        ...(entry.secret && { secret: entry.secret }),
      };
    }
    const file: KeystoreFile = {
      v : KEYSTORE_VERSION,
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
   * re-prompt for keys it did not touch.
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

  get(id: KeyIdentifier): KeyEntry | undefined {
    const entry = this.#cache.get(id);
    if (!entry) return undefined;
    const result: KeyEntry = {
      publicKey : entry.publicKey,
      ...(entry.tags && { tags: entry.tags }),
    };
    if (entry.secret) {
      // Materialize the secret lazily, only when it is actually accessed, so
      // reads that need just public material (an active-key existence check,
      // getPublicKey, getEntry) never trigger a passphrase prompt. The property
      // is non-enumerable so spreading or serializing the entry cannot silently
      // decrypt the secret.
      const sealed = entry.secret;
      Object.defineProperty(result, 'secretKey', {
        configurable : true,
        enumerable   : false,
        get          : (): Uint8Array => {
          entry.decrypted ??= decryptSecret(sealed, this.#getPassphrase());
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
    // Seal the secret before taking the lock: argon2id is deliberately slow and
    // must not extend the critical section that blocks other processes.
    const secret = value.secretKey
      ? encryptSecret(value.secretKey, this.#getPassphrase(), this.#argonParams)
      : undefined;
    this.#mutate(() => {
      this.#cache.set(id, {
        publicKey : value.publicKey,
        ...(value.tags && { tags: value.tags }),
        ...(secret && { secret }),
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
}

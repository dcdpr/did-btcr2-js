import type {
  Bytes,
  HashBytes,
  KeyBytes,
  SignatureBytes
} from '@did-btcr2/common';
import {
  KeyManagerError
} from '@did-btcr2/common';
import { SchnorrKeyPair, signWithScheme } from '@did-btcr2/keypair';
import { schnorr, secp256k1 } from '@noble/curves/secp256k1.js';
import { sha256 } from '@noble/hashes/sha2.js';
import type {
  GenerateKeyOptions,
  ImportKeyOptions,
  KeyEntry,
  KeyIdentifier,
  KeyManager,
  SignOptions,
  VerifyOptions,
} from './interface.js';
import type { KeyValueStore} from './store.js';
import { MemoryStore } from './store.js';

/**
 * In-process reference implementation of the {@link KeyManager} interface for
 * the did:btcr2 DID method. Holds key entries in a pluggable
 * {@link KeyValueStore} (defaults to {@link MemoryStore}).
 *
 * "Local" means the secret bytes live in this JS process's heap, just like
 * `LocalSigner` in `@did-btcr2/keypair`. For production deployments that need
 * keys held outside the process (HSM, cloud KMS like AWS / GCP / Azure /
 * HashiCorp Vault), supply your own implementation of {@link KeyManager} to
 * the api package and use this class only for tests, scripts, and reference.
 *
 * Supports both signing (secret key present) and watch-only (public-key-only)
 * key entries, plus all three {@link SigningScheme}s.
 */
export class LocalKeyManager implements KeyManager {
  /** Capability probe: this implementation supports exportKey(). */
  readonly canExport = true;

  #store: KeyValueStore<KeyIdentifier, KeyEntry>;
  #activeKeyId?: KeyIdentifier;

  /**
   * Create a new LocalKeyManager instance.
   *
   * @param {KeyValueStore<KeyIdentifier, KeyEntry>} [store] Optional key-value
   *   store. Defaults to an in-memory store if not provided.
   */
  constructor(store?: KeyValueStore<KeyIdentifier, KeyEntry>) {
    this.#store = store ?? new MemoryStore<KeyIdentifier, KeyEntry>();
  }

  /**
   * Get the active key identifier.
   *
   * @returns {KeyIdentifier | undefined} The active key identifier, or undefined if none is set.
   */
  get activeKeyId(): KeyIdentifier | undefined {
    return this.#activeKeyId;
  }

  /**
   * Generate a URN-style key identifier from compressed public key bytes.
   * Format: `urn:kms:secp256k1:<fingerprint>` where fingerprint is the
   * first 16 bytes of SHA-256(publicKey), hex-encoded (128 bits, 32 hex chars).
   *
   * 128 bits comfortably exceeds the birthday-paradox threshold for any
   * realistic key inventory (collision probability ~ 2^-64 at 2^32 keys),
   * while still being short enough to remain human-skimmable.
   *
   * @param {KeyBytes} publicKeyBytes Compressed secp256k1 public key bytes.
   * @returns {KeyIdentifier} The generated key identifier.
   */
  #generateUrn(publicKeyBytes: KeyBytes): KeyIdentifier {
    const hash = sha256(publicKeyBytes);
    const fingerprint = Array.from(hash.slice(0, 16))
      .map(b => b.toString(16).padStart(2, '0'))
      .join('');
    return `urn:kms:secp256k1:${fingerprint}`;
  }

  /**
   * Retrieve a key entry or throw if not found / no active key set.
   *
   * @param {KeyIdentifier} [id] Key identifier. Uses active key if omitted.
   * @returns {KeyEntry} The retrieved key entry.
   * @throws {KeyManagerError} If key not found or no active key set.
   */
  #getEntryOrThrow(id?: KeyIdentifier): KeyEntry {
    const keyId = id ?? this.#activeKeyId;
    if (!keyId) {
      throw new KeyManagerError('No active key set', 'ACTIVE_KEY_NOT_SET');
    }
    const entry = this.#store.get(keyId);
    if (!entry) {
      throw new KeyManagerError(`Key not found: ${keyId}`, 'KEY_NOT_FOUND');
    }
    return entry;
  }

  /**
   * Set the active key.
   *
   * @param id The key identifier to set as active.
   * @throws {KeyManagerError} If the key is not found.
   */
  setActiveKey(id: KeyIdentifier): void {
    this.#getEntryOrThrow(id);
    this.#activeKeyId = id;
  }

  /**
   * Get the compressed public key bytes for a key.
   *
   * @param id Key identifier. Uses active key if omitted.
   * @returns Compressed secp256k1 public key bytes.
   * @throws {KeyManagerError} If key not found or no active key set.
   */
  getPublicKey(id?: KeyIdentifier): KeyBytes {
    return this.#getEntryOrThrow(id).publicKey;
  }

  /**
   * Sign data using the specified key. See {@link SigningScheme} for the
   * contract of each scheme. The KMS applies any key-derivation step
   * (BIP-341 taproot tweak) internally; secret bytes never leave this object.
   *
   * @param {Bytes} data The data to sign.
   * @param {KeyIdentifier} [id] Key identifier. Uses active key if omitted.
   * @param {SignOptions} [options] Signing options. Defaults: `scheme: 'bip340'`.
   *   Only `'bip341'` consumes `merkleRoot`.
   * @returns {SignatureBytes} The signature bytes.
   * @throws {KeyManagerError} If key not found, no active key, or key cannot sign.
   */
  sign(data: Bytes, id?: KeyIdentifier, options: SignOptions = {}): SignatureBytes {
    const entry = this.#getEntryOrThrow(id);
    if (!entry.secretKey) {
      const keyId = id ?? this.#activeKeyId;
      throw new KeyManagerError(`Key is not a signing key: ${keyId}`, 'KEY_NOT_SIGNER');
    }
    const scheme = options.scheme ?? 'bip340';
    // Delegates to `signWithScheme` in `@did-btcr2/keypair`. Single source of
    // truth for the prehash / lowS / taproot-tweak contract so this manager
    // and `LocalSigner` cannot drift.
    return signWithScheme(entry.secretKey, data, scheme, { merkleRoot: options.merkleRoot });
  }

  /**
   * Verify a signature using the specified key. `'bip341'` is not supported
   * here — taproot signatures verify against the tweaked output key, not the
   * entry's untweaked pubkey.
   *
   * @param {SignatureBytes} signature The signature bytes to verify.
   * @param {Bytes} data The data that was signed.
   * @param {KeyIdentifier} [id] Key identifier. Uses active key if omitted.
   * @param {VerifyOptions} [options] Verification options. Defaults: `scheme: 'bip340'`.
   * @returns {boolean} True if the signature is valid, false otherwise.
   * @throws {KeyManagerError} If key not found or no active key set.
   */
  verify(
    signature: SignatureBytes,
    data: Bytes,
    id?: KeyIdentifier,
    options: VerifyOptions = {},
  ): boolean {
    const entry = this.#getEntryOrThrow(id);
    const scheme = options.scheme ?? 'bip340';
    if (scheme === 'ecdsa') {
      // The entry stores a 33-byte compressed key; noble v2 accepts that directly.
      // prehash: false — matches the sign-path contract; `data` is the digest.
      return secp256k1.verify(signature, data, entry.publicKey, {
        format  : 'der',
        prehash : false,
      });
    }
    if (scheme === 'bip340') {
      // BIP-340 uses the 32-byte x-only key. Strip the SEC prefix byte from the
      // stored compressed key before verifying.
      return schnorr.verify(signature, data, entry.publicKey.slice(1, 33));
    }
    throw new KeyManagerError(
      `Unsupported verify scheme: ${scheme as string}`,
      'VERIFY_ERROR'
    );
  }

  /**
   * Import a key pair into the KMS.
   *
   * @param {SchnorrKeyPair} keyPair The key pair to import.
   * @param {ImportKeyOptions} [options] Import options (id, tags, setActive).
   * @returns {KeyIdentifier} The identifier of the imported key.
   * @throws {KeyManagerError} If a key with the same identifier already exists.
   */
  importKey(keyPair: SchnorrKeyPair, options: ImportKeyOptions = {}): KeyIdentifier {
    const id = options.id ?? this.#generateUrn(keyPair.publicKey.compressed);

    if (this.#store.has(id)) {
      throw new KeyManagerError(`Key already exists: ${id}`, 'KEY_FOUND');
    }

    // Build key entry — secret key may not be available for watch-only pairs
    const entry: KeyEntry = {
      publicKey : keyPair.publicKey.compressed,
      ...(options.tags && { tags: options.tags }),
    };

    if (keyPair.hasSecretKey) {
      entry.secretKey = keyPair.secretKey.bytes;
    }

    this.#store.set(id, entry);

    if (options.setActive) {
      this.#activeKeyId = id;
    }

    return id;
  }

  /**
   * Remove a key from the KMS.
   *
   * @param {KeyIdentifier} id The key identifier to remove.
   * @param {Object} [options] Removal options.
   * @param {boolean} [options.force=false] Force removal of active key.
   * @throws {KeyManagerError} If key not found or attempting to remove active key without force.
   */
  removeKey(id: KeyIdentifier, options: { force?: boolean } = {}): void {
    if (this.#activeKeyId === id && !options.force) {
      throw new KeyManagerError(
        'Cannot remove active key (use "force": true or switch active key)',
        'ACTIVE_KEY_DELETE'
      );
    }

    if (!this.#store.has(id)) {
      throw new KeyManagerError(`Key not found: ${id}`, 'KEY_NOT_FOUND');
    }

    this.#store.delete(id);

    if (this.#activeKeyId === id) {
      this.#activeKeyId = undefined;
    }
  }

  /**
   * List all key identifiers in the KMS.
   *
   * @returns {KeyIdentifier[]} Array of key identifiers.
   */
  listKeys(): KeyIdentifier[] {
    return this.#store.entries().map(([k]) => k);
  }

  /**
   * Compute the SHA-256 digest of the given data.
   *
   * @param {Uint8Array} data The data to digest.
   * @returns {HashBytes} The SHA-256 hash of the data.
   */
  digest(data: Uint8Array): HashBytes {
    return sha256(data);
  }

  /**
   * Generate a new secp256k1 key pair and store it in the KMS.
   *
   * @param {GenerateKeyOptions} [options] Generation options (tags, setActive).
   * @returns {KeyIdentifier} The identifier of the generated key.
   */
  generateKey(options: GenerateKeyOptions = {}): KeyIdentifier {
    const kp = SchnorrKeyPair.generate();
    const id = this.#generateUrn(kp.publicKey.compressed);

    const entry: KeyEntry = {
      secretKey : kp.secretKey.bytes,
      publicKey : kp.publicKey.compressed,
      ...(options.tags && { tags: options.tags }),
    };

    this.#store.set(id, entry);

    if (options.setActive) {
      this.#activeKeyId = id;
    }

    return id;
  }

  /**
   * Export the key pair for a stored key.
   *
   * Only available on the concrete {@link LocalKeyManager} class, not on the
   * {@link KeyManager} interface. HSM, cloud KMS, or hardware-backed
   * implementations typically do not support key export.
   *
   * @param {KeyIdentifier} id The key identifier to export.
   * @returns {SchnorrKeyPair} The reconstructed SchnorrKeyPair.
   */
  exportKey(id: KeyIdentifier): SchnorrKeyPair {
    const entry = this.#getEntryOrThrow(id);
    if (entry.secretKey) {
      return new SchnorrKeyPair({ secretKey: entry.secretKey });
    }
    return new SchnorrKeyPair({ publicKey: entry.publicKey });
  }
}

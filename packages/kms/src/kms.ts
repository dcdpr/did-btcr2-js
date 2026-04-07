import type {
  Bytes,
  HashBytes,
  KeyBytes,
  SignatureBytes
} from '@did-btcr2/common';
import {
  KeyManagerError
} from '@did-btcr2/common';
import { SchnorrKeyPair } from '@did-btcr2/keypair';
import { sha256 } from '@noble/hashes/sha2.js';
import type {
  GenerateKeyOptions,
  ImportKeyOptions,
  KeyEntry,
  KeyIdentifier,
  KeyManager,
  SignOptions,
} from './interface.js';
import type { KeyValueStore} from './store.js';
import { MemoryStore } from './store.js';

/**
 * Key Management System for the did:btcr2 DID method.
 *
 * Implements the {@link KeyManager} interface with a pluggable
 * {@link KeyValueStore} (defaults to {@link MemoryStore}).
 *
 * Supports both signing (secret key present) and watch-only
 * (public-key-only) key entries, and both Schnorr and ECDSA
 * signature schemes.
 *
 */
export class Kms implements KeyManager {
  #store: KeyValueStore<KeyIdentifier, KeyEntry>;
  #activeKeyId?: KeyIdentifier;

  /**
   * Create a new KMS instance.
   *
   * @param {KeyValueStore<KeyIdentifier, KeyEntry>} [store] Optional key-value store.
   * Defaults to in-memory store if not provided.
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
   * first 8 bytes of SHA-256(publicKey), hex-encoded.
   *
   * @param {KeyBytes} publicKeyBytes Compressed secp256k1 public key bytes.
   * @returns {KeyIdentifier} The generated key identifier.
   */
  #generateUrn(publicKeyBytes: KeyBytes): KeyIdentifier {
    const hash = sha256(publicKeyBytes);
    const fingerprint = Array.from(hash.slice(0, 8))
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
   * Sign data using the specified key.
   *
   * @param {Bytes} data The data to sign.
   * @param {KeyIdentifier} [id] Key identifier. Uses active key if omitted.
   * @param {SignOptions} [options] Signing options (scheme defaults to 'schnorr').
   * @returns {SignatureBytes} The signature bytes.
   * @throws {KeyManagerError} If key not found, no active key, or key cannot sign.
   */
  sign(data: Bytes, id?: KeyIdentifier, options: SignOptions = {}): SignatureBytes {
    const entry = this.#getEntryOrThrow(id);
    if (!entry.secretKey) {
      const keyId = id ?? this.#activeKeyId;
      throw new KeyManagerError(`Key is not a signing key: ${keyId}`, 'KEY_NOT_SIGNER');
    }
    const kp = new SchnorrKeyPair({ secretKey: entry.secretKey });
    return kp.secretKey.sign(data, { scheme: options.scheme ?? 'schnorr' });
  }

  /**
   * Verify a signature using the specified key.
   *
   * @param {SignatureBytes} signature The signature bytes to verify.
   * @param {Bytes} data The data that was signed.
   * @param {KeyIdentifier} [id] Key identifier. Uses active key if omitted.
   * @param {SignOptions} [options] Verification options (scheme defaults to 'schnorr').
   * @returns {boolean} True if the signature is valid, false otherwise.
   * @throws {KeyManagerError} If key not found or no active key set.
   */
  verify(signature: SignatureBytes, data: Bytes, id?: KeyIdentifier, options: SignOptions = {}): boolean {
    const entry = this.#getEntryOrThrow(id);
    const kp = new SchnorrKeyPair({ publicKey: entry.publicKey });
    return kp.publicKey.verify(signature, data, { scheme: options.scheme ?? 'schnorr' });
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

    try {
      if (keyPair.secretKey) {
        entry.secretKey = keyPair.secretKey.bytes;
      }
    } catch {
      // Public-key-only key pair — secretKey getter throws
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
   * Only available on the concrete {@link Kms} class, not on the
   * {@link KeyManager} interface. HSM or hardware-backed implementations
   * may not support key export.
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

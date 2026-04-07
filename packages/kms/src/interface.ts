import type { Bytes, HashBytes, KeyBytes, SignatureBytes } from '@did-btcr2/common';
import type { SchnorrKeyPair } from '@did-btcr2/keypair';

/** Opaque key identifier string. */
export type KeyIdentifier = string;

/** Supported signature schemes. */
export type SigningScheme = 'schnorr' | 'ecdsa';

/** Options for sign and verify operations. */
export type SignOptions = {
  /** Signature scheme. Defaults to 'schnorr'. */
  scheme?: SigningScheme;
};

/** Stored key entry with optional secret key and metadata tags. */
export type KeyEntry = {
  /** Secret key bytes. Undefined for public-key-only (watch-only) entries. */
  secretKey?: KeyBytes;
  /** Compressed secp256k1 public key bytes. Always present. */
  publicKey: KeyBytes;
  /** Arbitrary metadata tags (e.g. derivation path, account, DID). */
  tags?: Record<string, string>;
};

/** Options for importing a key. */
export type ImportKeyOptions = {
  /** Custom key identifier. Auto-generated URN if omitted. */
  id?: KeyIdentifier;
  /** Whether to set this key as the active key. Defaults to false. */
  setActive?: boolean;
  /** Metadata tags to associate with the key. */
  tags?: Record<string, string>;
};

/** Options for generating a key. */
export type GenerateKeyOptions = {
  /** Whether to set the generated key as the active key. Defaults to false. */
  setActive?: boolean;
  /** Metadata tags to associate with the key. */
  tags?: Record<string, string>;
};

/**
 * Interface for key management operations.
 * @interface KeyManager
 */
export interface KeyManager {
  /** The ID of the active key. */
  readonly activeKeyId?: KeyIdentifier;

  /**
   * Set the active key.
   * @param id The key identifier to set as active.
   * @throws {KeyManagerError} If the key is not found.
   */
  setActiveKey(id: KeyIdentifier): void;

  /**
   * Import a key pair. May be public-key-only for watch-only entries.
   * @param keyPair The key pair to import.
   * @param options Import options.
   * @returns The key identifier of the imported key.
   * @throws {KeyManagerError} If the key already exists.
   */
  importKey(keyPair: SchnorrKeyPair, options?: ImportKeyOptions): KeyIdentifier;

  /**
   * Remove a key from the store.
   * @param id The key identifier to remove.
   * @param options Removal options.
   * @throws {KeyManagerError} If removing the active key without force, or key not found.
   */
  removeKey(id: KeyIdentifier, options?: { force?: boolean }): void;

  /**
   * List all key identifiers.
   * @returns Array of key identifiers.
   */
  listKeys(): KeyIdentifier[];

  /**
   * Get the compressed public key bytes for a key.
   * @param id Key identifier. Uses active key if omitted.
   * @returns Compressed secp256k1 public key bytes.
   * @throws {KeyManagerError} If key not found or no active key set.
   */
  getPublicKey(id?: KeyIdentifier): KeyBytes;

  /**
   * Sign data using the specified key.
   * @param data The data to sign.
   * @param id Key identifier. Uses active key if omitted.
   * @param options Signing options (scheme defaults to 'schnorr').
   * @returns The signature bytes.
   * @throws {KeyManagerError} If key not found, no active key, or key cannot sign.
   */
  sign(data: Bytes, id?: KeyIdentifier, options?: SignOptions): SignatureBytes;

  /**
   * Verify a signature using the specified key.
   * @param signature The signature to verify.
   * @param data The data that was signed.
   * @param id Key identifier. Uses active key if omitted.
   * @param options Verification options (scheme defaults to 'schnorr').
   * @returns True if the signature is valid.
   * @throws {KeyManagerError} If key not found or no active key set.
   */
  verify(signature: SignatureBytes, data: Bytes, id?: KeyIdentifier, options?: SignOptions): boolean;

  /**
   * Compute a SHA-256 hash of the given data.
   * @param data The data to hash.
   * @returns The hash bytes.
   */
  digest(data: Uint8Array): HashBytes;

  /**
   * Generate a new key pair and store it.
   * @param options Generation options.
   * @returns The key identifier of the generated key.
   */
  generateKey(options?: GenerateKeyOptions): KeyIdentifier;
}

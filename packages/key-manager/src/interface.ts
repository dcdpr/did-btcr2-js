import type { Bytes, HashBytes, KeyBytes, SignatureBytes } from '@did-btcr2/common';
import type { SchnorrKeyPair } from '@did-btcr2/keypair';

/** Opaque key identifier string. */
export type KeyIdentifier = string;

/**
 * Signature schemes supported by a {@link KeyManager}.
 *
 * Mirrors the `SigningScheme` type from `@did-btcr2/keypair`:
 * - `'ecdsa'`  — DER-encoded, low-S ECDSA over secp256k1. Used by P2PKH and
 *   P2WPKH (BIP-143) Bitcoin inputs.
 * - `'bip340'` — Raw BIP-340 Schnorr signature using the *untweaked* secret
 *   key. Used by Data Integrity proofs and any other BIP-340-over-message
 *   context (NOT for Bitcoin taproot inputs — those need `'bip341'`).
 * - `'bip341'` — BIP-341 taproot key-path Schnorr signature. The KeyManager
 *   applies the per-output tweak `t = H_taptweak(P || merkleRoot)` to the
 *   secret before signing; secret bytes never leave the store. The resulting
 *   signature verifies against the tweaked output key `Q = P + tG`.
 */
export type SigningScheme = 'ecdsa' | 'bip340' | 'bip341';

/**
 * Subset of {@link SigningScheme} usable for verification: anything that can
 * be verified with just a public key. `'bip341'` is excluded because verifying
 * a taproot key-path signature requires the tweaked output key, not the
 * untweaked entry pubkey.
 */
export type VerifyScheme = Exclude<SigningScheme, 'bip341'>;

/** Options for {@link KeyManager.sign}. */
export type SignOptions = {
  /** Signature scheme. Defaults to `'bip340'`. */
  scheme?: SigningScheme;
  /**
   * Merkle root of the taproot script tree. Only consumed when
   * `scheme === 'bip341'`. Pass `null` or omit for key-path-only spending.
   * Ignored for `'ecdsa'` and `'bip340'`.
   */
  merkleRoot?: Bytes | null;
};

/** Options for {@link KeyManager.verify}. */
export type VerifyOptions = {
  /** Signature scheme. Defaults to `'bip340'`. */
  scheme?: VerifyScheme;
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
   *
   * The KeyManager is responsible for any key-derivation step the scheme
   * requires (BIP-341 taproot tweak); secret bytes never have to leave the
   * store. See {@link SigningScheme} for the contract of each scheme.
   *
   * @param data The data to sign.
   * @param id Key identifier. Uses active key if omitted.
   * @param options Signing options. Defaults: `scheme: 'bip340'`. Only
   *   `'bip341'` consumes `merkleRoot`.
   * @returns The signature bytes.
   * @throws {KeyManagerError} If key not found, no active key, or key cannot sign.
   */
  sign(data: Bytes, id?: KeyIdentifier, options?: SignOptions): SignatureBytes;

  /**
   * Verify a signature using the specified key. `'bip341'` is not supported
   * here — taproot signatures verify against the tweaked output key, not the
   * entry's untweaked pubkey, so callers needing that should verify against
   * the tweaked key directly with `@noble/curves`.
   *
   * @param signature The signature to verify.
   * @param data The data that was signed.
   * @param id Key identifier. Uses active key if omitted.
   * @param options Verification options. Defaults: `scheme: 'bip340'`.
   * @returns True if the signature is valid.
   * @throws {KeyManagerError} If key not found or no active key set.
   */
  verify(
    signature: SignatureBytes,
    data: Bytes,
    id?: KeyIdentifier,
    options?: VerifyOptions,
  ): boolean;

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

  /**
   * Capability probe: does this KeyManager support exporting secret key material?
   *
   * In-process reference implementations like {@link LocalKeyManager} return
   * `true`. External KeyManager adapters (AWS KMS, GCP KMS, HashiCorp Vault,
   * HSM) typically forbid key export by design and return `false`. Callers
   * should check this before invoking {@link exportKey}.
   *
   * Defaults to `false` if an adapter omits the field (fail-closed if the
   * capability is unknown).
   */
  readonly canExport?: boolean;

  /**
   * Export the key pair for a stored key. Optional on the interface because
   * non-local KeyManagers do not support it; consult {@link canExport} first.
   *
   * @param id The key identifier to export.
   * @returns The reconstructed key pair.
   * @throws {KeyManagerError} If the adapter advertises `canExport: true` but the
   *   specific key is not exportable, or if `canExport` is false on the adapter.
   */
  exportKey?(id: KeyIdentifier): SchnorrKeyPair;
}

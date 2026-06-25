import type { Bytes, HashBytes, SignatureBytes } from '@did-btcr2/common';
import type { SchnorrKeyPair } from '@did-btcr2/keypair';
import {
  type KeyIdentifier,
  type KeyManager,
  type GenerateKeyOptions,
  type ImportKeyOptions,
  LocalKeyManager,
  type SignOptions,
  type VerifyOptions,
} from '@did-btcr2/key-manager';
import { assertBytes } from './helpers.js';

/**
 * Key management operations sub-facade.
 *
 * Wraps any {@link KeyManager} interface implementation. By default uses the
 * bundled {@link LocalKeyManager} (in-process reference implementation); a
 * custom implementation (AWS KMS, GCP KMS, HashiCorp Vault, HSM, etc.) can
 * be injected via {@link ApiConfig}.
 *
 * The field is named `kms` because that's the category label callers use
 * conversationally ("plug in your KMS"); the actual contract is the
 * {@link KeyManager} interface.
 * @public
 */
export class KeyManagerApi {
  /** The backing KeyManager instance. */
  readonly kms: KeyManager;

  /** Create a new KeyManagerApi, optionally backed by a custom KeyManager. */
  constructor(kms?: KeyManager) {
    this.kms = kms ?? new LocalKeyManager();
  }

  /** Generate a new key directly in the KMS. */
  generateKey(options?: GenerateKeyOptions): KeyIdentifier {
    return this.kms.generateKey(options);
  }

  /** Set the active key by its identifier. */
  setActive(id: KeyIdentifier): void {
    this.kms.setActiveKey(id);
  }

  /** Get the public key bytes for a key identifier. */
  getPublicKey(id?: KeyIdentifier): Bytes {
    return this.kms.getPublicKey(id);
  }

  /** Read a key's public material and tags, with the secret omitted. */
  getEntry(id?: KeyIdentifier): { publicKey: Bytes; tags?: Record<string, string> } {
    return this.kms.getEntry(id);
  }

  /** Import a Schnorr keypair into the KMS. */
  import(kp: SchnorrKeyPair, options?: ImportKeyOptions): KeyIdentifier {
    return this.kms.importKey(kp, options);
  }

  /**
   * Export a Schnorr keypair from the KMS.
   * Routes through the KeyManager's declared capability (`canExport`) rather
   * than an `instanceof LocalKeyManager` check, so third-party adapters can
   * opt in to export support without coupling to a specific implementation.
   * External adapters (AWS, Vault, HSM) typically advertise `canExport: false`.
   * @throws {Error} If the backing KeyManager does not advertise canExport=true,
   *   or omits the optional `exportKey` method.
   */
  export(id: KeyIdentifier): SchnorrKeyPair {
    if (!this.kms.canExport || !this.kms.exportKey) {
      throw new Error(
        'Key export is not supported by the current KeyManager implementation. '
        + 'The adapter must advertise `canExport: true` and provide an `exportKey` method.'
      );
    }
    return this.kms.exportKey(id);
  }

  /** List all managed key identifiers. */
  listKeys(): KeyIdentifier[] {
    return this.kms.listKeys();
  }

  /** Remove a key from the KMS. */
  removeKey(id: KeyIdentifier, options: { force?: boolean } = {}): void {
    return this.kms.removeKey(id, options);
  }

  /**
   * Sign data via the KMS.
   * @param data The data to sign (must be non-empty).
   * @param id Optional key identifier; uses the active key if omitted.
   * @param options Signing options. Defaults: `scheme: 'bip340'`.
   */
  sign(data: Bytes, id?: KeyIdentifier, options?: SignOptions): SignatureBytes {
    assertBytes(data, 'data');
    return this.kms.sign(data, id, options);
  }

  /** Verify a signature via the KMS. Defaults: `scheme: 'bip340'`. */
  verify(signature: SignatureBytes, data: Bytes, id?: KeyIdentifier, options?: VerifyOptions): boolean {
    return this.kms.verify(signature, data, id, options);
  }

  /** Compute a SHA-256 digest. */
  digest(data: Uint8Array): HashBytes {
    return this.kms.digest(data);
  }
}

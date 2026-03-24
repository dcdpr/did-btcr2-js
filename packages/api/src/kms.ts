import type { Bytes, HashBytes, SignatureBytes } from '@did-btcr2/common';
import { SchnorrKeyPair } from '@did-btcr2/keypair';
import {
  type GenerateKeyOptions,
  type ImportKeyOptions,
  KeyIdentifier,
  KeyManager,
  Kms,
  type SignOptions,
} from '@did-btcr2/kms';
import { assertBytes } from './helpers.js';

/**
 * Key management operations sub-facade.
 *
 * Wraps a {@link KeyManager} interface. By default uses the built-in
 * {@link Kms} implementation; a custom implementation can be injected
 * via {@link ApiConfig}.
 * @public
 */
export class KeyManagerApi {
  /** The backing KeyManager instance. */
  readonly kms: KeyManager;

  /** Create a new KeyManagerApi, optionally backed by a custom KeyManager. */
  constructor(kms?: KeyManager) {
    this.kms = kms ?? new Kms();
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

  /** Import a Schnorr keypair into the KMS. */
  import(kp: SchnorrKeyPair, options?: ImportKeyOptions): KeyIdentifier {
    return this.kms.importKey(kp, options);
  }

  /**
   * Export a Schnorr keypair from the KMS.
   * Only supported when the backing KMS is the built-in {@link Kms} class.
   * @throws {Error} If the backing KMS does not support key export.
   */
  export(id: KeyIdentifier): SchnorrKeyPair {
    if (!(this.kms instanceof Kms)) {
      throw new Error(
        'Key export is not supported by the current KeyManager implementation. '
        + 'Export is only available with the built-in Kms class.'
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
   * @param options Signing options (scheme defaults to 'schnorr').
   */
  sign(data: Bytes, id?: KeyIdentifier, options?: SignOptions): SignatureBytes {
    assertBytes(data, 'data');
    return this.kms.sign(data, id, options);
  }

  /** Verify a signature via the KMS. */
  verify(signature: SignatureBytes, data: Bytes, id?: KeyIdentifier, options?: SignOptions): boolean {
    return this.kms.verify(signature, data, id, options);
  }

  /** Compute a SHA-256 digest. */
  digest(data: Uint8Array): HashBytes {
    return this.kms.digest(data);
  }
}

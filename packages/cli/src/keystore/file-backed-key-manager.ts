import type { Bytes, HashBytes, KeyBytes, SignatureBytes } from '@did-btcr2/common';
import {
  LocalKeyManager,
  type GenerateKeyOptions,
  type ImportKeyOptions,
  type KeyIdentifier,
  type KeyManager,
  type SignOptions,
  type VerifyOptions,
} from '@did-btcr2/key-manager';
import type { SchnorrKeyPair } from '@did-btcr2/keypair';
import { FileKeyStore, type FileKeyStoreOptions } from './file-key-store.js';

/**
 * A {@link KeyManager} backed by the encrypted on-disk {@link FileKeyStore}.
 *
 * It composes a {@link LocalKeyManager} over a {@link FileKeyStore} and adds the
 * one thing the store interface cannot express: persisting the active-key
 * pointer. `LocalKeyManager` tracks the active key only in process memory, so
 * this wrapper mirrors every active-key change to the keystore file and
 * re-applies the persisted pointer at construction. Read and signing
 * operations delegate straight through.
 *
 * Injected as the api's KeyManager so every command reaches it uniformly via
 * `api.kms`, and "the active key" survives across CLI invocations.
 */
export class FileBackedKeyManager implements KeyManager {
  /** Capability probe: the local store supports exporting secret material. */
  readonly canExport = true;

  readonly #store: FileKeyStore;
  readonly #inner: LocalKeyManager;

  constructor(options: FileKeyStoreOptions) {
    this.#store = new FileKeyStore(options);
    this.#inner = new LocalKeyManager(this.#store);
    // Apply the persisted active pointer only if the key still exists. A
    // dangling pointer (from out-of-band file editing or a partial write) is
    // ignored rather than thrown, so recovery commands stay usable; the next
    // setActiveKey overwrites it. has() is a non-decrypting cache lookup.
    const active = this.#store.getActive();
    if (active && this.#store.has(active)) this.#inner.setActiveKey(active);
  }

  get activeKeyId(): KeyIdentifier | undefined {
    return this.#inner.activeKeyId;
  }

  setActiveKey(id: KeyIdentifier): void {
    this.#inner.setActiveKey(id);
    this.#store.setActive(id);
  }

  importKey(keyPair: SchnorrKeyPair, options?: ImportKeyOptions): KeyIdentifier {
    const id = this.#inner.importKey(keyPair, options);
    if (options?.setActive) this.#store.setActive(id);
    return id;
  }

  generateKey(options?: GenerateKeyOptions): KeyIdentifier {
    const id = this.#inner.generateKey(options);
    if (options?.setActive) this.#store.setActive(id);
    return id;
  }

  removeKey(id: KeyIdentifier, options?: { force?: boolean }): void {
    // LocalKeyManager.removeKey calls FileKeyStore.delete, which already clears
    // the persisted active pointer when the removed key was the active one.
    this.#inner.removeKey(id, options);
  }

  listKeys(): KeyIdentifier[] {
    return this.#inner.listKeys();
  }

  getPublicKey(id?: KeyIdentifier): KeyBytes {
    return this.#inner.getPublicKey(id);
  }

  getEntry(id?: KeyIdentifier): { publicKey: KeyBytes; tags?: Record<string, string> } {
    return this.#inner.getEntry(id);
  }

  sign(data: Bytes, id?: KeyIdentifier, options?: SignOptions): SignatureBytes {
    return this.#inner.sign(data, id, options);
  }

  verify(signature: SignatureBytes, data: Bytes, id?: KeyIdentifier, options?: VerifyOptions): boolean {
    return this.#inner.verify(signature, data, id, options);
  }

  digest(data: Uint8Array): HashBytes {
    return this.#inner.digest(data);
  }

  exportKey(id: KeyIdentifier): SchnorrKeyPair {
    return this.#inner.exportKey(id);
  }
}

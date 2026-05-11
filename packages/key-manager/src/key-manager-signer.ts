import type { Bytes, KeyBytes, SignatureBytes } from '@did-btcr2/common';
import type { SignOptions, Signer, SigningScheme } from '@did-btcr2/keypair';
import type { KeyIdentifier, KeyManager } from './interface.js';

/**
 * {@link Signer} adapter that delegates to any {@link KeyManager} implementation
 * and a stored key. The adapter wraps the interface, not a specific concrete
 * class, so it works equally well with the bundled `LocalKeyManager` or with a
 * user-supplied adapter (AWS KMS, GCP KMS, HashiCorp Vault, HSM, etc.).
 *
 * Use this when production code holds keys outside this process and you don't
 * want raw secret bytes flowing through the DID method or beacon broadcast
 * paths.
 *
 * @example
 * ```ts
 * const km = new LocalKeyManager();
 * const id = km.generateKey({ setActive: true });
 * const signer = new KeyManagerSigner(km, id);
 * await beacon.broadcastSignal(update, signer, bitcoin);
 * ```
 *
 * @class KeyManagerSigner
 * @implements {Signer}
 */
export class KeyManagerSigner implements Signer {
  readonly #keyManager: KeyManager;
  readonly #keyId?: KeyIdentifier;
  #cachedPublicKey?: KeyBytes;

  /**
   * @param keyManager The KeyManager that holds the signing key.
   * @param keyId Identifier of the key to use. If omitted, the KeyManager's
   * active key is used at sign-time.
   *
   * When `keyId` is provided, the constructor eagerly resolves the public key
   * to fail fast if the id is a typo or has been removed from the KeyManager.
   * Deferring this check to first sign-time can mask the misconfiguration
   * until after a UTXO has been selected. The lookup also seeds the public-key
   * cache, so the first `publicKey` access doesn't pay an extra round-trip.
   */
  constructor(keyManager: KeyManager, keyId?: KeyIdentifier) {
    this.#keyManager = keyManager;
    this.#keyId = keyId;
    if(keyId !== undefined) {
      this.#cachedPublicKey = keyManager.getPublicKey(keyId);
    }
  }

  /**
   * Compressed secp256k1 public key bytes (33 bytes). Cached on first access so
   * downstream callers (beacon construction, multikey verification) can read it
   * repeatedly without re-hitting the KeyManager. If the underlying key is
   * deleted or rotated, the cached pubkey becomes stale — same trade-off
   * `LocalSigner` makes by holding the secret in heap. Returns a defensive copy
   * to prevent callers from mutating the cached buffer.
   */
  get publicKey(): KeyBytes {
    if(!this.#cachedPublicKey) {
      this.#cachedPublicKey = this.#keyManager.getPublicKey(this.#keyId);
    }
    return new Uint8Array(this.#cachedPublicKey);
  }

  /**
   * Sign the given data with the requested scheme via the wrapped KeyManager.
   * For `'bip341'`, the taproot tweak is applied inside the KeyManager so
   * secret bytes never leave the store.
   */
  sign(data: Bytes, scheme: SigningScheme, opts?: SignOptions): SignatureBytes {
    return this.#keyManager.sign(data, this.#keyId, {
      scheme,
      ...(opts?.merkleRoot !== undefined && { merkleRoot: opts.merkleRoot }),
    });
  }
}

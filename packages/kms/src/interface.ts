import { HashBytes, Hex, SignatureBytes } from '@did-btcr2/common';
import { Multikey, SchnorrMultikey } from '@did-btcr2/cryptosuite';
import { SchnorrKeyPair, CompressedSecp256k1PublicKey } from '@did-btcr2/keypair';
import { KeyValueStore } from '@web5/common';

export type KeyManagerOptions = {
  importKey?: boolean;
  active?: boolean
};

/** Alias type for KeyManager keyUri */
export type KeyIdentifier = string;

/** Params for initializing a KeyManager class instance. */
export type KeyManagerParams = {
  /**
   * An optional property to specify a custom `KeyValueStore` instance for key management. If not
   * provided, {@link KeyManager | `KeyManager`} uses a default `MemoryStore` instance.
   * This store is responsible for managing cryptographic keys, allowing them to be retrieved,
   * stored, and managed during cryptographic operations.
   * @type {KeyValueStore<KeyIdentifier, KeyPair>}
   */
  store?: KeyValueStore<KeyIdentifier, SchnorrMultikey>;

  /**
   * An optional property to specify a key URI for the key manager. If not provided, the key manager
   * will generate a key URI based on the public key of the key pair.
   * @type {KeyIdentifier}
   */
  keyUri?: KeyIdentifier;

  /**
   * An optional property to specify the DID contoller id.
   * @type {string}
   */
  id?: string;

  /**
   * An optional property to specify the DID controller.\
   * @type {string}
   */
  controller?: string;

  /**
   * An optional property to pass in an initial key pair
   * @type {SchnorrKeyPair}
   */
  keys?: SchnorrKeyPair;
};

export type GenerateKeyParams = {
  id: string;
  controller: string;
  options: KeyManagerOptions
};

/**
 * The interface for the KeyManager class.
 * @interface IKeyManager
 * @type {IKeyManager}
 */
export interface IKeyManager {
    /**
     * The URI of the active key.
     * @type {KeyIdentifier}
     */
    activeKeyUri?: KeyIdentifier;

    /**
     * Exports the full key pair from the key store.
     * @param {KeyIdentifier} keyUri The URI of the key to export.
     * @returns {Promise<Multikey | undefined>} The key pair associated with the key URI.
     * @throws {KeyManagerError} If the key is not found in the key store.
     */
    exportKey(keyUri?: KeyIdentifier): Promise<Multikey | undefined>;

    /**
     * Gets the public key of a key pair.
     * @param {KeyIdentifier} keyUri The URI of the key to get the public key for.
     * @returns {Promise<CompressedSecp256k1PublicKey>} The public key of the key pair.
     */
    getPublicKey(keyUri: KeyIdentifier): Promise<CompressedSecp256k1PublicKey>;

    /**
     * Imports a key pair into the key store.
     * @param {SchnorrKeyPair} keyPair The key pair to import.
     * @param {string} keyUri The full DID controller + fragment identifier (e.g. 'did:btcr2:xyz#key-1').
     * @param {KeyManagerOptions} options The options for importing the key pair.
     * @param {boolean} options.active Whether to set the imported key as active.
     * @returns {Promise<KeyIdentifier>} A promise that resolves to the key identifier of the imported key.
     */
    importKey(keyPair: SchnorrKeyPair, keyUri: string, options: KeyManagerOptions): Promise<KeyIdentifier>;
}

export interface CryptoSigner {
  /**
   * Signs a message with a key pair.
   * @param {Hex} data The data to sign.
   * @param {?KeyIdentifier} keyUri The URI of the key to sign the data with.
   * @returns {Promise<SignatureBytes>} The signature of the input data.
   */
  sign(data: Hex, keyUri?: KeyIdentifier): Promise<SignatureBytes>;

  /**
   * Verifies if a signature was produced by a key pair.
   * @param {SignatureBytes} signature The signature to verify.
   * @param {Hex} data The data that was signed.
   * @param {?KeyIdentifier} keyUri The URI of the key to use for verification.
   * @returns {Promise<boolean>} A promise that resolves if the signature is valid, and rejects otherwise.
   */
  verify(signature: SignatureBytes, data: Hex, keyUri?: KeyIdentifier): Promise<boolean>;

  /**
   * Returns the sha256 hash of the input data.
   * @param {Uint8Array} data The data to hash.
   * @returns {HashBytes} The sha256 hash of the input data.
   */
  digest(data: Uint8Array): HashBytes;
}

export interface BitcoinSigner {
  /**
   * Signs a Bitcoin transaction with a key pair.
   * @param txHex The hex-encoded transaction to sign.
   * @param keyUri The URI of the key to sign the transaction with.
   * @returns {Promise<Hex>} A promise that resolves to the hex-encoded signed transaction.
   */
  signTransaction(txHex: Hex, keyUri?: KeyIdentifier): Promise<Hex>;
}

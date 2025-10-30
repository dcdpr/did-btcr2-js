import { HashBytes, Hex, SignatureBytes } from '@did-btcr2/common';
import { CompressedSecp256k1PublicKey, SchnorrKeyPair, Secp256k1SecretKey } from '@did-btcr2/keypair';
import { KeyValueStore } from '@web5/common';

/**
 * Options for KeyManager methods.
 * @property {boolean} [importKey] - Whether to import the key.
 * @property {boolean} [active] - Whether to set the key as active.
 * @property {string} [did] - The DID associated with the key.
 * @property {string} [network] - The network associated with the DID.
 */
export type KeyManagerOptions = {
  importKey?: boolean;
  active?: boolean
  did?: string;
  network?: string;
};

/** Alias type for KeyManager keyUri */
export type KeyIdentifier = string;

/**
 * Parameters for initializing a KeyManager instance.
 * @property {KeyValueStore<KeyIdentifier, SchnorrKeyPair>} [store] - An optional custom key-value store for managing keys.
 * @property {KeyIdentifier} [keyUri] - An optional key URI for the key pair.
 * @property {Secp256k1SecretKey} [secretKey] - An optional secret key to be imported into the key manager.
 */
export type KeyManagerParams = {
  /**
   * An optional property to specify a custom `KeyValueStore` instance for key management. If not
   * provided, {@link KeyManager | `KeyManager`} uses a default `MemoryStore` instance.
   * This store is responsible for managing cryptographic keys, allowing them to be retrieved,
   * stored, and managed during cryptographic operations.
   * @type {KeyValueStore<KeyIdentifier, SchnorrKeyPair>}
   */
  store?: KeyValueStore<KeyIdentifier, SchnorrKeyPair>;

  /**
   * An optional property to specify the active key URI for the key manager.
   * The keyUri could be a DID or a public key hex string. Either can be used to
   * lookup the secret key in the key store.
   * @type {KeyIdentifier}
   */
  keyUri?: KeyIdentifier;

  /**
   * An optional property to specify a secret key to be imported into the key manager.
   * @type {Secp256k1SecretKey}
   */
  secretKey?: Secp256k1SecretKey;
};

/**
 * Parameters for generating a new key pair.
 * @property {string} id - The identifier for the key.
 * @property {string} controller - The controller of the key.
 * @property {KeyManagerOptions} options - Additional options for key generation.
 */
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
     * @returns {Promise<SchnorrKeyPair | undefined>} The key pair associated with the key URI.
     * @throws {KeyManagerError} If the key is not found in the key store.
     */
    exportKey(keyUri?: KeyIdentifier): Promise<SchnorrKeyPair | undefined>;

    /**
     * Gets the public key of a key pair.
     * @param {KeyIdentifier} keyUri The URI of the key to get the public key for.
     * @returns {Promise<CompressedSecp256k1PublicKey>} The public key of the key pair.
     */
    getPublicKey(keyUri: KeyIdentifier): Promise<CompressedSecp256k1PublicKey>;

    /**
     * Imports a key pair into the key store.
     * @param {Secp256k1SecretKey} secretKey The secret key to import.
     * @param {KeyManagerOptions} options The options for importing the key pair.
     * @param {boolean} [options.active] Whether to set the imported key as active.
     * @param {string} [options.did] The DID for the key (optional).
     * @param {string} [options.network] The network for the DID for the key (optional).
     * @returns {Promise<KeyIdentifier>} A promise that resolves to the key identifier of the imported key.
     */
    importKey(secretKey: Secp256k1SecretKey, options: KeyManagerOptions): Promise<KeyIdentifier>;
}

/**
 * The interface for cryptographic signing operations.
 * @interface CryptoSigner
 * @extends {BitcoinSigner}
 * @type {CryptoSigner}
 */
export interface CryptoSigner extends BitcoinSigner {
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

/**
 * The interface for Bitcoin transaction signing operations.
 * @interface BitcoinSigner
 * @type {BitcoinSigner}
 */
export interface BitcoinSigner {
  /**
   * Signs a Bitcoin transaction with a key pair.
   * @param txHex The hex-encoded transaction to sign.
   * @param keyUri The URI of the key to sign the transaction with.
   * @returns {Promise<Hex>} A promise that resolves to the hex-encoded signed transaction.
   */
  signTransaction(txHex: Hex, keyUri?: KeyIdentifier): Promise<Hex>;
}
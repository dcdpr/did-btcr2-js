import { AvailableNetworks } from '@did-btcr2/bitcoin';
import {
  Bytes,
  HashBytes,
  Hex,
  KeyBytes,
  KeyIdentifier,
  KeyManagerError,
  Logger,
  SignatureBytes
} from '@did-btcr2/common';
import { SchnorrKeyPair } from '@did-btcr2/keypair';
import { sha256 } from '@noble/hashes/sha2.js';
import { KeyValueStore, MemoryStore } from '@web5/common';
import { BitcoinSigner, CryptoSigner, KeyManager } from './interface.js';

/**
 * Options for KeyManager methods.
 * @property {boolean} [importKey] - Whether to import the key.
 * @property {boolean} [active] - Whether to set the key as active.
 * @property {string} [did] - The DID associated with the key.
 * @property {string} [network] - The network associated with the DID.
 */
export type KeyManagerOptions = {
  keyUri?: KeyIdentifier;
  importKey?: boolean;
  active?: boolean
  did?: string;
  network?: string;
};

/**
 * Parameters for initializing a KeyManager instance.
 * @property {KeyValueStore<KeyIdentifier, SchnorrKeyPair>} [store] - An optional custom key-value store for managing keys.
 * @property {KeyIdentifier} [keyUri] - An optional key URI for the key pair.
 * @property {SchnorrKeyPair} [keyPair] - An optional key pair to be imported into the key manager.
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
   * lookup the active key in the store.
   * @type {KeyIdentifier}
   */
  keyUri?: KeyIdentifier;

  /**
   * An optional property to specify a key pair to be imported into the key manager
   * upon initialization. If provided along with `keyUri`, the key manager will
   * import the key into the key store and set it as active.
   * @type {SchnorrKeyPair}
   */
  keyPair?: SchnorrKeyPair;
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

export interface SignerParams {
  keyPair: SchnorrKeyPair;
  network: keyof AvailableNetworks;
};

/**
 * Class for managing cryptographic keys for the BTCR2 DID method.
 * @class Kms
 * @type {Kms}
 */
export class Kms implements KeyManager, CryptoSigner, BitcoinSigner  {
  /**
   * Singleton instance of the Kms.
   * @private
   * @type {KeyManager}
   */
  static #instance?: Kms;

  /**
   * The `_store` private variable in `KeyManager` is a `KeyValueStore` instance used for
   * storing and managing cryptographic keys. It allows the `KeyManager` class to save,
   * retrieve, and handle keys efficiently within the local Key Management System (KMS) context.
   * This variable can be configured to use different storage backends, like in-memory storage or
   * persistent storage, providing flexibility in key management according to the application's
   * requirements.
   * @private
   * @readonly
   * @type {KeyValueStore<KeyIdentifier, SchnorrKeyPair>} The key store for managing cryptographic keys.
   */
  readonly #store: KeyValueStore<KeyIdentifier, SchnorrKeyPair>;


  /**
   * The `activeKeyUri` property is a string that represents the URI of the currently active key.
   * It is used to identify the key that will be used for signing and verifying operations.
   * This property is optional and can be set to a specific key URI when initializing the
   * `KeyManager` instance. If not set, the key manager will use the default key URI.
   * @type {KeyIdentifier}
   */
  public activeKeyUri?: KeyIdentifier;

  /**
   * Creates an instance of KeyManager.
   * @param {?KeyManagerParams} params The parameters to initialize the key manager.
   * @param {KeyValueStore<KeyIdentifier, SchnorrKeyPair>} params.store An optional property to specify a custom
   * `KeyValueStore` instance for key management. If not provided, {@link KeyManager} uses a default `MemoryStore`
   * instance. This store is responsible for managing cryptographic keys, allowing them to be retrieved, stored, and
   * managed during cryptographic operations.
   * @param {KeyIdentifier} params.keyUri An optional property to specify the active key URI for the key manager.
   * The keyUri could be a DID or a public key hex string. Either can be used to lookup the secret key in the key store.
   * @param {SchnorrKeyPair} params.keyPair An optional property to specify the secret key for the key manager.
   * If provided along with `keyUri`, the key manager will import the key into the key store and set it as active.
   */
  constructor({ store, keyUri, keyPair }: KeyManagerParams = {}) {
    // Set the default key store to a MemoryStore instance
    this.#store = store ?? new MemoryStore<KeyIdentifier, SchnorrKeyPair>();

    // Import the keys into the key store
    if (keyUri && keyPair) {
      void this.importKey(keyPair, { active: true }).then(() => {
        this.activeKeyUri = keyUri;
      });
    }
  }

  /**
   * Gets the singleton instance of the Kms.
   * @returns {Kms} The singleton instance of the Kms.
   */
  public static get instance(): Kms {
    // Check if the Kms instance is initialized
    if (!Kms.#instance) {
      throw new KeyManagerError('Kms not initialized. Call initialize() first.', 'KMS_NOT_INITIALIZED');
    }
    // Return the singleton instance
    const instance = Kms.#instance;
    return instance;
  }

  /**
   * Signs a transaction using the key associated with the key URI.
   * @param {Hex} txHex The transaction hex to sign.
   * @param {KeyIdentifier} keyUri The URI of the key to sign the transaction with.
   * @returns {Promise<Hex>} A promise resolving to the signed transaction hex.
   */
  public signTransaction(txHex: Hex, keyUri?: KeyIdentifier): Promise<Hex> {
    throw new Error('Method not implemented.' + txHex + keyUri);
  }

  /**
   * Signs the given data using the key associated with the key URI.
   * @param {Bytes} data The data to sign.
   * @param {?KeyIdentifier} keyUri The URI of the key to sign the data with.
   * @returns {Promise<SignatureBytes>} A promise resolving to the signature of the data.
   */
  public async sign(data: Bytes, keyUri?: KeyIdentifier): Promise<SignatureBytes> {
    // Get the key from the store
    const keyPair = await this.getKey(keyUri);

    // Check if the key exists
    if (!keyPair) {
      throw new KeyManagerError(`Key URI ${keyUri} not found`, 'KEY_NOT_FOUND');
    }

    // Check if the key can sign
    if(!keyPair.secretKey) {
      throw new KeyManagerError(`Key URI ${keyUri} is not a signer`, 'KEY_NOT_SIGNER');
    }

    // Sign the data using the key and return the signature
    return keyPair.secretKey.sign(data);
  }

  /**
   * Verifies a signature using the key associated with the key URI.
   * @param {KeyIdentifier} keyUri The URI of the key to verify the signature with.
   * @param {SignatureBytes} signature The signature to verify.
   * @param {Hex} data The data to verify the signature with.
   * @returns {Promise<boolean>} A promise resolving to a boolean indicating the verification result.
   */
  public async verify(signature: SignatureBytes, data: Bytes, keyUri?: KeyIdentifier): Promise<boolean> {
    // Get the key from the store
    const keyPair = await this.getKey(keyUri);

    // Check if the key exists
    if (!keyPair) {
      throw new KeyManagerError(`Key not found for URI: ${keyUri}`, 'KEY_NOT_FOUND');
    }

    // Verify the signature using the multikey
    return keyPair.publicKey.verify(signature, data);
  }

  /**
   * Gets the key from the store using the keyUri.
   * @param {KeyIdentifier} [keyUri] The URI of the key to get the public key for.
   * @returns {Promise<SchnorrKeyPair>} The key pair associated with the key URI.
   * @throws {KeyManagerError} If the key is not found in the key store.
   */
  private async getKey(keyUri?: KeyIdentifier): Promise<SchnorrKeyPair | undefined> {
    // Use the active key URI if not provided
    const uri = keyUri ?? this.activeKeyUri;

    // Throw an error if no key URI is provided or active
    if (!uri) {
      throw new KeyManagerError('No active key uri set.', 'ACTIVE_KEY_URI_NOT_SET');
    }

    // Get the key pair from the key store
    const kp = await this.#store.get(uri);
    if (!kp) {
      throw new KeyManagerError(`Key not found for URI: ${uri}`, 'KEY_NOT_FOUND');
    }

    // Return the key pair
    return kp;
  }

  /**
   * Imports a keypair to the store.
   * @param {SchnorrKeyPair} keyPair The secret key to import.
   * @param {KeyManagerOptions} [options] Relevant import options.
   * @param {KeyIdentifier} [options.keyUri] The URI of the key to import (optional).
   * @param {boolean} [options.active] A flag to set the key as active (optional, default: false).
   * @param {string} [options.did] The DID for the key (optional).
   * @param {string} [options.network] The network for the DID for the key (optional).
   * @returns {Promise<KeyIdentifier>} A promise that resolves to the key identifier of the imported key.
   */
  public async importKey(keyPair: SchnorrKeyPair, options: KeyManagerOptions = {}): Promise<KeyIdentifier> {
    options.keyUri ??= keyPair.publicKey.hex as string;

    // Store the keypair in the key store
    await this.#store.set(options.keyUri, keyPair);

    // Set the key as active if required
    if (options.active) {
      this.activeKeyUri = options.keyUri;
    }

    // Return the key URI
    return options.keyUri;
  }

  /**
   * Computes the hash of the given data.
   * @param {Uint8Array} data The data to hash.
   * @returns {HashBytes} The hash of the data.
   */
  public digest(data: Uint8Array): HashBytes {
    return sha256(data);
  }

  /**
   * Initializes a singleton KeyManager instance.
   * @param {SchnorrKeyPair} keyPair The secret key to import.
   * @param {string} keyUri The URI to set as the active key.
   * @returns {void}
   */
  public static async initialize(keyPair: SchnorrKeyPair, keyUri: string): Promise<Kms> {
    // Check if the KeyManager instance is already initialized
    if (Kms.#instance) {
      Logger.warn('Kms global instance is already initialized.');
      return Kms.#instance;
    }

    // Check if the keypair is provided
    if(!keyPair) {
      // Log a warning message if not provided
      Logger.warn('secretKey not provided, generating ...');
    }

    // Generate a new keypair if not provided
    keyPair ??= SchnorrKeyPair.generate();

    // Initialize the singleton key manager with the keypair
    Kms.#instance = new Kms();

    // Import the keypair into the key store
    await Kms.#instance.importKey(keyPair, { active: true });

    // Set the active key URI
    Kms.#instance.activeKeyUri = keyUri;

    // Log the active key URI
    Logger.info(`Kms initialized with Active Key URI: ${Kms.#instance.activeKeyUri}`);

    // Return the singleton instance
    return Kms.#instance;
  }

  /**
   * Retrieves a keypair from the key store using the provided key URI.
   * @public
   * @param {KeyIdentifier} keyUri The URI of the keypair to retrieve.
   * @returns {Promise<SchnorrKeyPair | undefined>} The retrieved keypair, or undefined if not found.
   */
  public static async getKey(keyUri?: KeyIdentifier): Promise<SchnorrKeyPair | undefined> {
    // Use the active key URI if not provided
    keyUri ??= Kms.#instance?.activeKeyUri;
    // Instantiate a new Kms with the default key store
    return await Kms.#instance?.getKey(keyUri);
  }

  public async getKeySigner(keyUri: KeyIdentifier, network: keyof AvailableNetworks): Promise<Signer> {
    const keyPair = await this.getKey(keyUri);
    if(!keyPair) {
      throw new KeyManagerError(`Key not found for URI: ${keyUri}`, 'KEY_NOT_FOUND');
    }
    return new Signer({ keyPair, network });
  }
}

export class Signer {
  public keyPair: SchnorrKeyPair;
  public network: keyof AvailableNetworks;

  constructor(params: SignerParams) {
    this.keyPair = params.keyPair;
    this.network = params.network;
  }

  get publicKey(): KeyBytes {
    // Return the public key from the multikey
    return this.keyPair.publicKey.compressed;
  }

  public signEcdsa(hash: Bytes): SignatureBytes {
    return this.keyPair.secretKey.sign(hash, { scheme: 'ecdsa' });
  };

  public sign(hash: Bytes): SignatureBytes {
    return this.keyPair.secretKey.sign(hash);
  }
}
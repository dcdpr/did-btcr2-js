import { AvailableNetworks } from '@did-btcr2/bitcoin';
import {
  HashBytes,
  Hex,
  KeyBytes,
<<<<<<<< HEAD:packages/method/src/core/key-manager/index.ts
  KeyManagerError,
========
>>>>>>>> 217a573 (rearrange and rename various parts of beacon/aggregate):packages/method/src/utils/key-manager.ts
  Logger,
  MULTIBASE_URI_PREFIX,
  SchnorrKeyPairObject,
  SignatureBytes
<<<<<<<< HEAD:packages/method/src/core/key-manager/index.ts
} from '@did-btcr2/common';
import { SchnorrMultikey } from '@did-btcr2/cryptosuite';
import { CompressedSecp256k1PublicKey, SchnorrKeyPair } from '@did-btcr2/keypair';
========
} from '@did-btc1/common';
import { Multikey, SchnorrMultikey } from '@did-btc1/cryptosuite';
import { PublicKey, SchnorrKeyPair } from '@did-btc1/keypair';
>>>>>>>> 217a573 (rearrange and rename various parts of beacon/aggregate):packages/method/src/utils/key-manager.ts
import { sha256 } from '@noble/hashes/sha2';
import { KeyValueStore, MemoryStore } from '@web5/common';
import { Did } from '@web5/dids';
import { Multibase } from 'multiformats';
<<<<<<<< HEAD:packages/method/src/core/key-manager/index.ts
import { BitcoinSigner, CryptoSigner, IKeyManager, KeyManagerOptions, KeyManagerParams } from './interface.js';
========
import { AvailableNetworks } from '../bitcoin/index.js';
>>>>>>>> 217a573 (rearrange and rename various parts of beacon/aggregate):packages/method/src/utils/key-manager.ts

export interface SignerParams {
  multikey: SchnorrMultikey;
  network: keyof AvailableNetworks;
};

export type Btc1KeyManagerOptions = {
  importKey?: boolean;
  active?: boolean
};

/** Alias type for Btc1KeyManager keyUri */
export type KeyIdentifier = string;

/** Params for initializing a Btc1KeyManager class instance. */
export type KeyManagerParams = {
  /**
   * An optional property to specify a custom `KeyValueStore` instance for key management. If not
   * provided, {@link Btc1KeyManager | `Btc1KeyManager`} uses a default `MemoryStore` instance.
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
  options: Btc1KeyManagerOptions
};

/**
 * The interface for the Btc1KeyManager class.
 * @interface KeyManager
 * @type {KeyManager}
 */
export interface KeyManager {
    /**
     * The URI of the active key.
     * @type {KeyIdentifier}
     */
    activeKeyUri?: KeyIdentifier;

    /**
     * Exports the full key pair from the key store.
     * @param {KeyIdentifier} keyUri The URI of the key to export.
     * @returns {Promise<Multikey | undefined>} The key pair associated with the key URI.
     * @throws {Btc1KeyManagerError} If the key is not found in the key store.
     */
    exportKey(keyUri?: KeyIdentifier): Promise<Multikey | undefined>;

    /**
     * Gets the public key of a key pair.
     * @param {KeyIdentifier} keyUri The URI of the key to get the public key for.
     * @returns {Promise<PublicKey>} The public key of the key pair.
     */
    getPublicKey(keyUri: KeyIdentifier): Promise<PublicKey>;

    /**
     * Imports a key pair into the key store.
     * @param {SchnorrKeyPair} keyPair The key pair to import.
     * @param {string} keyUri The full DID controller + fragment identifier (e.g. 'did:btc1:xyz#key-1').
     * @param {Btc1KeyManagerOptions} options The options for importing the key pair.
     * @param {boolean} options.active Whether to set the imported key as active.
     * @returns {Promise<KeyIdentifier>} A promise that resolves to the key identifier of the imported key.
     */
    importKey(keyPair: SchnorrKeyPair, keyUri: string, options: Btc1KeyManagerOptions): Promise<KeyIdentifier>;
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

/**
 * Class for managing cryptographic keys for the B DID method.
 * @class KeyManager
 * @type {KeyManager}
 */
export class KeyManager implements IKeyManager, CryptoSigner, BitcoinSigner  {
  /**
   * Singleton instance of the KeyManager.
   * @private
   * @type {KeyManager}
   */
  static #instance?: KeyManager;

  /**
   * The `activeKeyUri` property is a string that represents the URI of the currently active key.
   * It is used to identify the key that will be used for signing and verifying operations.
   * This property is optional and can be set to a specific key URI when initializing the
   * `KeyManager` instance. If not set, the key manager will use the default key URI.
   * @type {KeyIdentifier}
   */
  public activeKeyUri?: KeyIdentifier;

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
  private readonly _store: KeyValueStore<KeyIdentifier, SchnorrMultikey>;

  /**
   * Creates an instance of KeyManager.
   * @param {?KeyManagerParams} params The parameters to initialize the key manager.
   * @param {KeyValueStore<KeyIdentifier, SchnorrMultikey>} params.store An optional property to specify a custom
   * `KeyValueStore` instance for key management. If not provided, {@link KeyManager} uses a default `MemoryStore`
   * instance. This store is responsible for managing cryptographic keys, allowing them to be retrieved, stored, and
   * managed during cryptographic operations.
   * @param {KeyIdentifier} params.keyUri An optional property to specify the active key URI for the key manager.
   */
  constructor({ store, keyUri, keys }: KeyManagerParams = {}) {
    // Set the default key store to a MemoryStore instance
    this._store = store ?? new MemoryStore<KeyIdentifier, SchnorrMultikey>();

    // Import the keys into the key store
    if (keyUri && keys) {
      void this.importKey(keys, keyUri).then(() => {
        this.activeKeyUri = keyUri;
      });
    }
  }

  /**
   * Gets the singleton instance of the KeyManager.
   * @returns {KeyManager} The singleton instance of the KeyManager.
   */
  public static get instance(): KeyManager {
    // Check if the KeyManager instance is initialized
    if (!KeyManager.#instance) {
      throw new KeyManagerError('KeyManager not initialized. Call initialize() first.', 'KEY_MANAGER_NOT_INITIALIZED');
    }
    // Return the singleton instance
    const instance = KeyManager.#instance;
    return instance;
  }

  /**
   * Signs a transaction using the key associated with the key URI.
   * @param {Hex} txHex The transaction hex to sign.
   * @param {KeyIdentifier} keyUri The URI of the key to sign the transaction with.
   * @returns {Promise<Hex>} A promise resolving to the signed transaction hex.
   */
  signTransaction(txHex: Hex, keyUri?: KeyIdentifier): Promise<Hex> {
    throw new Error('Method not implemented.' + txHex + keyUri);
  }

  /**
   * Gets the key pair from the key store and returns a CompressedSecp256k1PublicKey.
   * @param {KeyIdentifier} keyUri The URI of the key to get the public key for.
   * @returns {Promise<CompressedSecp256k1PublicKey>} The public key associated with the key URI.
   */
  public async getPublicKey(keyUri?: KeyIdentifier): Promise<CompressedSecp256k1PublicKey> {
    // Use the active key URI if not provided
    const key = await this.getKey(keyUri);

    // Check if the key exists and has a public key
    if (!key?.publicKey) {
      throw new KeyManagerError(`Key not found for URI: ${keyUri}`, 'KEY_NOT_FOUND');
    }

    // Return the public key
    return key.publicKey;
  }

  /**
   * Signs the given data using the key associated with the key URI.
   * @param {Hex} data The data to sign.
   * @param {?KeyIdentifier} keyUri The URI of the key to sign the data with.
   * @returns {Promise<SignatureBytes>} A promise resolving to the signature of the data.
   */
  public async sign(data: Hex, keyUri?: KeyIdentifier): Promise<SignatureBytes> {
    // Get the key from the store
    const key = await this.getKey(keyUri);

    // Check if the key exists
    if (!key) {
      throw new KeyManagerError(`Key URI ${keyUri} not found`, 'KEY_NOT_FOUND');
    }

    // Check if the key can sign
    if(!key.signer) {
      throw new KeyManagerError(`Key URI ${keyUri} is not a signer`, 'KEY_NOT_SIGNER');
    }

    // Sign the data using the key and return the signature
    return key.sign(data);
  }

  /**
   * Verifies a signature using the key associated with the key URI.
   * @param {KeyIdentifier} keyUri The URI of the key to verify the signature with.
   * @param {SignatureBytes} signature The signature to verify.
   * @param {Hex} data The data to verify the signature with.
   * @returns {Promise<boolean>} A promise resolving to a boolean indicating the verification result.
   */
  public async verify(signature: SignatureBytes, data: Hex, keyUri?: KeyIdentifier): Promise<boolean> {
    // Get the key from the store
    const key = await this.getKey(keyUri);

    // Check if the key exists
    if (!key) {
      throw new KeyManagerError(`Key not found for URI: ${keyUri}`, 'KEY_NOT_FOUND');
    }

    // Verify the signature using the multikey
    return key.verify(signature, data);
  }

  /**
   * Gets the key pair from the key store.
   * @param {KeyIdentifier} keyUri The URI of the key to get.
   * @returns {Promise<SchnorrKeyPair>} The key pair associated with the key URI.
   * @throws {KeyManagerError} If the key is not found in the key store.
   */
  private async getKey(keyUri?: KeyIdentifier): Promise<SchnorrMultikey | undefined> {
    // Use the active key URI if not provided
    const uri = keyUri ?? this.activeKeyUri;

    // Throw an error if no key URI is provided or active
    if (!uri) {
      throw new KeyManagerError('No active key uri set.', 'ACTIVE_KEY_URI_NOT_SET');
    }

    // Get the key pair from the key store
    return await this._store.get(uri);
  }

  /**
   * Exports the full multikeypair from the key store.
   * @returns {Promise<SchnorrKeyPair>} The key pair associated with the key URI.
   * @throws {KeyManagerError} If the key is not found in the key store.
   */
  public async exportKey(keyUri?: KeyIdentifier): Promise<SchnorrMultikey | undefined> {
    // Get the key from the key store and return it
    return await this.getKey(keyUri);
  }

  /**
   * Imports a keypair to the store.
   * @param {SchnorrKeyPair} keys The keypair to import.
   * @param {KeyIdentifier} keyUri The URI of the key to import.
   * @param {KeyManagerOptions} options Relevant import options.
   * @param {boolean} options.active A flag to set the key as active (optional, default: false).
   * @returns {Promise<KeyIdentifier>} A promise that resolves to the key identifier of the imported key.
   */
  public async importKey(keys: SchnorrKeyPair, keyUri: string, options: KeyManagerOptions = {}): Promise<KeyIdentifier> {
    const parts = Did.parse(keyUri);
    if(!parts) {
      throw new KeyManagerError(
        'Invalid key URI: must be valid, parsable BTCR2 identifier',
        'INVALID_KEY_URI',
        { keyUri, parts }
      );
    }

    if(!parts.id) {
      throw new KeyManagerError(
        'Invalid key URI: missing id part',
        'INVALID_KEY_URI',
        { keyUri, parts }
      );
    }

    if(!parts.fragment) {
      throw new KeyManagerError(
        'Invalid key URI: missing fragment part',
        'INVALID_KEY_URI',
        { keyUri, parts }
      );
    }
    // Instantiate a new SchnorrMultikey with the provided keys
    const multikey = new SchnorrMultikey({ controller: parts.uri, id: `#${parts.fragment}`, keys });

    // Store the keypair in the key store
    await this._store.set(keyUri, multikey);

    // Set the key as active if required
    if (options.active) {
      this.activeKeyUri = keyUri;
    }

    // Return the key URI
    return keyUri;
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
   * Computes the key URI of a given keypair.
   * @param {string} id The fragment identifier (e.g. 'key-1').
   * @param {string} [controller] The DID controller (e.g. 'did:btcr2:xyz').
   * @returns {KeyIdentifier} A full DID fragment URI (e.g. 'did:btcr2:xyz#key-1')
   */
  public static computeKeyUri(id: string, controller: string): KeyIdentifier {
    // Concat the id to the controller and return
    return `${controller}${id.startsWith('#') ? id : `#${id}`}`;
  }

  /**
   * Computes a multibase-compliant URI from a key.
   * @param key A SchnorrKeyPair, CompressedSecp256k1PublicKey, or multibase string
   * @returns {string} A multibase URI (e.g. 'urn:mb:zQ3s...')
   */
  public static toMultibaseUri(data: SchnorrKeyPair | CompressedSecp256k1PublicKey | Multibase<'zQ3s'>): string {
    const multibase = data instanceof SchnorrKeyPair
      ? data.publicKey.multibase
      : data instanceof CompressedSecp256k1PublicKey
        ? data.multibase
        : data;

    return `${MULTIBASE_URI_PREFIX}${multibase}`;
  }

  /**
   * Initializes a singleton KeyManager instance.
   * @param {SchnorrKeyPair} keys The keypair used to initialize the key manager.
   * @returns {void}
   */
  public static async initialize(keys: SchnorrKeyPair | SchnorrKeyPairObject, keyUri: string): Promise<KeyManager> {
    if(!(keys instanceof SchnorrKeyPair)) {
      keys = SchnorrKeyPair.fromJSON(keys);
    }

    // Check if the KeyManager instance is already initialized
    if (KeyManager.#instance) {
      Logger.warn('KeyManager global instance is already initialized.');
      return KeyManager.#instance;
    }

    // Check if the keypair is provided
    if(!keys) {
      // Log a warning message if not provided
      Logger.warn('keys not provided, generating ...');
    }

    // Generate a new keypair if not provided
    keys ??= SchnorrKeyPair.generate();

    // Initialize the singleton key manager with the keypair
    KeyManager.#instance = new KeyManager({ keys });

    // Import the keypair into the key store
    await KeyManager.#instance.importKey(keys, keyUri, { active: true });

    // Set the active key URI
    KeyManager.#instance.activeKeyUri = keyUri;

    // Log the active key URI
    Logger.info(`KeyManager initialized with Active Key URI: ${KeyManager.#instance.activeKeyUri}`);

    // Return the singleton instance
    return KeyManager.#instance;
  }

  /**
   * Retrieves a keypair from the key store using the provided key URI.
   * @public
   * @param {KeyIdentifier} keyUri The URI of the keypair to retrieve.
   * @returns {Promise<SchnorrKeyPair | undefined>} The retrieved keypair, or undefined if not found.
   */
  public static async getKeyPair(keyUri?: KeyIdentifier): Promise<SchnorrMultikey | undefined> {
    // Use the active key URI if not provided
    keyUri ??= KeyManager.#instance?.activeKeyUri;
    // Instantiate a new KeyManager with the default key store
    return await KeyManager.#instance?.getKey(keyUri);
  }

  public async getKeySigner(keyUri: KeyIdentifier, network: keyof AvailableNetworks): Promise<Signer> {
    const multikey = await this.getKey(keyUri);
    if(!multikey) {
      throw new KeyManagerError(`Key not found for URI: ${keyUri}`, 'KEY_NOT_FOUND');
    }
    return new Signer({ multikey, network });
  }
}

export class Signer {
  public multikey: SchnorrMultikey;
  public network: keyof AvailableNetworks;

  constructor(params: SignerParams) {
    this.multikey = params.multikey;
    this.network = params.network;
  }

  get publicKey(): KeyBytes {
    // Return the public key from the multikey
    return this.multikey.publicKey.compressed;
  }

  public sign(hash: Hex): SignatureBytes {
    return this.multikey.sign(hash, { scheme: 'ecdsa' });
  };

  public signSchnorr(hash: Hex): SignatureBytes {
    return this.multikey.sign(hash);
  }
}
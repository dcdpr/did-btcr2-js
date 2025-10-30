import { AvailableNetworks } from '@did-btcr2/bitcoin';
import {
  Bytes,
  HashBytes,
  Hex,
  KeyBytes,
  KeyManagerError,
  Logger,
  MULTIBASE_URI_PREFIX,
  SignatureBytes
} from '@did-btcr2/common';
import { CompressedSecp256k1PublicKey, SchnorrKeyPair, Secp256k1SecretKey } from '@did-btcr2/keypair';
import { sha256 } from '@noble/hashes/sha2.js';
import { KeyValueStore, MemoryStore } from '@web5/common';
import { KeyIdentifier } from '@web5/crypto';
import { Multibase } from 'multiformats';
import { BitcoinSigner, CryptoSigner, IKeyManager, KeyManagerOptions, KeyManagerParams } from './interface.js';

export interface SignerParams {
  keyPair: SchnorrKeyPair;
  network: keyof AvailableNetworks;
};

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
  private readonly _store: KeyValueStore<KeyIdentifier, SchnorrKeyPair>;

  /**
   * Creates an instance of KeyManager.
   * @param {?KeyManagerParams} params The parameters to initialize the key manager.
   * @param {KeyValueStore<KeyIdentifier, SchnorrKeyPair>} params.store An optional property to specify a custom
   * `KeyValueStore` instance for key management. If not provided, {@link KeyManager} uses a default `MemoryStore`
   * instance. This store is responsible for managing cryptographic keys, allowing them to be retrieved, stored, and
   * managed during cryptographic operations.
   * @param {KeyIdentifier} params.keyUri An optional property to specify the active key URI for the key manager.
   * The keyUri could be a DID or a public key hex string. Either can be used to lookup the secret key in the key store.
   * @param {Secp256k1SecretKey} params.secretKey An optional property to specify the secret key for the key manager.
   * If provided along with `keyUri`, the key manager will import the key into the key store and set it as active.
   */
  constructor({ store, keyUri, secretKey }: KeyManagerParams = {}) {
    // Set the default key store to a MemoryStore instance
    this._store = store ?? new MemoryStore<KeyIdentifier, SchnorrKeyPair>();

    // Import the keys into the key store
    if (keyUri && secretKey) {
      void this.importKey(secretKey, { active: true }).then(() => {
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
   * Gets the key pair from the key store.
   * @param {KeyIdentifier} keyUri The URI of the key to get.
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
    const kp = await this._store.get(uri);
    if (!kp) {
      throw new KeyManagerError(`Key not found for URI: ${uri}`, 'KEY_NOT_FOUND');
    }

    // Return the key pair
    return kp;
  }

  /**
   * Exports the full multikeypair from the key store.
   * @returns {Promise<SchnorrKeyPair>} The key pair associated with the key URI.
   * @throws {KeyManagerError} If the key is not found in the key store.
   */
  public async exportKey(keyUri?: KeyIdentifier): Promise<SchnorrKeyPair | undefined> {
    // Get the key from the key store and return it
    return await this.getKey(keyUri);
  }

  /**
   * Imports a keypair to the store.
   * @param {Secp256k1SecretKey} secretKey The secret key to import.
   * @param {KeyManagerOptions} options Relevant import options.
   * @param {boolean} options.active A flag to set the key as active (optional, default: false).
   * @param {string} [options.did] The DID for the key (optional).
   * @param {string} [options.network] The network for the DID for the key (optional).
   * @returns {Promise<KeyIdentifier>} A promise that resolves to the key identifier of the imported key.
   */
  public async importKey(secretKey: Secp256k1SecretKey, options: KeyManagerOptions = {}): Promise<KeyIdentifier> {
    // TODO: Create keyUri from public key, require passing network

    // Instantiate a new SchnorrKeyPair with the provided keys
    const kp = new SchnorrKeyPair({ secretKey });

    const keyUri = options.did || options.network;

    if(!keyUri) {
      throw new KeyManagerError('Either DID or network must be provided to import a key.', 'MISSING_DID_OR_NETWORK');
    }

    // Store the keypair in the key store
    await this._store.set(keyUri, kp);

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
   * @param {Secp256k1SecretKey} secretKey The secret key to import.
   * @param {string} keyUri The URI to set as the active key.
   * @returns {void}
   */
  public static async initialize(secretKey: Secp256k1SecretKey, keyUri: string): Promise<KeyManager> {
    // Check if the KeyManager instance is already initialized
    if (KeyManager.#instance) {
      Logger.warn('KeyManager global instance is already initialized.');
      return KeyManager.#instance;
    }

    // Check if the keypair is provided
    if(!secretKey) {
      // Log a warning message if not provided
      Logger.warn('secretKey not provided, generating ...');
    }

    // Generate a new keypair if not provided
    secretKey ??= Secp256k1SecretKey.generate();

    // Initialize the singleton key manager with the keypair
    KeyManager.#instance = new KeyManager({ secretKey });

    // Import the keypair into the key store
    await KeyManager.#instance.importKey(secretKey, { active: true });

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
  public static async getKeyPair(keyUri?: KeyIdentifier): Promise<SchnorrKeyPair | undefined> {
    // Use the active key URI if not provided
    keyUri ??= KeyManager.#instance?.activeKeyUri;
    // Instantiate a new KeyManager with the default key store
    return await KeyManager.#instance?.getKey(keyUri);
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

  public sign(hash: Bytes): SignatureBytes {
    return this.keyPair.secretKey.sign(hash, { scheme: 'ecdsa' });
  };

  public signSchnorr(hash: Bytes): SignatureBytes {
    return this.keyPair.secretKey.sign(hash);
  }
}
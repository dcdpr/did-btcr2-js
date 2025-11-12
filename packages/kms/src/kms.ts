import { Bytes, HashBytes, KeyBytes, KeyManagerError, SignatureBytes } from '@did-btcr2/common';
import { SchnorrKeyPair } from '@did-btcr2/keypair';
import { sha256 } from '@noble/hashes/sha2.js';
import { KeyIdentifier, KeyManager } from './interface.js';
import { KeyValueStore, MemoryStore } from './store.js';

/**
 * Class for managing cryptographic keys for the BTCR2 DID method.
 * @class Kms
 * @type {Kms}
 */
export class Kms implements KeyManager {
  /**
   * Singleton instance of the Kms.
   * @private
   * @type {KeyManager}
   */
  static #instance?: Kms;

  /**
   * The `store` is a private variable in `KeyManager`. It is a `KeyValueStore` instance used for
   * storing and managing cryptographic keys. It allows the `KeyManager` class to save,
   * retrieve, and handle keys efficiently within the local Key Management System (KMS) context.
   * This variable can be configured to use different storage backends, like in-memory storage or
   * persistent storage, providing flexibility in key management according to the application's
   * requirements.
   * @private
   * @type {KeyValueStore<KeyIdentifier, KeyBytes>} The key store for managing cryptographic keys.
   */
  #store: KeyValueStore<KeyIdentifier, KeyBytes>;


  /**
   * The `#activeKeyId` property is a string that points to the currently active key.
   * It is used to identify the key that will be used for signing and verifying operations.
   * This property is optional and can be set to a specific key ID when initializing the
   * `KeyManager` instance. If not set, the key manager will use the default key id.
   * @private
   * @type {KeyIdentifier}
   */
  #activeKeyId?: KeyIdentifier;

  /**
   * Creates an instance of KeyManager.
   * @param {KeyValueStore<KeyIdentifier, KeyBytes>} store An optional property to specify a custom
   * `KeyValueStore` instance for key management. If not provided, {@link KeyManager} uses a default `MemoryStore`
   * instance. This store is responsible for managing cryptographic keys, allowing them to be retrieved, stored, and
   * managed during cryptographic operations.
   */
  constructor(store?: KeyValueStore<KeyIdentifier, KeyBytes>) {
    // Set the default key store to a MemoryStore instance
    this.#store = store ?? new MemoryStore<KeyIdentifier, KeyBytes>();
  }

  /**
   * Gets the ID of the active key.
   * @returns {KeyIdentifier | undefined} The ID of the active key.
   */
  get activeKeyId(): KeyIdentifier | undefined {
    return this.#activeKeyId;
  }

  /**
   * Gets the key pair associated with the given ID or the active key if no ID is provided.
   * @param {KeyIdentifier} [id] The ID of the key to get.
   * @returns {KeyBytes} A promise resolving to the key pair.
   * @throws {KeyManagerError} If the key is not found or no active key is set.
   */
  #getKeyOrThrow(id?: KeyIdentifier): SchnorrKeyPair {
    // Get the key id
    const keyId = id ?? this.#activeKeyId;
    // Throw an error if no active key is set
    if (!keyId) {
      throw new KeyManagerError('No active key set', 'ACTIVE_KEY_URI_NOT_SET');
    }

    // Get the secret key from the store, throw an error if not found
    const _secretKey = this.#store.get(keyId);
    if (!_secretKey) {
      throw new KeyManagerError(`Key not found: ${keyId}`, 'KEY_NOT_FOUND');
    }

    // Create a key pair from the secret key
    const kp = new SchnorrKeyPair({ secretKey: _secretKey });

    // Return the secret key
    return kp;
  }

  /**
   * Checks if a key with the given ID exists in the key store.
   * @param {KeyIdentifier} id The ID of the key to check.
   * @returns {boolean} A promise resolving to a boolean indicating if the key exists.
   */
  #exists(id: KeyIdentifier): boolean {
    const key = this.#store.get(id);
    return !!key;
  }

  /**
   * Removes a key from the key store.
   * @param {KeyIdentifier} id The key identifier of the key to remove.
   * @param {{ force?: boolean }} options The options for removing the key.
   * @param {boolean} [options.force] Whether to force the removal of the key.
   * @returns {void} A promise that resolves when the key is removed.
   * @throws {KeyManagerError} If attempting to remove the active key without force.
   */
  removeKey(id: KeyIdentifier, options: { force?: boolean } = {}): void {
    // Check if trying to remove the active key without force
    if (this.#activeKeyId === id && !options.force) {
      throw new KeyManagerError('Cannot remove active key (use "force": true or switch active key)', 'ACTIVE_KEY_DELETE');
    }

    // Check if the key exists, if not throw an error
    if (!this.#exists(id)) {
      throw new KeyManagerError(`Key not found: ${id}`, 'KEY_NOT_FOUND');
    }

    // Remove the key from the store
    this.#store.delete(id);

    // Clear the active key if it was the one removed
    if (this.#activeKeyId === id) {
      this.#activeKeyId = undefined;
    }
  }

  /**
   * Lists all key identifiers in the key store.
   * @returns {Promise<KeyIdentifier[]>} A promise that resolves to an array of key identifiers.
   */
  listKeys(): KeyIdentifier[] {
    return this.#store.entries().flatMap(([k, _]) => [k as KeyIdentifier]);
  }

  /**
   * Sets the active key to the key associated with the given ID.
   * @param {KeyIdentifier} id The ID of the key to set as active.
   * @returns {Promise<void>} A promise that resolves when the active key is set.
   * @throws {KeyManagerError} If the key is not found.
   */
  setActiveKey(id: KeyIdentifier): void {
    // Check if the key exists, if not throw an error
    this.#getKeyOrThrow(id);

    // Set the active key ID
    this.#activeKeyId = id;
  }

  /**
   * Gets the public key associated with the given ID or the active key if no ID is provided.
   * @param {KeyIdentifier} [id] The ID of the key to get the public key for.
   * @returns {Promise<KeyBytes>} A promise resolving to the public key bytes.
   */
  getPublicKey(id?: KeyIdentifier): KeyBytes {
    // Get the key pair from the store
    const { publicKey } = this.#getKeyOrThrow(id);

    // Return the public key bytes
    return publicKey.compressed;
  }

  /**
   * Signs the given data using the key associated with the key ID.
   * @param {Bytes} data The data to sign.
   * @param {KeyIdentifier} [id] The ID of the key to sign the data with.
   * @returns {Promise<SignatureBytes>} A promise resolving to the signature of the data.
   */
  sign(data: Bytes, id?: KeyIdentifier): SignatureBytes {
    // Get the key from the store
    const { secretKey } = this.#getKeyOrThrow(id);

    // Check if the key can sign
    if(!secretKey) {
      throw new KeyManagerError(`Key ID ${id} is not a signer`, 'KEY_NOT_SIGNER');
    }

    // Sign the data using the key and return the signature
    return secretKey.sign(data);
  }

  /**
   * Verifies a signature using the key associated with the key ID.
   * @param {KeyIdentifier} id The ID of the key to verify the signature with.
   * @param {SignatureBytes} signature The signature to verify.
   * @param {Hex} data The data to verify the signature with.
   * @returns {Promise<boolean>} A promise resolving to a boolean indicating the verification result.
   */
  verify(signature: SignatureBytes, data: Bytes, id?: KeyIdentifier): boolean {
    // Get the key from the store
    const { publicKey } = this.#getKeyOrThrow(id);

    // Verify the signature using the multikey
    return publicKey.verify(signature, data);
  }

  /**
   * Imports a key pair into the key store.
   * @param {SchnorrKeyPair} keyPair The key pair to import.
   * @param {{ id?: KeyIdentifier; setActive?: boolean }} options The options for importing the key pair.
   * @param {KeyIdentifier} [options.id] The ID of the key to import (optional).
   * @param {boolean} [options.setActive] Whether to set the key as active (optional, default: true).
   * @returns {Promise<KeyIdentifier>} A promise resolving to the ID of the imported key.
   */
  importKey(
    keyPair: SchnorrKeyPair,
    options: {
      id?: KeyIdentifier;
      setActive?: boolean
    } = {}
  ): KeyIdentifier {
    // Ensure the key pair has a public key
    if(!keyPair.publicKey) {
      keyPair.publicKey = keyPair.secretKey.computePublicKey();
    }

    // Determine the key ID
    const id = options.id ?? (keyPair.publicKey.hex as string);

    // Check if the key already exists
    if (this.#exists(id)) {
      throw new KeyManagerError(`Key already exists: ${id}`, 'KEY_FOUND');
    }

    // Store the key pair in the key store
    this.#store.set(id, keyPair.secretKey.bytes);

    // Determine whether to set the key as active, defaulting to true
    const setActive = options.setActive ?? true;

    // Set the active key if specified
    if (setActive) {
      this.#activeKeyId = id;
    }

    // Return the key ID
    return id;
  }

  /**
   * Computes the hash of the given data.
   * @param {Uint8Array} data The data to hash.
   * @returns {HashBytes} The hash of the data.
   */
  digest(data: Uint8Array): HashBytes {
    return sha256(data);
  }

  /**
   * Generates a new key pair and stores it in the key store.
   * @returns {KeyIdentifier} The key identifier of the generated key.
   */
  generateKey(): KeyIdentifier {
    // Generate a new Schnorr key pair
    const kp = SchnorrKeyPair.generate();

    // Store the key pair in the key store
    const id = kp.publicKey.hex;
    this.#store.set(id, kp.secretKey.bytes);

    // Set the active key to the newly generated key
    this.#activeKeyId = id;

    // Return the key ID
    return id;
  }

  /**
   * Initializes a singleton KeyManager instance.
   * @param {SchnorrKeyPair} keyPair The secret key to import.
   * @param {string} id The ID to set as the active key.
   * @returns {void}
   */
  static initialize(keyPair: SchnorrKeyPair, id: string): Kms {
    // Check if the KeyManager instance is already initialized
    if (Kms.#instance) {
      console.warn('WARNING: Kms global instance is already initialized.');
      return Kms.#instance;
    }

    // Check if the keypair is provided
    if(!keyPair) {
      // Log a warning message if not provided
      console.warn('WARNING: secretKey not provided, generating new SchnorrKeyPair ...');
    }

    // Generate a new keypair if not provided
    keyPair ??= SchnorrKeyPair.generate();

    // Initialize the singleton key manager with the keypair
    Kms.#instance = new Kms();

    // Import the keypair into the key store
    Kms.#instance.importKey(keyPair, { setActive: true, id });

    // Set the active key URI7
    Kms.#instance.#activeKeyId = id;

    // Log the active key ID
    console.info(`Kms initialized with Active Key ID: ${Kms.#instance.#activeKeyId}`);

    // Return the singleton instance
    return Kms.#instance;
  }

  /**
   * Retrieves a keypair from the key store using the provided key ID.
   * @public
   * @param {KeyIdentifier} id The ID of the keypair to retrieve.
   * @returns {Promise<SchnorrKeyPair | undefined>} The retrieved keypair, or undefined if not found.
   */
  static getKey(id?: KeyIdentifier): SchnorrKeyPair | undefined {
    // Ensure the Kms instance is initialized
    if(!Kms.#instance) {
      throw new KeyManagerError('Kms instance not initialized', 'KMS_NOT_INITIALIZED');
    }

    // Use the active key ID if not provided
    id ??= Kms.#instance.activeKeyId;

    // Instantiate a new Kms with the default key store
    return Kms.#instance.#getKeyOrThrow(id);
  }
}
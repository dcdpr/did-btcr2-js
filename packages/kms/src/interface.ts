import { Bytes, HashBytes, KeyBytes, SignatureBytes } from '@did-btcr2/common';
import { SchnorrKeyPair } from '@did-btcr2/keypair';

export type KeyIdentifier = string;

/**
 * The interface for the Kms class.
 * @interface KeyManager
 * @type {KeyManager}
 */
export interface KeyManager {
  /**
   * The ID of the active key.
   * @readonly
   * @type {KeyIdentifier}
   */
  readonly activeKeyId?: KeyIdentifier

  /**
   * Set the active key id.
   * @param id The key id to set as active.
   */
  setActiveKey(id: KeyIdentifier): void;

  /**
   * Import a key pair.
   * @param {SchnorrKeyPair} keyPair The secret key to import.
   * @param {{ id?: KeyIdentifier, setActive?: boolean }} options The options for importing the key pair.
   * @param {KeyIdentifier} [options.id] The ID of the key to import (optional).
   * @param {boolean} [options.setActive] Whether to set the key as active (optional, default: false).
   * @returns {KeyIdentifier} A promise that resolves to the key identifier of the imported key.
   */
  importKey(keyPair: SchnorrKeyPair, options: { id?: KeyIdentifier; setActive?: boolean }): KeyIdentifier;

  /**
   * Removes a key from the key store.
   * @param {KeyIdentifier} id The key identifier of the key to remove.
   * @param {{ force?: boolean }} options The options for removing the key.
   * @param {boolean} [options.force] Whether to force the removal of the key.
   * @returns {void} A promise that resolves when the key is removed.
   */
  removeKey(id: KeyIdentifier, options: { force?: boolean }): void;

  /**
   * Lists all key identifiers in the key store.
   * @returns {KeyIdentifier[]} An array of key identifiers.
   */
  listKeys(): KeyIdentifier[];

  /**
   * Gets the public key associated with the ID or active key.
   * @param {KeyIdentifier} [id] The ID of the key to get the public key for.
   * @returns {KeyBytes} A promise resolving to the public key bytes.
   */
  getPublicKey(id?: KeyIdentifier): KeyBytes;

  /**
   * Signs the given data using the key associated with the key ID.
   * @param {Bytes} data The data to sign.
   * @param {KeyIdentifier} [id] The ID of the key to sign the data with.
   * @returns {SignatureBytes} A promise resolving to the signature of the data.
   */
  sign(data: Bytes, id?: KeyIdentifier): SignatureBytes;

  /**
   * Verifies a signature using the key associated with the key ID.
   * @param {KeyIdentifier} id The ID of the key to verify the signature with.
   * @param {SignatureBytes} signature The signature to verify.
   * @param {Hex} data The data to verify the signature with.
   * @returns {boolean} A promise resolving to a boolean indicating the verification result.
   */
  verify(signature: SignatureBytes, data: Bytes, id?: KeyIdentifier): boolean;

  /**
   * Computes the hash of the given data.
   * @param {Uint8Array} data The data to hash.
   * @returns {HashBytes} The hash of the data.
   */
  digest(data: Uint8Array): HashBytes;

  /**
   * Generates a new key pair and stores it in the key store.
   * @returns {KeyIdentifier} The identifier of the newly generated key.
   */
  generateKey(): KeyIdentifier;
}
import { Bytes, HashBytes, Hex, KeyIdentifier, SignatureBytes } from '@did-btcr2/common';
import { Algo } from './types.js';

/**
 * The interface for the Kms class.
 * @interface KeyManager
 * @type {KeyManager}
 */
export interface KeyManager {
  /**
   * The URI of the active key.
   * @type {KeyIdentifier}
   */
  activeKeyUri?: KeyIdentifier

  /**
   * Signs the given data using the key associated with the key URI.
   * @param {Bytes} data The data to sign.
   * @param {KeyIdentifier} [keyUri] The URI of the key to sign the data with.
   * @returns {Promise<SignatureBytes>} A promise resolving to the signature of the data.
   */
  sign(data: Bytes, keyUri?: KeyIdentifier): Promise<SignatureBytes>;

  /**
   * Verifies a signature using the key associated with the key URI.
   * @param {KeyIdentifier} keyUri The URI of the key to verify the signature with.
   * @param {SignatureBytes} signature The signature to verify.
   * @param {Hex} data The data to verify the signature with.
   * @returns {Promise<boolean>} A promise resolving to a boolean indicating the verification result.
   */
  verify(signature: SignatureBytes, data: Bytes, keyUri?: KeyIdentifier): Promise<boolean>;

  /**
   * Imports a key pair into the key store.
   * @param {Uint8Array} secretKey The secret key to import.
   * @param {Uint8Array} publicKey The public key to import.
   * @param {Object} opts Options for importing the key.
   * @param {Algo} [opts.algo] The algorithm of the key.
   * @param {boolean} [opts.exportable] Whether the key is exportable.
   * @param {string} [opts.passphrase] The passphrase to encrypt the key at rest.
   * @param {boolean} [opts.active] Whether to set the imported key as the active key.
   * @returns {Promise<KeyIdentifier>} A promise that resolves to the key identifier of the imported key.
   */
  importKey(secretKey: Uint8Array, publicKey: Uint8Array, opts: {
      algo?: Algo;
      exportable?: boolean;
      passphrase?: string;
      active?: boolean;
    }): Promise<KeyIdentifier>;

  /**
   * Computes the hash of the given data.
   * @param {Uint8Array} data The data to hash.
   * @returns {HashBytes} The hash of the data.
   */
  digest(data: Uint8Array): HashBytes;
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
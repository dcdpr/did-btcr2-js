import { NetworkName } from '@did-btcr2/bitcoin';
import { KeyBytes, Bytes, SignatureBytes } from '@did-btcr2/common';
import {  SchnorrKeyPair } from '@did-btcr2/keypair';

/**
 * Class representing a signer for cryptographic operations.
 * Remains for backwards compatibility. Plan to migrate to Kms.
 * @class Signer
 * @type {Signer}
 */
export class Signer {
  /**
   * The key pair used for signing.
   * @type {SchnorrKeyPair}
   */
  keyPair: SchnorrKeyPair;

  /**
   * The network associated with the signer.
   * @type {NetworkName}
   */
  network: NetworkName;

  /**
   * Creates an instance of Signer.
   * @param {{ keyPair: SchnorrKeyPair; network: NetworkName; }} params The parameters for the signer.
   * @param {SchnorrKeyPair} params.keyPair The key pair used for signing.
   * @param {NetworkName} params.network The network associated with the signer.
   */
  constructor(params: { keyPair: SchnorrKeyPair; network: NetworkName; }) {
    this.keyPair = params.keyPair;
    this.network = params.network;
  }

  /**
   * Gets the public key bytes.
   * @returns {KeyBytes} The public key bytes.
   */
  get publicKey(): KeyBytes {
    return this.keyPair.publicKey.compressed;
  }

  /**
   * Signs the given hash using ECDSA.
   * @param {Bytes} hash The hash to sign.
   * @returns {SignatureBytes} The signature of the hash.
   */
  sign(hash: Bytes): SignatureBytes {
    return this.keyPair.secretKey.sign(hash, { scheme: 'ecdsa' });
  };

  /**
   * Signs the given hash using Schnorr signature.
   * @param {Bytes} hash The hash to sign.
   * @returns {SignatureBytes} The Schnorr signature of the hash.
   */
  signSchnorr(hash: Bytes): SignatureBytes {
    return this.keyPair.secretKey.sign(hash);
  }
}
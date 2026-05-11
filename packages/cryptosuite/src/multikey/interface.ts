import type { KeyBytes, MessageBytes, SchnorrKeyPairObject, SignatureBytes } from '@did-btcr2/common';
import type { CompressedSecp256k1PublicKey, SchnorrKeyPair, Secp256k1SecretKey } from '@did-btcr2/keypair';
import type { DidVerificationMethod } from '@web5/dids';

export type MultikeyObject = {
  id: string;
  controller: string;
  fullId: string;
  signer: boolean;
  keyPair: SchnorrKeyPairObject;
  verificationMethod: DidVerificationMethod;
}
export interface DidParams {
  id: string;
  controller: string;
}

export interface FromSecretKey extends DidParams {
  entropy: KeyBytes;
}
export interface FromPublicKey extends DidParams {
  publicKeyBytes: KeyBytes;
}
export interface FromPublicKeyMultibaseParams extends DidParams {
  publicKeyMultibase: string;
}

/**
 * Interface for a {@link https://dcdpr.github.io/data-integrity-schnorr-secp256k1/#multikey | 2.1.1 Multikey}.
 * @interface Multikey
 */
export interface Multikey {
  /** @type {string} @readonly Get the id. */
  readonly id: string;

  /** @type {string} @readonly Get the controller. */
  readonly controller: string;

  /** @type {SchnorrKeyPair} @readonly Get the keyPair. */
  readonly keyPair: SchnorrKeyPair;

  /** @type {CompressedSecp256k1PublicKey} @readonly Get the CompressedSecp256k1PublicKey. */
  readonly publicKey: CompressedSecp256k1PublicKey;

  /** @type {Secp256k1SecretKey} @readonly Get the Secp256k1SecretKey. */
  readonly secretKey?: Secp256k1SecretKey;

  /** @type {boolean} @readonly Get signing ability of the (i.e. is there a valid secretKey). */
  readonly signer: boolean;

  /**
   * Produce a BIP-340 Schnorr signature over the given data.
   * @param {MessageBytes} data Data to be signed.
   * @returns {SignatureBytes} 64-byte BIP-340 Schnorr signature.
   * @throws {MultikeyError} if no signing material is available.
   */
  sign(data: MessageBytes): SignatureBytes;

  /**
   * Verify a BIP-340 Schnorr signature.
   * @param {SignatureBytes} signature 64-byte BIP-340 Schnorr signature.
   * @param {MessageBytes} data Data the signature was produced over.
   * @returns {boolean} If the signature is valid against the public key.
   */
  verify(signature: SignatureBytes, data: MessageBytes): boolean;

  /**
   * Get the full id of the multikey
   * @returns {string} The full id of the multikey
   */
  fullId(): string

  /**
   * Convert the multikey to a verification method.
   * @returns {DidVerificationMethod} The verification method.
   */
  toVerificationMethod(): DidVerificationMethod;
}
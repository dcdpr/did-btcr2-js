import { KeyBytes, MessageBytes, SchnorrKeyPairObject, SignatureBytes } from '@did-btcr2/common';
import { CompressedSecp256k1PublicKey, SchnorrKeyPair, Secp256k1SecretKey } from '@did-btcr2/keypair';
import { DidVerificationMethod } from '@web5/dids';

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
   * Produce signed data with a secret key.
   * @param {MessageBytes} data Data to be signed.
   * @returns {SignatureBytes} Signature byte array.
   * @throws {MultikeyError} if no secret key is provided.
   */
  sign(data: MessageBytes, opts: { scheme: 'ecdsa' | 'schnorr' }): SignatureBytes;

  /**
   * Verify a schnorr signature.
   * @param {SignatureBytes} signature Signature for verification.
   * @param {string} message Data for verification.
   * @returns {boolean} If the signature is valid against the public key.
   */
  verify(signature: SignatureBytes, message: string, opts: { scheme: 'ecdsa' | 'schnorr' }): boolean;

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

  /**
   * Convert a verification method to a multikey.
   * @param {DidVerificationMethod} verificationMethod The verification method to convert.
   * @returns {Multikey} Multikey instance.
   * @throws {MultikeyError}
   * if the verification method is missing required fields.
   * if the verification method has an invalid type.
   * if the publicKeyMultibase has an invalid prefix.
   */
  fromVerificationMethod(verificationMethod: DidVerificationMethod): Multikey;

  /**
   * Convert the multikey to a JSON object.
   * @returns {MultikeyObject} The multikey as a JSON object.
   */
  json(): MultikeyObject;
}
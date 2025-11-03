export type Algo =
  | 'secp256k1-schnorr'
  | 'secp256k1-ecdsa'
  | 'ed25519';

export type Capability = 'sign' | 'readPublic' | 'derive' | 'export';

export type KeyIdentifier = string;

export type EncryptedSecret = {
  aead: 'aes-256-gcm';
  kdf: 'scrypt';
  salt: Uint8Array;
  nonce: Uint8Array;
  ciphertext: Uint8Array;
  version: 1;
};

export type KeyRecord = {
  keyUri: KeyIdentifier;
  algo: Algo;
  publicKey: Uint8Array;
  createdAt: string;
  derivation?: string;
  encryptedSecret?: EncryptedSecret;
  exportable: boolean;
  usage: Array<'sign'|'derive'|'encrypt'|'auth'>;
  scope: 'local' | 'hw' | 'webauthn' | 'remote';
};

export interface KeyHandle {
  keyUri: KeyIdentifier;
  algo: Algo;
  capabilities: Capability[];
  sign?(msg: Uint8Array): Promise<Uint8Array>;
  getPublic(): Promise<Uint8Array>;
}

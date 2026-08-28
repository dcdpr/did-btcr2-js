// Upstream re-exports
export {
  BeaconFactory,
  BeaconUtils,
  DidBtcr2,
  DidDocument,
  DidDocumentBuilder,
  GenesisDocument,
  Identifier,
  Resolver,
  Updater
} from '@did-btcr2/method';
export type {
  BeaconService,
  BroadcastOptions,
  BroadcastResult,
  Btcr2DidDocument,
  CASAnnouncement,
  DidCreateOptions,
  IdentifierComponents,
  ResolutionOptions,
  Sidecar,
  SignedBTCR2Update,
  SMTProof
} from '@did-btcr2/method';
export { IdentifierTypes } from '@did-btcr2/common';
export { BitcoinConnection } from '@did-btcr2/bitcoin';
export type {
  BlockV3,
  HttpExecutor,
  NetworkName,
  RawTransactionV2,
  RestConfig,
  RpcConfig
} from '@did-btcr2/bitcoin';
export type {
  Bytes,
  CryptosuiteName,
  DocumentBytes,
  HashBytes,
  Hex,
  JSONObject,
  KeyBytes,
  PatchOperation,
  ProofBytes,
  SchnorrKeyPairObject,
  SignatureBytes
} from '@did-btcr2/common';
export type { MultikeyObject } from '@did-btcr2/cryptosuite';
export type { DidResolutionResult, DidService, DidVerificationMethod } from '@web5/dids';

// Signers. `Signer` is in the signature of every write on this facade, so the
// interface and both bundled implementations ship here: completing a CRUD
// cycle must not require a second package to obtain or type a signer.
export { LocalSigner, SchnorrKeyPair } from '@did-btcr2/keypair';
export type { Signer, SigningScheme, SignOptions } from '@did-btcr2/keypair';
export { KeyManagerSigner, LocalKeyManager } from '@did-btcr2/key-manager';
export type {
  GenerateKeyOptions,
  ImportKeyOptions,
  KeyIdentifier,
  KeyManager,
  VerifyOptions
} from '@did-btcr2/key-manager';

// keypair and key-manager both export a `SignOptions`, and the shapes differ:
// key-manager's is keypair's plus a `scheme` field, because `KeyManager.sign`
// takes its scheme in options where `Signer.sign` takes it positionally. The
// plain name belongs to the Signer-level shape; the KeyManager-level shape
// exports qualified.
export type { SignOptions as KmsSignOptions } from '@did-btcr2/key-manager';

// Local modules
export * from './types.js';
export * from './helpers.js';
export * from './bitcoin.js';
export * from './cas.js';
export * from './presets.js';
export * from './key-manager.js';
export * from './crypto.js';
export * from './did.js';
export * from './method.js';
export * from './api.js';

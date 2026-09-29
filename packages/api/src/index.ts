// The public surface of the api (ADR 132). Every export is an explicit name.
//
// - A runtime value is the facade, a sub-facade class, a configuration class,
//   a constant or preset for a user, or an error class that the facade throws.
// - A type is exported if and only if a public signature of the facade uses
//   it: a parameter, a return type, a public property, or a field of an
//   exported type. A member of a class from a lower package does not count.
//   A type of a third-party package is exported only if a facade signature
//   names it. If the api exports a type under its own name, or exports a
//   compatible type with the same name, the lower-package name stays out.
//
// A caller does a CRUD operation through a sub-facade function. The api does
// not re-export the classes of the lower packages as values.

// The facade and its sub-facades
export { createApi, DidBtcr2Api } from './api.js';
export { BitcoinApi, DEFAULT_BITCOIN_NETWORK_CONFIG } from './bitcoin.js';
export {
  BlockstoreCasExecutor,
  CasApi,
  DEFAULT_CAS_GATEWAY,
  DEFAULT_CAS_TIMEOUT_MS,
  HttpGatewayCasExecutor,
  IpfsRpcCasExecutor
} from './cas.js';
export type {
  BlockstoreLike,
  BlockstoreProviderLike,
  CasConfig,
  CasExecutor,
  IpfsRpcAuth,
  IpfsRpcCasExecutorOptions
} from './cas.js';
export { CryptoApi, CryptosuiteApi, DataIntegrityProofApi, KeyPairApi, MultikeyApi } from './crypto.js';
export { DidApi } from './did.js';
export {
  BEACON_ADDRESS_TYPES,
  BEACON_TYPES,
  DEFAULT_BEACON_ADDRESS_TYPE,
  VERIFICATION_RELATIONSHIPS
} from './genesis.js';
export type {
  BeaconAddressType,
  BeaconType,
  GenesisBeaconSpec,
  GenesisDocumentSpec,
  GenesisVerificationMethodSpec,
  VerificationRelationship
} from './genesis.js';
export { KeyManagerApi } from './key-manager.js';
export { DidMethodApi } from './method.js';
export type {
  AnnounceOptions,
  BeaconInfo,
  DidUpdateOptions,
  DidUpdateResult,
  ExternalCreateResult,
  PublishToCasMode,
  SourceState,
  UpdateOptions,
  UpdateSource
} from './method.js';
export { explorerAddressUrl, explorerTxUrl, faucetUrl, NETWORK_PRESETS } from './presets.js';
export type { NetworkPreset } from './presets.js';
export { SmtApi } from './smt.js';
export type { SmtEntry, SmtTree } from './smt.js';
export type {
  ApiConfig,
  BitcoinApiConfig,
  DidString,
  IdType,
  Logger,
  ResolutionResult,
  SignalDiscoveryMode,
  TxId
} from './types.js';

// Constants for a user
export { DEFAULT_MIN_CONF } from '@did-btcr2/method';

// Error classes. `DidMethodError` is the base class of each error that the
// facade throws; its `type` is the error code.
export {
  DidDocumentError,
  DidMethodError,
  IdentifierError,
  MethodError,
  ResolveError,
  UpdateError
} from '@did-btcr2/common';

// Types from the lower packages that the public signatures use
export type {
  AddressUtxo,
  BitcoinConnection,
  BitcoinCoreRpcClient,
  BitcoinRestClient,
  EsploraBlock,
  FeeEstimator,
  HttpExecutor,
  HttpRequest,
  NetworkName,
  RawTransactionRest,
  RestConfig,
  RpcConfig,
  TransactionStatus,
  Vin,
  Vout
} from '@did-btcr2/bitcoin';
export type {
  Bytes,
  DocumentBytes,
  Entropy,
  HashBytes,
  HexString,
  JSONObject,
  KeyBytes,
  MultibaseObject,
  PatchOpCode,
  PatchOperation,
  Point,
  PublicKeyObject,
  SchnorrKeyPairObject,
  SecretKeyObject,
  SignatureBytes
} from '@did-btcr2/common';
export type {
  BIP340Cryptosuite,
  BIP340DataIntegrityProof,
  DataIntegrityProofObject,
  DataIntegrityProofOptions,
  DidParams,
  FromPublicKey,
  Multikey,
  SchnorrMultikey,
  SecuredDocument,
  UnsecuredDocument,
  VerificationResult
} from '@did-btcr2/cryptosuite';
export type {
  CompressedSecp256k1PublicKey,
  SchnorrKeyPair,
  Secp256k1SecretKey,
  Signer,
  SigningScheme,
  SignOptions
} from '@did-btcr2/keypair';
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
export type {
  BeaconService,
  BroadcastOptions,
  Btcr2DataIntegrityProof,
  Btcr2DidDocument,
  CASAnnouncement,
  DidComponents,
  DidCreateOptions,
  IdentifierCheck,
  IdentifierCheckName,
  IdentifierComponents,
  IdentifierReport,
  IdentifierValidateOptions,
  ResolutionOptions,
  RootCapability,
  Sidecar,
  SignedBTCR2Update,
  SMTProof,
  UnsignedBTCR2Update
} from '@did-btcr2/method';
export type { Did, DidResolutionResult, DidService, DidVerificationMethod } from '@web5/dids';
export type { CID } from 'multiformats/cid';

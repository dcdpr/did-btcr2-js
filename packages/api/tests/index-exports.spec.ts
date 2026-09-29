import { expect } from 'chai';
import * as surface from '../src/index.js';
import {
  BEACON_ADDRESS_TYPES,
  BEACON_TYPES,
  createApi,
  DEFAULT_BEACON_ADDRESS_TYPE,
  DidMethodError,
  IdentifierError,
  VERIFICATION_RELATIONSHIPS,
} from '../src/index.js';
import type {
  AddressUtxo,
  AnnounceOptions,
  ApiConfig,
  BeaconAddressType,
  BeaconInfo,
  BeaconService,
  BeaconType,
  BIP340Cryptosuite,
  BIP340DataIntegrityProof,
  BitcoinApiConfig,
  BitcoinConnection,
  BitcoinCoreRpcClient,
  BitcoinRestClient,
  BlockstoreLike,
  BlockstoreProviderLike,
  BroadcastOptions,
  Btcr2DataIntegrityProof,
  Btcr2DidDocument,
  Bytes,
  CASAnnouncement,
  CasConfig,
  CasExecutor,
  CID,
  CompressedSecp256k1PublicKey,
  DataIntegrityProofObject,
  DataIntegrityProofOptions,
  Did,
  DidComponents,
  DidCreateOptions,
  DidParams,
  DidResolutionResult,
  DidService,
  DidString,
  DidUpdateOptions,
  DidUpdateResult,
  DidVerificationMethod,
  DocumentBytes,
  Entropy,
  EsploraBlock,
  ExternalCreateResult,
  FeeEstimator,
  FromPublicKey,
  GenerateKeyOptions,
  GenesisBeaconSpec,
  GenesisDocumentSpec,
  GenesisVerificationMethodSpec,
  HashBytes,
  HexString,
  HttpExecutor,
  HttpRequest,
  IdentifierCheck,
  IdentifierCheckName,
  IdentifierComponents,
  IdentifierReport,
  IdentifierValidateOptions,
  IdType,
  ImportKeyOptions,
  IpfsRpcAuth,
  IpfsRpcCasExecutorOptions,
  JSONObject,
  KeyBytes,
  KeyIdentifier,
  KeyManager,
  KmsSignOptions,
  Logger,
  MultibaseObject,
  Multikey,
  NetworkName,
  NetworkPreset,
  PatchOpCode,
  PatchOperation,
  Point,
  PublicKeyObject,
  PublishToCasMode,
  RawTransactionRest,
  ResolutionOptions,
  ResolutionResult,
  RestConfig,
  RootCapability,
  RpcConfig,
  SchnorrKeyPair,
  SchnorrKeyPairObject,
  SchnorrMultikey,
  Secp256k1SecretKey,
  SecretKeyObject,
  SecuredDocument,
  Sidecar,
  SignalDiscoveryMode,
  SignatureBytes,
  SignedBTCR2Update,
  Signer,
  SigningScheme,
  SignOptions,
  SmtEntry,
  SMTProof,
  SmtTree,
  SourceState,
  TransactionStatus,
  TxId,
  UnsecuredDocument,
  UnsignedBTCR2Update,
  UpdateOptions,
  UpdateSource,
  VerificationRelationship,
  VerificationResult,
  VerifyOptions,
  Vin,
  Vout,
} from '../src/index.js';

/**
 * Each type that a public signature uses must be nameable from the api
 * package alone. The compilation of this type is the assertion.
 */
type SurfaceTypes = [
  AddressUtxo, AnnounceOptions, ApiConfig, BeaconAddressType, BeaconInfo, BeaconService, BeaconType,
  BIP340Cryptosuite, BIP340DataIntegrityProof, BitcoinApiConfig, BitcoinConnection, BitcoinCoreRpcClient,
  BitcoinRestClient, BlockstoreLike, BlockstoreProviderLike, BroadcastOptions, Btcr2DataIntegrityProof,
  Btcr2DidDocument, Bytes, CASAnnouncement, CasConfig, CasExecutor, CID, CompressedSecp256k1PublicKey,
  DataIntegrityProofObject, DataIntegrityProofOptions, Did, DidComponents, DidCreateOptions, DidParams,
  DidResolutionResult, DidService, DidString, DidUpdateOptions, DidUpdateResult, DidVerificationMethod,
  DocumentBytes, Entropy, EsploraBlock, ExternalCreateResult, FeeEstimator, FromPublicKey,
  GenerateKeyOptions, GenesisBeaconSpec, GenesisDocumentSpec, GenesisVerificationMethodSpec, HashBytes,
  HexString, HttpExecutor, HttpRequest, IdentifierCheck, IdentifierCheckName, IdentifierComponents,
  IdentifierReport, IdentifierValidateOptions, IdType, ImportKeyOptions, IpfsRpcAuth,
  IpfsRpcCasExecutorOptions, JSONObject, KeyBytes, KeyIdentifier, KeyManager, KmsSignOptions, Logger,
  MultibaseObject, Multikey, NetworkName, NetworkPreset, PatchOpCode, PatchOperation, Point,
  PublicKeyObject, PublishToCasMode, RawTransactionRest, ResolutionOptions, ResolutionResult, RestConfig,
  RootCapability, RpcConfig, SchnorrKeyPair, SchnorrKeyPairObject, SchnorrMultikey, Secp256k1SecretKey,
  SecretKeyObject, SecuredDocument, Sidecar, SignalDiscoveryMode, SignatureBytes, SignedBTCR2Update,
  Signer, SigningScheme, SignOptions, SmtEntry, SMTProof, SmtTree, SourceState, TransactionStatus, TxId,
  UnsecuredDocument, UnsignedBTCR2Update, UpdateOptions, UpdateSource, VerificationRelationship,
  VerificationResult, VerifyOptions, Vin, Vout,
];

/** The runtime values of the api (ADR 132). A new value must be added here on purpose. */
const RUNTIME_SURFACE = [
  // The facade and the sub-facade classes
  'createApi', 'DidBtcr2Api', 'BitcoinApi', 'CasApi', 'CryptoApi', 'CryptosuiteApi',
  'DataIntegrityProofApi', 'DidApi', 'DidMethodApi', 'KeyManagerApi', 'KeyPairApi', 'MultikeyApi', 'SmtApi',
  // The configuration classes
  'BlockstoreCasExecutor', 'HttpGatewayCasExecutor', 'IpfsRpcCasExecutor',
  // The constants and presets
  'BEACON_ADDRESS_TYPES', 'BEACON_TYPES', 'DEFAULT_BEACON_ADDRESS_TYPE', 'DEFAULT_BITCOIN_NETWORK_CONFIG',
  'DEFAULT_CAS_GATEWAY', 'DEFAULT_CAS_TIMEOUT_MS', 'DEFAULT_MIN_CONF', 'NETWORK_PRESETS',
  'VERIFICATION_RELATIONSHIPS', 'explorerAddressUrl', 'explorerTxUrl', 'faucetUrl',
  // The error classes
  'DidDocumentError', 'DidMethodError', 'IdentifierError', 'MethodError', 'ResolveError', 'UpdateError',
];

/**
 * Index export surface test
 */
describe('index exports', () => {
  it('the runtime values are exactly the facade, the configuration classes, the constants, and the errors', () => {
    expect(Object.keys(surface).sort()).to.deep.equal([...RUNTIME_SURFACE].sort());
  });

  it('does not export the classes of the lower packages or the internal helpers as values', () => {
    for (const name of [
      'Appendix', 'BeaconFactory', 'BeaconUtils', 'BitcoinConnection', 'canonicalHash', 'DidBtcr2',
      'DidDocument', 'DidDocumentBuilder', 'GenesisDocument', 'Identifier', 'IdentifierTypes', 'JSONPatch',
      'KeyManagerSigner', 'LocalKeyManager', 'LocalSigner', 'Resolver', 'SchnorrKeyPair', 'Updater',
      'NOOP_LOGGER', 'assertBytes', 'assertCompressedPubkey', 'assertGenesisDocument', 'assertString',
      'buildGenesisDocument', 'resolutionErrorCode', 'rootCauseMessage',
    ]) {
      expect(surface, name).to.not.have.property(name);
    }
  });

  it('each type that a public signature uses is nameable from the api package', () => {
    const witness: SurfaceTypes | undefined = undefined;
    expect(witness).to.equal(undefined);
  });

  it('the two SignOptions shapes are distinct and both nameable', () => {
    const kmsOptions: KmsSignOptions = { scheme: 'bip340' };
    const signerOptions: SignOptions = { merkleRoot: null };
    // Compile-time direction guard: the plain SignOptions is the Signer-level
    // shape and must not carry `scheme`; KmsSignOptions must. Rewiring either
    // re-export to the other package's shape stops this compiling.
    const plainOmitsScheme: 'scheme' extends keyof SignOptions ? never : true = true;
    const kmsCarriesScheme: 'scheme' extends keyof KmsSignOptions ? true : never = true;
    expect(kmsOptions.scheme).to.equal('bip340');
    expect(signerOptions.merkleRoot).to.equal(null);
    expect(plainOmitsScheme && kmsCarriesScheme).to.equal(true);
  });

  it('a signer from the kms sub-facade satisfies Signer', () => {
    const api = createApi();
    const id = api.kms.generateKey();
    const signer: Signer = api.kms.signer(id);
    expect(signer.publicKey).to.be.instanceOf(Uint8Array);
  });

  it('an error that the facade throws is an instance of the exported error classes', () => {
    const api = createApi();
    let caught: unknown;
    try {
      api.did.decode('did:btcr2:not-an-identifier');
    } catch (err) {
      caught = err;
    }
    expect(caught).to.be.instanceOf(IdentifierError);
    expect(caught).to.be.instanceOf(DidMethodError);
  });

  it('exports the genesis constants as values', () => {
    expect(BEACON_TYPES).to.deep.equal(['SingletonBeacon', 'CASBeacon', 'SMTBeacon']);
    expect(BEACON_ADDRESS_TYPES).to.deep.equal(['p2pkh', 'p2wpkh', 'p2tr']);
    expect(VERIFICATION_RELATIONSHIPS).to.deep.equal([
      'authentication', 'assertionMethod', 'capabilityInvocation', 'capabilityDelegation',
    ]);
    expect(DEFAULT_BEACON_ADDRESS_TYPE).to.equal('p2wpkh');
  });
});

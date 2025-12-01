import {
  BitcoinCoreRpcClient,
  BitcoinRestClient,
  BlockV3,
  RawTransactionV2,
  RestClientConfigParams,
  RpcClientConfig
} from '@did-btcr2/bitcoin';
import type {
  Bytes,
  CryptosuiteName,
  DidUpdateInvocation,
  DidUpdatePayload,
  DocumentBytes,
  Entropy,
  HashBytes,
  Hex,
  JSONObject,
  KeyBytes,
  PatchOperation,
  Proof,
  ProofBytes,
  ProofOptions,
  SchnorrKeyPairObject,
  SignatureBytes
} from '@did-btcr2/common';
import { DEFAULT_BLOCK_CONFIRMATIONS, DEFAULT_REST_CONFIG, DEFAULT_RPC_CONFIG, IdentifierTypes } from '@did-btcr2/common';
import type { MultikeyObject } from '@did-btcr2/cryptosuite';
import { Cryptosuite as SchnorrCryptosuite, SchnorrMultikey } from '@did-btcr2/cryptosuite';
import { SchnorrKeyPair, Secp256k1SecretKey } from '@did-btcr2/keypair';
import { Kms, type KeyManager } from '@did-btcr2/kms';
import type { DidCreateOptions, DidResolutionOptions, SignalsMetadata, UpdateParams } from '@did-btcr2/method';
import { DidBtcr2, DidDocument, DidDocumentBuilder, Identifier } from '@did-btcr2/method';
import { KeyIdentifier } from '@web5/crypto';
import { Did, type DidResolutionResult, type DidService, type DidVerificationMethod } from '@web5/dids';

export { DidDocument, DidDocumentBuilder, Identifier, IdentifierTypes };
export type {
  BlockV3,
  Bytes,
  CryptosuiteName,
  DidResolutionResult,
  DidService,
  DidVerificationMethod,
  DocumentBytes,
  HashBytes,
  Hex,
  JSONObject,
  KeyBytes,
  MultikeyObject,
  PatchOperation,
  ProofBytes,
  RawTransactionV2,
  RestClientConfigParams,
  RpcClientConfig,
  SchnorrKeyPairObject,
  SignatureBytes
};

/**
 * Network names supported by the Bitcoin API.
 */
export type NetworkName = 'mainnet' | 'testnet4' | 'signet' | 'regtest';

/**
 * Bitcoin API configuration options.
 */
export type BitcoinApiConfig = {
  /** Shortcut to compute base URLs and params via @did-btcr2/bitcoin getNetwork */
  network?: NetworkName;
  /** Override REST client settings */
  rest?: RestClientConfigParams;
  /** Override RPC client settings */
  rpc?: RpcClientConfig;
  /** Default number of confirmations to consider "final" */
  defaultConfirmations?: number;
};

/**
 * API configuration options.
 */
export type ApiConfig = {
  bitcoin?: BitcoinApiConfig;
  kms?: KeyManager;
};

/**
 * KeyPair sub-facade for various Schnorr keypair operations.
 * @class KeyPairApi
 * @type {KeyPairApi}
 */
export class KeyPairApi {
  /** Generate a new Schnorr keypair (secp256k1). */
  generate(): SchnorrKeyPair {
    return new SchnorrKeyPair();
  }

  /** Import from secret key bytes or bigint. */
  fromSecret(ent: Entropy): SchnorrKeyPair {
    const sk = new Secp256k1SecretKey(ent);
    return new SchnorrKeyPair({ secretKey: sk });
  }
}

/**
 * Cryptosuite API sub-facade for various cryptosuite operations.
 * @class CryptosuiteApi
 * @type {CryptosuiteApi}
 */
export class CryptosuiteApi {
  create(type: CryptosuiteName, multikey: SchnorrMultikey): SchnorrCryptosuite {
    return new SchnorrCryptosuite({ cryptosuite: type, multikey });
  }

  toDataIntegrityProof(cs: SchnorrCryptosuite): JSONObject {
    return cs.toDataIntegrityProof();
  }

  async createProof(
    cs: SchnorrCryptosuite,
    document: DidUpdatePayload,
    options: ProofOptions
  ): Promise<Proof> {
    return await cs.createProof({ document, options });
  }

  async verifyProof(cs: SchnorrCryptosuite, document: DidUpdateInvocation): Promise<boolean> {
    const result = await cs.verifyProof(document);
    return result.verified;
  }
}

/**
 * Multikey API sub-facade for various Schnorr multikey operations.
 * @class MultikeyApi
 * @type {MultikeyApi}
 */
export class MultikeyApi {
  /**
   * Create a new Schnorr multikey.
   * @param {string} id The multikey ID.
   * @param {string} controller The multikey controller.
   * @param {SchnorrKeyPair} keys The Schnorr keypair to use.
   * @returns {SchnorrMultikey} The created Schnorr multikey.
   */
  create(id: string, controller: string, keys: SchnorrKeyPair): SchnorrMultikey {
    return new SchnorrMultikey({ id, controller, keys });
  }

  /** Produce a DID Verification Method JSON from a multikey. */
  toVerificationMethod(mk: SchnorrMultikey): DidVerificationMethod {
    return mk.toVerificationMethod();
  }

  /** Sign bytes via the multikey (requires secret). */
  async sign(mk: SchnorrMultikey, data: Bytes): Promise<SignatureBytes> {
    return mk.sign(data);
  }

  /** Verify signature via multikey. */
  async verify(mk: SchnorrMultikey, data: Bytes, signature: SignatureBytes): Promise<boolean> {
    return mk.verify(data, signature);
  }
}

/**
 * Crypto API sub-facade for various cryptographic utilities.
 * @class CryptoApi
 * @type {CryptoApi}
 */
export class CryptoApi {
  /** Schnorr keypair operations. */
  public keypair = new KeyPairApi();

  /** Schnorr Multikey operations. */
  public multikey = new MultikeyApi();

  /** Schnorr Cryptosuite operations. */
  public cryptosuite = new CryptosuiteApi();
}

/**
 * Bitcoin API sub-facade for various Bitcoin network operations.
 * @class BitcoinApi
 * @type {BitcoinApi}
 */
export class BitcoinApi {
  readonly rest: BitcoinRestClient;
  readonly rpc: BitcoinCoreRpcClient;
  readonly defaultConfirmations: number;

  constructor(cfg?: BitcoinApiConfig) {
    const host = cfg?.rest?.host ?? DEFAULT_REST_CONFIG.host;
    const restCfg = { host, ...cfg?.rest };

    const rpcCfg = {
      ...DEFAULT_RPC_CONFIG,
      ...cfg?.rpc
    };

    this.rest = new BitcoinRestClient(restCfg);
    this.rpc = new BitcoinCoreRpcClient(rpcCfg);
    this.defaultConfirmations = cfg?.defaultConfirmations ?? DEFAULT_BLOCK_CONFIRMATIONS;
  }

  /** Fetch a transaction by txid via REST. */
  async getTransaction(txid: string) {
    return await this.rest.transaction.get(txid);
  }

  /** Broadcast a raw tx (hex) via REST. */
  async send(rawTxHex: string) {
    return await this.rest.transaction.send(rawTxHex);
  }

  /** Get UTXOs for an address via REST. */
  async getUtxos(address: string) {
    return await this.rest.address.getUtxos(address);
  }

  /** Get a block by hash or height via REST. */
  async getBlock(params: { hash?: string; height?: number }) {
    return await this.rest.block.get({ blockhash: params.hash, height: params.height });
  }
}

/**
 * KeyManager API sub-facade for various key management operations.
 * @class KeyManagerApi
 * @type {KeyManagerApi}
 */
export class KeyManagerApi {
  /** The underlying KeyManager instance. */
  readonly kms: KeyManager;

  /** Create a new KeyManagerApi instance initialized with a Kms class. */
  constructor(kms?: KeyManager) {
    this.kms = kms ?? new Kms();
  }

  /** Set the active key by its identifier. */
  setActive(id: string): void {
    this.kms.setActiveKey(id);
  }

  /** Get the active key identifier. */
  getPublicKey(id: string): Bytes {
    return this.kms.getPublicKey(id);
  }

  /** Import a Schnorr keypair into the KMS. */
  import(kp: SchnorrKeyPair, options: { id?: KeyIdentifier; setActive?: boolean }) {
    return this.kms.importKey(kp, options);
  }

  /** Sign a hash via the KMS. */
  sign(id: string, hash: HashBytes): SignatureBytes {
    return this.kms.sign(hash, id);
  }
}

/**
 * DID API sub-facade for interacting with BTCR2 identifiers.
 * @class DidApi
 * @type {DidApi}
 */
export class DidApi {
  /** Encode a DID from genesis bytes and options. */
  encode(genesisBytes: DocumentBytes, options: DidCreateOptions & { idType: string }): Identifier {
    return Identifier.encode({
      genesisBytes,
      idType  : options.idType,
      version : options.version ?? 1,
      network : options.network ?? 'bitcoin'
    });
  }

  /** Decode a DID into its components. */
  decode(did: string): {
    genesisBytes: DocumentBytes;
    idType: string;
    version: number;
    network: string;
  } {
    return Identifier.decode(did);
  }

  /** Generate a new DID and associated keys. */
  generate(): { keys: SchnorrKeyPair; identifier: { controller: string; id: string } } {
    return Identifier.generate();
  }

  /** Check if a DID is valid. */
  isValid(did: string): boolean {
    return Identifier.isValid(did);
  }

  /** Parse a DID string into a Did object or null if invalid. */
  parse(did: string): Did | null {
    return Did.parse(did);
  }
}

/**
 * DID Method API sub-facade for interacting with BTCR2 Method operations:
 * create, resolve, update, and deactivate.
 * @class DidMethodApi
 * @type {DidMethodApi}
 */

export class DidMethodApi {
  /**
   * Create a deterministic DID from a public key (bytes).
   * @param {KeyBytes} genesisBytes The public key bytes.
   * @param {DidCreateOptions} options The creation options.
   * @returns {Promise<Identifier>} The created DID identifier.
   */
  async createDeterministic(genesisBytes: KeyBytes, options: DidCreateOptions): Promise<Identifier> {
    return await DidBtcr2.create({ idType: 'KEY', genesisBytes, options });
  }

  /**
   * Create a non-deterministic DID from external genesis document bytes.
   * @param {DocumentBytes} genesisBytes The genesis document bytes.
   * @param {DidCreateOptions} options The creation options.
   * @returns {Promise<Identifier>} The created DID identifier.
   */
  async createExternal(genesisBytes: DocumentBytes, options: DidCreateOptions): Promise<Identifier> {
    return await DidBtcr2.create({ idType: 'EXTERNAL', genesisBytes, options });
  }

  /**
   * Resolve a DID.
   * @param {string} identifier The DID to resolve.
   * @param {DidResolutionOptions} options The resolution options.
   * @returns {DidResolutionResult} The resolution result.
   */
  async resolve(identifier: string, options: DidResolutionOptions): Promise<DidResolutionResult> {
    return await DidBtcr2.resolve(identifier, options);
  }

  /**
   * Update an existing DID document.
   * @param {UpdateParams} params The update parameters.
   * @param {string} params.identifier The DID identifier to update.
   * @param {DidDocument} params.sourceDocument The current DID document (can be used to avoid a resolve).
   * @param {number} params.sourceVersionId The current version ID (can be used to avoid a resolve).
   * @param {PatchOperation[]} params.patch The JSON Patch operations to apply.
   * @param {string} params.verificationMethodId The verification method ID to use for signing the update.
   * @param {string[]} params.beaconIds Optional beacon IDs to anchor the update to.
   * @returns {SignalsMetadata} The resulting signals metadata from the update operation.
   */
  async update({
    identifier,
    sourceDocument,
    sourceVersionId,
    patch,
    verificationMethodId,
    beaconIds
  }: UpdateParams): Promise<SignalsMetadata> {
    return await DidBtcr2.update({
      identifier,
      sourceDocument,
      sourceVersionId,
      patch,
      verificationMethodId,
      beaconIds,
    });
  }

  /**
   * Deactivate an existing DID and DID document.
   * @param {UpdateParams} params The update parameters.
   * @param {string} params.identifier The DID identifier to update.
   * @param {DidDocument} params.sourceDocument The current DID document (can be used to avoid a resolve).
   * @param {number} params.sourceVersionId The current version ID (can be used to avoid a resolve).
   * @param {PatchOperation[]} params.patch The JSON Patch operations to apply.
   * @param {string} params.verificationMethodId The verification method ID to use for signing the update.
   * @param {string[]} params.beaconIds Optional beacon IDs to anchor the update to.
   * @returns {SignalsMetadata} The resulting signals metadata from the update operation.
   */
  async deactivate({
    identifier,
    sourceDocument,
    sourceVersionId,
    patch,
    verificationMethodId,
    beaconIds
  }: UpdateParams): Promise<SignalsMetadata> {
    patch ??= [{
      op    : 'add',
      path  : '/deactivated',
      value : true
    }] as PatchOperation[];

    const result = await DidBtcr2.update({
      identifier,
      sourceDocument,
      sourceVersionId,
      patch,
      verificationMethodId,
      beaconIds,
    });
    return result;
  }
}

/**
 * Main DidBtcr2Api facade class that exposes sub-facades for Bitcoin, DID
 * Method, KeyPair, Crypto, and KeyManager operations.
 * @class DidBtcr2Api
 * @type {DidBtcr2Api}
 */
export class DidBtcr2Api {
  readonly btc: BitcoinApi;
  readonly did: DidApi;
  readonly btcr2: DidMethodApi;
  readonly crypto: CryptoApi;
  readonly kms: KeyManagerApi;

  constructor(config?: ApiConfig) {
    this.btc = new BitcoinApi(config?.bitcoin);
    this.did = new DidApi();
    this.btcr2 = new DidMethodApi();
    this.crypto = new CryptoApi();
    this.kms = new KeyManagerApi(config?.kms);
  }
}

/**
 * Factory function to create a DidBtcr2Api instance.
 * @param {ApiConfig} config Optional API configuration.
 * @returns {DidBtcr2Api} The created DidBtcr2Api instance.
 */
export function createApi(config?: ApiConfig): DidBtcr2Api {
  return new DidBtcr2Api(config);
}

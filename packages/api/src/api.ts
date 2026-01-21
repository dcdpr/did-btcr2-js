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
  DocumentBytes,
  Entropy,
  HashBytes,
  Hex,
  JSONObject,
  KeyBytes,
  PatchOperation,
  ProofBytes,
  SchnorrKeyPairObject,
  SignatureBytes
} from '@did-btcr2/common';
import { DEFAULT_BLOCK_CONFIRMATIONS, DEFAULT_REST_CONFIG, DEFAULT_RPC_CONFIG, IdentifierTypes, NotImplementedError } from '@did-btcr2/common';
import type { MultikeyObject } from '@did-btcr2/cryptosuite';
import { SchnorrMultikey } from '@did-btcr2/cryptosuite';
import { SchnorrKeyPair, Secp256k1SecretKey } from '@did-btcr2/keypair';
import type { DidCreateOptions, ResolutionOptions, SidecarData, UpdateParams } from '@did-btcr2/method';
import { DidBtcr2, DidDocument, DidDocumentBuilder, Identifier } from '@did-btcr2/method';
import type { DidResolutionResult, DidService, DidVerificationMethod } from '@web5/dids';

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

/* =========================
 * Configuration Interfaces
 * ========================= */

export type NetworkName = 'mainnet' | 'testnet4' | 'signet' | 'regtest';

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

export type ApiConfig = {
  bitcoin?: BitcoinApiConfig;
};

/* =========================
 * Sub-facade: KeyPair
 * ========================= */

export class KeyPairApi {
  /** Generate a new Schnorr keypair (secp256k1). */
  static generate(): SchnorrKeyPair {
    return new SchnorrKeyPair();
  }

  /** Import from secret key bytes or bigint. */
  static fromSecret(ent: Entropy): SchnorrKeyPair {
    const sk = new Secp256k1SecretKey(ent);
    return new SchnorrKeyPair({ secretKey: sk });
  }
}

export class MultikeyApi {
  /**
   * Create a Schnorr Multikey wrapper (includes verificationMethod, sign/verify).
   * If secret is present, the multikey can sign.
   */
  static create(params: {
    id: string;
    controller: string;
    keys: SchnorrKeyPair
  }): SchnorrMultikey {
    return new SchnorrMultikey(params);
  }

  /** Produce a DID Verification Method JSON from a multikey. */
  static toVerificationMethod(mk: SchnorrMultikey): DidVerificationMethod {
    return mk.toVerificationMethod();
  }

  /** Sign bytes via the multikey (requires secret). */
  static async sign(mk: SchnorrMultikey, data: Bytes): Promise<SignatureBytes> {
    return mk.sign(data);
  }

  /** Verify signature via multikey. */
  static async verify(mk: SchnorrMultikey, data: Bytes, signature: SignatureBytes): Promise<boolean> {
    return mk.verify(data, signature);
  }
}

/* =========================
 * Sub-facade: Crypto
 * ========================= */

export class CryptoApi {
  public static keyPairApi = new KeyPairApi();
  public static multikeyApi = new MultikeyApi();
}

/* =========================
 * Sub-facade: Bitcoin
 * ========================= */

export class BitcoinApi {
  readonly rest: BitcoinRestClient;
  readonly rpc: BitcoinCoreRpcClient;
  readonly defaultConfirmations: number;

  constructor(cfg?: BitcoinApiConfig) {
    const restCfg = {
      host : cfg?.rest?.host ?? DEFAULT_REST_CONFIG.host,
      ...cfg?.rest
    };

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

/* =========================
 * Sub-facade: KeyManager
 * ========================= */

// export class KeyManagerApi {
//   readonly impl: IMethodKeyManager;

//   constructor(params?: ApiKeyManagerConfig) {
//     this.impl = new MethodKeyManager(params);
//   }

//   setActive(keyUri: string) {
//     this.impl.activeKeyUri = keyUri;
//   }

//   export(keyUri: string) {
//     return this.impl.export(keyUri);
//   }

//   import(mk: SchnorrMultikey, opts?: { importKey?: boolean; active?: boolean }) {
//     return this.impl.import(mk, opts);
//   }

//   sign(keyUri: string, hash: HashBytes): Promise<SignatureBytes> {
//     return this.impl.sign(keyUri, hash);
//   }
// }

/* =========================
 * Sub-facade: DID / CRUD
 * ========================= */

export class DidApi {
  /**
   * Create a deterministic DID from a public key (bytes).
   */
  async createDeterministic({ genesisBytes, options }: {
    genesisBytes: KeyBytes;
    options: DidCreateOptions;
  }) {
    return await DidBtcr2.create(genesisBytes, options);
  }

  /**
   * Create from an intermediate DID document (external genesis).
   */
  async createExternal({ genesisBytes, options }: {
    genesisBytes: DocumentBytes;
    options: DidCreateOptions;
  }) {
    return await DidBtcr2.create(genesisBytes, options);
  }

  /**
   * Resolve DID document from DID (did:btcr2:...).
   */
  async resolve(did: string, options: ResolutionOptions): Promise<DidResolutionResult> {
    return await DidBtcr2.resolve(did, options);
  }

  /**
   * Update a DID Document using a JSON Patch, signed as capabilityInvocation.
   * You provide the prior DID Document (to pick VM), a JSON Patch, and a signer multikey.
   * This delegates to MethodUpdate (which follows the cryptosuite rules internally).
   */
  async update({
    identifier,
    sourceDocument,
    sourceVersionId,
    patch,
    verificationMethodId,
    beaconIds
  }: UpdateParams): Promise<SidecarData> {
    // The Update class exposes the algorithm that creates a DID Update Payload and proof;
    // keep this wrapper narrow so testing can mock MethodUpdate directly.
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

  /** Deactivate convenience: applies the standard `deactivated: true` patch. */
  async deactivate(): Promise<SidecarData> {
    // This class is a stub in method right now; expose a narrow wrapper for future expansion.
    // return DidBtcr2.deactivate({ identifier, patch }); // No-op holder; implement when core adds behavior.
    throw new NotImplementedError(
      'DidApi.deactivate is not implemented yet.',
      {
        type : 'DID_API_METHOD_NOT_IMPLEMENTED',
        name : 'NOT_IMPLEMENTED_ERROR'
      }
    );
  }
}

/* =========================
 * Root facade
 * ========================= */

export class DidBtcr2Api {
  readonly bitcoin: BitcoinApi;
  readonly did: DidApi;
  readonly keys: KeyPairApi;
  readonly crypto: CryptoApi;
  // readonly keyManager: KeyManagerApi;

  constructor(config?: ApiConfig) {
    this.bitcoin = new BitcoinApi(config?.bitcoin);
    this.did = new DidApi();
    this.keys = new KeyPairApi();
    this.crypto = new CryptoApi();
    // this.keyManager = new KeyManagerApi(config?.keyManager);
  }
}

/* =========================
 * Factory
 * ========================= */

export function createApi(config?: ApiConfig) {
  return new DidBtcr2Api(config);
}

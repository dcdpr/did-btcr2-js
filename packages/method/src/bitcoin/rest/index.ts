import { Btc1Error, Bytes, UnixTimestamp } from '@did-btc1/common';
import { DEFAULT_REST_CLIENT_CONFIG } from '../constants.js';
import { BitcoinRpcError } from '../errors.js';
import {
  BlockResponse,
  BlockV3,
  GetBlockParams,
  TxInPrevout,
} from '../rpc/types.js';

export type TransactionStatus = {
  confirmed: boolean;
  block_height: number;
  block_hash: string;
  block_time: UnixTimestamp;
};

export interface Vin {
  txid: string;
  vout: number;
  prevout?: TxInPrevout;
  scriptsig: string;
  scriptsig_asm: string;
  witness: string[];
  is_coinbase: boolean;
  sequence: number;
};

export interface Vout {
  scriptpubkey: string;
  scriptpubkey_asm: string;
  scriptpubkey_type: string;
  scriptpubkey_address?: string;
  value: number;
}
export interface ChainStats {
  funded_txo_count: number;
  funded_txo_sum: number;
  spent_txo_count: number;
  spent_txo_sum: number;
  tx_count: number;
}

export interface MempoolStats {
  funded_txo_count: number;
  funded_txo_sum: number;
  spent_txo_count: number;
  spent_txo_sum: number;
  tx_count: number;
}
export interface AddressInfo {
  address: string;
  chain_stats: ChainStats;
  mempool_stats: MempoolStats;
}
export interface RawTransactionRest {
  txid: string;
  version: number;
  locktime: number;
  vin: Array<Vin>;
  vout: Array<Vout>;
  size: number;
  weight: number;
  fee: number;
  status: TransactionStatus;
}

export interface AddressUtxo {
  txid: string;
  vout: number;
  status: TransactionStatus;
  value: number;
}
export interface RestClientConfigParams {
  host: string;
  headers?: { [key: string]: string };
}

export class RestClientConfig {
  host: string;
  headers?: { [key: string]: string };
  constructor({ host, headers }: RestClientConfigParams) {
    this.host = host;
    this.headers = headers;
  }
}

export interface RestApiCallParams {
  path: string;
  url?: string;
  method?: string;
  body?: any;
  headers?: any;
};

export interface RestResponse extends Response {
  [key: string]: any;
}

/**
 * Implements a strongly-typed BitcoinRest to connect to remote bitcoin node via REST API.
 * @class BitcoinRest
 * @type {BitcoinRest}
 */
export default class BitcoinRest {
  /**
   * The encapsulated {@link RestClientConfig} object.
   * @private
   * @type {RestClientConfig}
   */
  private _config: RestClientConfig;

  /**
   * The api calls related to bitcoin transactions.
   * @type {BitcoinTransaction}
   */
  public transaction: BitcoinTransaction;

  /**
   * The api calls related to bitcoin blocks.
   * @type {BitcoinBlock}
   */
  public block: BitcoinBlock;

  /**
   * The api calls related to bitcoin addresses.
   * @type {BitcoinAddress}
   */
  public address: BitcoinAddress;

  /**
   * The API call method that can be used to make requests to the REST API.
   * @returns {Promise<any>} A promise resolving to the response data.
   */
  public api: (params: RestApiCallParams) => Promise<any> = this.call;

  constructor(config: RestClientConfig){
    this._config = new RestClientConfig(config);
    this.api = this.call.bind(this);
    this.transaction = new BitcoinTransaction(this.api);
    this.block = new BitcoinBlock(this.api);
    this.address = new BitcoinAddress(this.api);
  }

  /**
   * Get the configuration object.
   * @private
   */
  get config(): RestClientConfig {
    const config = this._config;
    return config;
  }

  /**
   * Static method connects to a bitcoin node running a esplora REST API.
   *
   * @param {RestClientConfig} config The configuration object for the client (optional).
   * @returns A new {@link BitcoinRest} instance.
   * @example
   * ```
   * const rest = BitcoinRest.connect();
   * ```
   */
  public static connect(config?: RestClientConfig): BitcoinRest {
    return new BitcoinRest(config ?? DEFAULT_REST_CLIENT_CONFIG);
  }

  /**
   * Make a REST API call to the configured Bitcoin node.
   * @private
   * @param {RestApiCallParams} params The parameters for the API call. See {@link RestApiCallParams} for details.
   * @param {string} [params.path] The path to the API endpoint (required).
   * @param {string} [params.url] The full URL to the API endpoint (optional).
   * @param {string} [params.method] The HTTP method to use (default is 'GET').
   * @param {any} [params.body] The body of the request (optional).
   * @param {any} [params.headers] Additional headers to include in the request (optional).
   * @returns {Promise<any>} A promise resolving to the response data.
   */
  private async call({ path, url, method, body, headers }: RestApiCallParams): Promise<any> {
    // Construct the URL if not provided
    url ??= `${this.config.host.replaceEnd('/')}${path}`;

    // Set the method to GET if not provided
    method ??= 'GET';

    // Construct the request options
    const requestInit = {
      method,
      headers : headers ?? {
        'Content-Type' : 'application/json',
        ...this.config.headers,
      }
    } as any;

    // If the method is POST or PUT, add the body to the request
    if(body) {
      requestInit.body = JSON.is(body) ? JSON.stringify(body) : body;
      requestInit.method = 'POST';
    }

    // Make the request
    const response = await fetch(url, requestInit) as RestResponse;

    // Check if the response is a text/plain response
    const data = (response.headers.get('Content-Type') ?? 'json') === 'text/plain'
      ? await response.text()
      : await response.json();

    // Check if the response is ok (status in the range 200-299)
    if (!response.ok) {
      throw new Btc1Error(
        `Request to ${url} failed: ${response.status} - ${response.statusText}`,
        'FAILED_HTTP_REQUEST',
        { data, response }
      );
    }

    return data;
  }
}

export class BitcoinTransaction {
  private api: (params: RestApiCallParams) => Promise<any>;

  constructor(api: (params: RestApiCallParams) => Promise<any>) {
    this.api = api;
  }

  /**
   * Returns the transaction in JSON format.
   * See {@link https://github.com/blockstream/esplora/blob/master/API.md#get-txtxid | Esplora GET /tx/:txid } for details.
   * @param {string} txid The transaction id (required).
   * @returns {GetRawTransaction} A promise resolving to data about a transaction in the form specified by verbosity.
   */
  public async get(txid: string): Promise<RawTransactionRest> {
    return await this.api({ path: `/tx/${txid}` });
  }

  /**
   * Returns the transaction in JSON format.
   * See {@link https://github.com/blockstream/esplora/blob/master/API.md#get-txtxid | Esplora GET /tx/:txid } for details.
   * @param {string} txid The transaction id (required).
   * @returns {GetRawTransaction} A promise resolving to data about a transaction in the form specified by verbosity.
   */
  public async isConfirmed(txid: string): Promise<boolean> {
    const tx = await this.get(txid);
    return tx.status.confirmed;
  }

  /**
   * Returns the raw transaction in hex or as binary data.
   * See {@link https://github.com/blockstream/esplora/blob/master/API.md#get-txtxidhex | Esplora GET /tx/:txid/hex } and
   * {@link https://github.com/blockstream/esplora/blob/master/API.md#get-txtxidraw | Esplora GET /tx/:txid/raw } for details.
   * @param {string} txid The transaction id (required).
   * @returns {Promise<RawTransactionRest | string>} A promise resolving to the raw transaction in the specified format.
   */
  public async getHex(txid: string): Promise<string> {
    return await this.api({ path: `/tx/${txid}/hex` });
  }

  /**
   * Returns the raw transaction in hex or as binary data.
   * See {@link https://github.com/blockstream/esplora/blob/master/API.md#get-txtxidhex | Esplora GET /tx/:txid/hex } and
   * {@link https://github.com/blockstream/esplora/blob/master/API.md#get-txtxidraw | Esplora GET /tx/:txid/raw } for details.
   * @param {string} txid The transaction id (required).
   * @returns {Promise<RawTransactionRest | string>} A promise resolving to the raw transaction in the specified format.
   */
  public async getRaw(txid: string): Promise<Bytes> {
    return await this.api({ path: `/tx/${txid}/raw` });
  }

  /**
   * Broadcast a raw transaction to the network. The transaction should be provided as hex in the request body. The txid
   * will be returned on success.
   * See {@link https://github.com/blockstream/esplora/blob/master/API.md#post-tx | Esplora POST /tx } for details.
   * @param {string} tx The raw transaction in hex format (required).
   * @returns {Promise<string>} The transaction id of the broadcasted transaction.
   */
  public async send(tx: string): Promise<string> {
    return await this.api({ path: '/tx', method: 'POST', body: tx, headers: { 'Content-Type': 'text/plain' } });
  }
}

/**
 * Implements a strongly-typed BitcoinRest to connect to remote bitcoin node via REST API for block-related operations.
 * @class BitcoinBlock
 * @type {BitcoinBlock}
 */
export class BitcoinBlock {
  private api: (params: RestApiCallParams) => Promise<any>;

  constructor(api: (params: RestApiCallParams) => Promise<any>) {
    this.api = api;
  }

  /**
   * Returns the blockheight of the most-work fully-validated chain. The genesis block has height 0.
   * @returns {Blockheight} The number of the blockheight with the most-work of the fully-validated chain.
   */
  public async count(): Promise<number> {
    return await this.api({ path: '/blocks/tip/height' });
  }

  /**
   * Returns the block data associated with a `blockhash` of a valid block.
   * @param {GetBlockParams} params See {@link GetBlockParams} for details.
   * @param {?string} params.blockhash The blockhash of the block to query.
   * @param {?number} params.height The block height of the block to query.
   * @returns {BlockResponse} A promise resolving to a {@link BlockResponse} formatted depending on `verbosity` level.
   * @throws {BitcoinRpcError} If neither `blockhash` nor `height` is provided.
   */
  public async get({ blockhash, height }: GetBlockParams): Promise<BlockResponse | undefined> {
    // Check if blockhash or height is provided, if neither throw an error
    if(!blockhash && height === undefined) {
      throw new BitcoinRpcError('blockhash or height required', 'INVALID_PARAMS_GET_BLOCK', { blockhash, height });
    }

    // If height is provided, get the blockhash
    blockhash ??= await this.getHash(height!);
    if(!blockhash || typeof blockhash !== 'string') {
      return undefined;
    }

    // Get the block data
    return await this.api({ path: `/block/${blockhash}` }) as BlockV3;
  }

  /**
   * Get the block hash for a given block height.
   * See {@link https://github.com/blockstream/esplora/blob/master/API.md#get-block-heightheight | Esplora GET /block-height/:height } for details.
   * @param {number} height The block height (required).
   * @returns {Promise<string>} The hash of the block currently at height..
   */
  public async getHash(height: number): Promise<string> {
    return await this.api({ path: `/block-height/${height}` });
  }
}

export class BitcoinAddress {
  private api: (params: RestApiCallParams) => Promise<any>;

  constructor(api: (params: RestApiCallParams) => Promise<any>) {
    this.api = api;
  }

  /**
   * Get transaction history for the specified address/scripthash, sorted with newest first.
   * Returns up to 50 mempool transactions plus the first 25 confirmed transactions.
   * See {@link https://github.com/blockstream/esplora/blob/master/API.md#get-addressaddresstxs | Esplora GET /address/:address/txs } for details.
   * @param {string} addressOrScripthash The address or scripthash to check.
   * @returns {Promise<Array<RawTransactionRest>>} A promise resolving to an array of {@link RawTransactionRest} objects.
   */
  public async getTxs(addressOrScripthash: string): Promise<Array<RawTransactionRest>> {
    return await this.api({ path: `/address/${addressOrScripthash}/txs` });
  }

  /**
   * Calls getAddressTxs and checks if any funds come back.
   * Toggle if those funds are confirmed.
   * @param {string} addressOrScripthash The address or scripthash to check.
   * @returns {Promise<boolean>} True if the address has any funds, false otherwise.
   */
  public async isFundedAddress(addressOrScripthash: string): Promise<boolean> {
    const txs = await this.getConfirmedTxs(addressOrScripthash);
    const confirmed = txs.filter((tx: RawTransactionRest) => tx.status.confirmed);
    return !!(confirmed && confirmed.length);
  }

  /**
   * Get unconfirmed transaction history for the specified address/scripthash.
   * Returns up to 50 transactions (no paging).
   * @param {string} addressOrScripthash The address or scripthash to check.
   * @returns {Promise<Array<RawTransactionRest>>} A promise resolving to an array of {@link RawTransactionRest} objects.
   */
  public async getTxsMempool(addressOrScripthash: string): Promise<Array<RawTransactionRest>> {
    return await this.api({ path: `/address/${addressOrScripthash}/txs/mempool` });
  }

  /**
   * Get information about an address/scripthash.
   * Available fields: address/scripthash, chain_stats and mempool_stats.
   * {chain,mempool}_stats each contain an object with tx_count, funded_txo_count, funded_txo_sum, spent_txo_count and spent_txo_sum.
   * Elements-based chains don't have the {funded,spent}_txo_sum fields.
   * @param {string} addressOrScripthash The address or scripthash to check.
   * @returns {Promise<AddressInfo>} A promise resolving to an {@link AddressInfo} object.
   */
  public async getInfo(addressOrScripthash: string): Promise<AddressInfo> {
    return await this.api({ path: `/address/${addressOrScripthash}` });
  }

  /**
   * Get confirmed transaction history for the specified address/scripthash, sorted with newest first.
   * Returns 25 transactions per page. More can be requested by specifying the last txid seen by the previous query.
   * @param {string} addressOrScripthash The address or scripthash to check.
   * @param lastSeenTxId The last transaction id seen by the previous query (optional).
   * @returns {Promise<Array<RawTransactionRest>>} A promise resolving to an array of {@link RawTransactionRest} objects.
   */
  public async getConfirmedTxs(addressOrScripthash: string, lastSeenTxId?: string): Promise<Array<RawTransactionRest>> {
    return await this.api({
      path : lastSeenTxId
        ? `/address/${addressOrScripthash}/txs/chain/${lastSeenTxId}`
        : `/address/${addressOrScripthash}/txs/chain`
    });
  }

  /**
   * Get the list of unspent transaction outputs associated with the address/scripthash.
   * See {@link https://github.com/Blockstream/esplora/blob/master/API.md#get-addressaddressutxo | Esplora GET /address/:address/utxo } for details.
   * @param {string} addressOrScripthash The address or scripthash to check.
   * @returns {Promise<Array<RawTransactionRest>>} A promise resolving to an array of {@link RawTransactionRest} objects.
   */
  public async getUtxos(addressOrScripthash: string): Promise<Array<AddressUtxo>> {
    return await this.api({ path: `/address/${addressOrScripthash}/utxo` });
  }
}
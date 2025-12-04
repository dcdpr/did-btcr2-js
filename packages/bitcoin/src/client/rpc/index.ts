import { DEFAULT_BITCOIN_NETWORK_CONFIG } from '../../constants.js';
import { BitcoinRpcError } from '../../errors.js';
import {
  BatchOption,
  BitcoinRpcClientConfig,
  BlockResponse,
  BlockV0,
  BlockV1,
  BlockV2,
  BlockV3,
  ChainInfo,
  CreateRawTxInputs,
  CreateRawTxOutputs,
  DerivedAddresses,
  GetBlockParams,
  ListTransactionsParams,
  ListTransactionsResult,
  MethodNameInLowerCase,
  RawTransactionResponse,
  RawTransactionV0,
  RawTransactionV1,
  RawTransactionV2,
  RpcClientConfig,
  SignedRawTx,
  UnspentTxInfo,
  VerbosityLevel,
  WalletTransaction
} from '../../types.js';
import { BitcoinRpcClient } from './interface.js';
import { JsonRpcTransport } from './json-rpc.js';

/**
 * Class representing a Bitcoin Core RPC client.
 * @class BitcoinCoreRpcClient
 * @type {BitcoinCoreRpcClient}
 * @implements {BitcoinRpcClient}
 */
export class BitcoinCoreRpcClient implements BitcoinRpcClient {
  /**
   * The singleton instance of the BitcoinCoreRpcClient.
   * @type {BitcoinCoreRpcClient}
   * @private
   */
  static #instance: BitcoinCoreRpcClient;

  /**
   * The JSON-RPC transport layer.
   * @type {JsonRpcTransport}
   * @private
   */
  readonly #transport: JsonRpcTransport;

  /**
   * The configuration for the RPC client.
   * @type {RpcClientConfig}
   * @private
   */
  readonly #config: RpcClientConfig;

  /**
   * Constructs a new {@link BitcoinCoreRpcClient} instance from a new {@link RpcClient | RpcClient}.
   * @param {RpcClientConfig} config The bitcoin-core client instance.
   * @example
   * ```
   *  import BitcoinRpcClient from '@did-btcr2/method';
   *  const bob = BitcoinRpcClient.connect(); // To use default polar config, pass no args. Polar must run locally.
   * ```
   */
  constructor(config: RpcClientConfig) {
    this.#config = new BitcoinRpcClientConfig(config);
    this.#transport = new JsonRpcTransport(this.#config);
  }

  /**
   * Get the config for the current BitcoinRpcClient object.
   * @returns {BitcoinRpcClient} The encapsulated {@link BitcoinRpcClient} object.
   * @example
   * ```
   *  import BitcoinRpcClient from '@did-btcr2/method';
   *  const alice = BitcoinRpcClient.connect();
   *  const config = alice.config;
   * ```
   */
  get config(): BitcoinRpcClientConfig {
    const config = this.#config;
    return config;
  }

  /**
   * Get the client for the current BitcoinRpcClient object.
   * @returns {RpcClient} The encapsulated {@link RpcClient} object.
   * @example
   * ```
   * const alice = BitcoinRpcClient.connect();
   * const config = alice.client;
   * ```
   */
  get client(): JsonRpcTransport {
    const client = this.#transport;
    return client;
  }

  /**
   * Static method initializes a static instance of BitcoinCoreRpcClient with the given configuration.
   * The RpcClient returned by this method does not have any named methods.
   * Use this method to create and pass a new RpcClient instance to a BitcoinCoreRpcClient constructor.
   *
   * @param {RpcClientConfig} config The configuration object for the client (optional).
   * @returns {BitcoinCoreRpcClient} A new RpcClient instance.
   * @example
   * ```
   * const options: RpcClientConfig = {
   *     host: 'http://localhost:18443',
   *     username: 'alice',
   *     password: 'alicepass',
   *     version: '28.1.0',
   * }
   * const alice = BitcoinCoreRpcClient.initialize(options); // Client config required
   * ```
   */
  public static initialize(config?: RpcClientConfig): BitcoinCoreRpcClient {
    const cfg = new BitcoinRpcClientConfig(config);
    BitcoinCoreRpcClient.#instance = new BitcoinCoreRpcClient(cfg);
    return BitcoinCoreRpcClient.#instance;
  }

  /**
   * Static method connects to a bitcoin node running the bitcoin core daemon (bitcoind).
   * To use default polar config, do not pass a config. See {@link DEFAULT_BITCOIN_NETWORK_CONFIG} for default config.
   * @required A locally running {@link https://github.com/jamaljsr/polar | Polar Lightning} regtest node.
   *
   * @param {?RpcClientConfig} config The configuration object for the client (optional).
   * @returns A new {@link BitcoinRpcClient} instance.
   * @example
   * ```
   * const alice = BitcoinRpcClient.connect();
   * ```
   */
  public static connect(config?: RpcClientConfig): BitcoinCoreRpcClient {
    return new BitcoinCoreRpcClient(config ?? DEFAULT_BITCOIN_NETWORK_CONFIG.regtest.rpc);
  }

  /**
   * Check if the given error is a JSON-RPC error.
   * @param {unknown} e The error to check.
   * @returns {boolean} True if the error is a JSON-RPC error, false otherwise.
   */
  public isJsonRpcError(e: unknown): e is Error & { name: 'RpcError'; code?: number } {
    return (
      e instanceof Error &&
      e.name === 'RpcError' &&
      typeof (e as any).code === 'number'
    );
  }

  /**
   * Executes a JSON-RPC command on the bitcoind node.
   * @param {MethodNameInLowerCase} method The name of the method to call.
   * @param {Array<any>} parameters The parameters to pass to the method.
   * @returns {Promise<T>} A promise resolving to the result of the command.
   */
  private async executeRpc<T>(method: MethodNameInLowerCase, parameters: Array<any> = []): Promise<T> {
    try {
      const raw = await this.client.command([{ method, parameters }] as BatchOption[]);
      const normalized = JSON.unprototyped(raw) ? JSON.normalize(raw) : raw;
      const result = Array.isArray(normalized)
        ? normalized[normalized.length - 1]
        : normalized;
      return result as T;
    } catch (err: unknown) {
      this.handleError(err, method, parameters);
    }
  }

  /**
   *
   * Map JSON-RPC error codes to HTTP status codes.
   * @param {number | undefined} code The JSON-RPC error code.
   * @returns {number} The corresponding HTTP status code.
   *
   * | Error type                     | HTTP code           |
   * | -------------------------------| --------------------|
   * | Valid JSON-RPC failure         | **400 / 404 / 422** |
   * | JSON-RPC authentication issues | **401 / 403**       |
   * | Upstream bitcoind unreachable  | **502**             |
   * | Upstream timeout               | **504**             |
   * | Network transient errors       | **503**             |
   * | Unknown unexpected errors      | **500**             |
   */
  private mapRpcCodeToHttp(code?: number): number {
    switch (code) {
      case -32700:
      case -32600:
      case -32602:
        return 400;

      case -32601:
        return 404;

      default:
        return 422;
    }
  }

  /**
   * Handle errors that occur while executing commands.
   * @param methods An array of {@link BatchOption} objects.
   * @param error The error that was thrown.
   * @throws Throws a {@link BitcoinRpcError} with the error message.
   */
  private handleError(err: unknown, method: string, params: any[]): never {
    if (this.isJsonRpcError(err)) {
      throw new BitcoinRpcError(
        err.name.toUpperCase(),
        this.mapRpcCodeToHttp(err.code),
        `RPC ${method} failed: ${err.message}`,
        { method, params }
      );
    }

    throw new BitcoinRpcError(
      'UNKNOWN_ERROR',
      500,
      `Unknown failure in ${method}`,
      { method, params, err }
    );
  }

  /**
   * Returns the block data associated with a `blockhash` of a valid block.
   * @param {GetBlockParams} params See {@link GetBlockParams} for details.
   * @param {?string} params.blockhash The blockhash of the block to query.
   * @param {?number} params.height The block height of the block to query.
   * @param {?VerbosityLevel} params.verbosity The verbosity level. See {@link VerbosityLevel}.
   * @returns {BlockResponse} A promise resolving to a {@link BlockResponse} formatted depending on `verbosity` level.
   * @throws {BitcoinRpcError} If neither `blockhash` nor `height` is provided.
   */
  public async getBlock({ blockhash, height, verbosity }: GetBlockParams): Promise<BlockResponse | undefined> {
    // Check if blockhash or height is provided, if neither throw an error
    if(!blockhash && height === undefined) {
      throw new BitcoinRpcError('INVALID_PARAMS_GET_BLOCK', 400, 'blockhash or height required', { blockhash, height });
    }

    // If height is provided, get the blockhash
    blockhash ??= await this.getBlockHash(height!);
    if(!blockhash || typeof blockhash !== 'string') {
      return undefined;
    }
    // Get the block data
    const block = await this.executeRpc('getblock', [blockhash, verbosity ?? 3]);

    // Return the block data depending on verbosity level
    switch(verbosity) {
      case 0:
        return block as BlockV0;
      case 1:
        return block as BlockV1;
      case 2:
        return block as BlockV2;
      case 3:
        return block as BlockV3;
      default:
        return block as BlockV3;
    }
  }

  /**
   * Returns the blockheight of the most-work fully-validated chain. The genesis block has height 0.
   * @returns {Blockheight} The number of the blockheight with the most-work of the fully-validated chain.
   */
  public async getBlockCount(): Promise<number> {
    return await this.executeRpc('getblockcount');
  }

  /**
   * Returns the blockhash of the block at the given height in the active chain.
   */
  public async getBlockHash(height: number): Promise<string> {
    return await this.executeRpc('getblockhash', [height]);
  }

  /**
   * Returns an object containing various blockchain state info.
   */
  public async getBlockchainInfo(): Promise<ChainInfo> {
    return this.executeRpc('getblockchaininfo');
  }

  /**
   * Sign inputs for raw transaction (serialized, hex-encoded).
   * The second optional argument (may be null) is an array of previous transaction outputs that
   * this transaction depends on but may not yet be in the block chain.
   * Requires wallet passphrase to be set with walletpassphrase call if wallet is encrypted.
   * @param {string} hexstring The hex-encoded transaction to send.
   */
  public async signRawTransaction(hexstring: string): Promise<SignedRawTx> {
    return await this.executeRpc<SignedRawTx>('signrawtransactionwithwallet', [hexstring]);
  }

  /**
   * Submit a raw transaction (serialized, hex-encoded) to local node and network.
   *
   * The transaction will be sent unconditionally to all peers, so using sendrawtransaction
   * for manual rebroadcast may degrade privacy by leaking the transaction's origin, as
   * nodes will normally not rebroadcast non-wallet transactions already in their mempool.
   *
   * @param {string} hexstring The hex-encoded transaction to send.
   * @param {numbner} [maxfeerate] If not passed, default is 0.10.
   * @returns {Promise<string>} A promise resolving to the transaction hash in hex.
   */
  public async sendRawTransaction(
    hexstring: string,
    maxfeerate?: number | string,
    maxBurnAmount?: number | string
  ): Promise<string> {
    return await this.executeRpc<string>('sendrawtransaction', [hexstring, maxfeerate ?? 0.10, maxBurnAmount ?? 0.00]);
  }

  /**
   * Combines calls to `signRawTransaction` and `sendRawTransaction`.
   * @param {string} params.hexstring The hex-encoded transaction to send.
   * @returns {Promise<string>} A promise resolving to the transaction hash in hex.
   */
  public async signAndSendRawTransaction(hexstring: string): Promise<string> {
    const signedRawTx = await this.signRawTransaction(hexstring,);
    return await this.sendRawTransaction(signedRawTx.hex);
  }

  /**
   * Combines calls to `createRawTransaction`, `signRawTransaction` and `sendRawTransaction`.
   * @param {CreateRawTxInputs[]} inputs The inputs to the transaction (required).
   * @param {CreateRawTxOutputs[]} outputs The outputs of the transaction (required).
   * @returns {Promise<string>} A promise resolving to the transaction hash in hex.
   */
  public async createSignSendRawTransaction(inputs: CreateRawTxInputs[], outputs: CreateRawTxOutputs[]): Promise<string> {
    const rawTx = await this.createRawTransaction(inputs, outputs);
    const signedRawTx = await this.signRawTransaction(rawTx);
    const sentRawTx = await this.sendRawTransaction(signedRawTx.hex);
    return sentRawTx;
  }

  /**
   * Returns up to 'count' most recent transactions skipping the first 'from' transactions for account 'label'.
   * @param {ListTransactionsParams} params The parameters for the listTransactions command.
   * @returns {Promise<ListTransactionsResult>} A promise resolving to a {@link ListTransactionsResult} object.
   */
  public async listTransactions(params: ListTransactionsParams): Promise<ListTransactionsResult> {
    return await this.executeRpc('listtransactions', [params]);
  }

  /**
   * Create a transaction spending the given inputs and creating new outputs.
   * Outputs can be addresses or data.
   * Returns hex-encoded raw transaction.
   * Note that the transaction's inputs are not signed, and
   * it is not stored in the wallet or transmitted to the network.
   * @param {TxInForCreateRaw[]} inputs The inputs to the transaction (required).
   * @param {CreateRawTxOutputs[]} outputs The outputs of the transaction (required).
   * @param {number} [locktime] The locktime of the transaction (optional).
   * @param {boolean} [replacable] Whether the transaction is replaceable (optional).
   * @returns {string} The hex-encoded raw transaction.
   */
  public async createRawTransaction(inputs: CreateRawTxInputs[], outputs: CreateRawTxOutputs[], locktime?: number, replacable?: boolean): Promise<string> {
    return await this.executeRpc<string>('createrawtransaction', [inputs, outputs, locktime, replacable]);
  }

  /**
   * Derives one or more addresses corresponding to an output descriptor.
   * Examples of output descriptors are:
   *   pkh(<pubkey>)                                     P2PKH outputs for the given pubkey
   *   wpkh(<pubkey>)                                    Native segwit P2PKH outputs for the given pubkey
   *   sh(multi(<n>,<pubkey>,<pubkey>,...))              P2SH-multisig outputs for the given threshold and pubkeys
   *   raw(<hex script>)                                 Outputs whose output script equals the specified hex-encoded bytes
   *   tr(<pubkey>,multi_a(<n>,<pubkey>,<pubkey>,...))   P2TR-multisig outputs for the given threshold and pubkeys
   *
   * In the above, <pubkey> either refers to a fixed public key in hexadecimal notation, or to an xpub/xprv optionally followed by one
   * or more path elements separated by "/", where "h" represents a hardened child key.
   *
   * See {@link https://github.com/bitcoin/bitcoin/blob/master/doc/descriptors.md | github.com/bitcoin/bitcoin/descriptors.md}
   * for more information.
   * @param {string} descriptor The descriptor.
   * @param {Array<number>} range If descriptor is ranged, must specify end or [begin,end] to derive.
   * @returns {Array<DerivedAddresses>} a list of derived addresses
   * @example First three native segwit receive addresses
   * ```
   * const bitcoind = BitcoinRpcClient.connect()
   * const addresses = bitcoind.deriveAddresses("wpkh([d34db33f/84h/0h/0h]xpub6DJ2dN.../0/*)#cjjspncu", [0,2])
   * ```
   */
  public async deriveAddresses(descriptor: string, range?: Array<number>): Promise<Array<DerivedAddresses>> {
    return await this.executeRpc('deriveaddresses', [descriptor, range]);
  }

  /**
   * Returns the total available balance. The available balance is what the wallet
   * considers currently spendable, and is thus affected by options which limit
   * spendability such as -spendzeroconfchange.
   * @returns {Promise<number>} A promise resolving to the total available balance in BTC.
   */
  public async getBalance(): Promise<number> {
    return await this.executeRpc('getbalance');
  }

  /**
   * Returns a new Bitcoin address for receiving payments. If 'label' is specified,
   * it is added to the address book so payments received with the address will be associated with 'label'.
   * The 'address_type' can be one of "legacy", "p2sh-segwit", "bech32", or "bech32m".
   * @param {string} addressType The address type to use (required, options=["legacy", "p2sh-segwit", "bech32", "bech32m"], default="bech32").
   * @param {string} [label] The label to associate with the new address (optional).
   * @returns {Promise<string>} A promise resolving to the new address.
   */
  public async getNewAddress(addressType: string, label?: string): Promise<string> {
    return await this.executeRpc('getnewaddress', [label ?? '', addressType]);
  }

  /**
   * Returns array of unspent transaction outputs with between minconf and maxconf (inclusive) confirmations.
   * Optionally filter to only include txouts paid to specified addresses.
   * @param {Object} params The parameters for the listUnspent command.
   * @param {number} [params.minconf=0] The minimum number of confirmations an output must have to be included.
   * @param {number} [params.maxconf=9999999] The maximum number of confirmations an output can have to be included.
   * @param {string[]} [params.address] Only include outputs paid to these addresses.
   * @param {boolean} [params.include_unsafe=true] Whether to include outputs that are not safe to spend.
   * @returns {Promise<UnspentTxInfo[]>} A promise resolving to an array of {@link UnspentTxInfo} objects.
   */
  public async listUnspent(params: {
      minconf?: number;
      maxconf?: number;
      address?: string[];
      include_unsafe?: boolean;
  }): Promise<UnspentTxInfo[]> {
    const args = { minconf: 0, maxconf: 9999999, include_unsafe: true, ...params };
    return await this.executeRpc('listunspent', [args]);
  }

  /**
   * Send an amount to a given address.
   * @param {string} address The address to send to.
   * @param {number} amount The amount to send in BTC.
   * @returns {Promise<SendToAddressResult>} A promise resolving to the transaction id.
   */
  public async sendToAddress(address: string, amount: number): Promise<RawTransactionV2> {
    const txid = await this.executeRpc<string>('sendtoaddress', [address, amount]);
    return await this.getRawTransaction(txid) as RawTransactionV2;
  }

  /**
   * Sign a message with the private key of an address.
   * @param {string} address The address to sign the message with.
   * @param {string} message The message to sign.
   * @returns {Promise<string>} A promise resolving to the signature in base64.
   */
  public async signMessage(address: string, message: string): Promise<string> {
    return await this.executeRpc('signmessage', [address, message]);
  }

  /**
   * Verify a signed message.
   * @param {string} address The address to verify the message with.
   * @param {string} signature The signature to verify in base64.
   * @param {string} message The message to verify.
   * @returns {Promise<boolean>} A promise resolving to true if the signature is valid, false otherwise.
   */
  public async verifyMessage(address: string, signature: string, message: string): Promise<boolean> {
    return await this.executeRpc('verifymessage', [address, signature, message]);
  }

  /**
   * Get detailed information about in-wallet transaction <txid>.
   * @param txid: The transaction id. (string, required)
   * @param {boolean} include_watchonly Whether to include watch-only addresses in balance calculation and details.
   * @returns {WalletTransaction} A promise resolving to a {@link WalletTransaction} object.
   */
  public async getTransaction(txid: string, include_watchonly?: boolean): Promise<WalletTransaction> {
    return await this.executeRpc('gettransaction', [txid, include_watchonly]);
  }

  /**
   * Get detailed information about a transaction.
   * By default, this call only returns a transaction if it is in the mempool. If -txindex is enabled
   * and no blockhash argument is passed, it will return the transaction if it is in the mempool or any block.
   * If a blockhash argument is passed, it will return the transaction if the specified block is available and
   * the transaction is in that block.
   * @param {string} txid The transaction id (required).
   * @param {?VerbosityLevel} verbosity Response format: 0 (hex), 1 (json) or 2 (jsonext).
   * @param {?string} blockhash The block in which to look for the transaction (optional).
   * @returns {GetRawTransaction} A promise resolving to data about a transaction in the form specified by verbosity.
   */
  public async getRawTransaction(txid: string, verbosity?: VerbosityLevel, blockhash?: string): Promise<RawTransactionResponse> {
    // Get the raw transaction
    const rawTransaction = await this.executeRpc('getrawtransaction', [txid, verbosity ?? 2, blockhash]);
    // Return the raw transaction based on verbosity
    switch(verbosity) {
      case 0:
        return rawTransaction as RawTransactionV0;
      case 1:
        return rawTransaction as RawTransactionV1;
      case 2:
        return rawTransaction as RawTransactionV2;
      default:
        return rawTransaction as RawTransactionV2;
    }
  }

  /**
   * Get detailed information about multiple transactions. An extension of {@link getRawTransaction}.
   * @param {Array<string>} txids An array of transaction ids.
   * @param {?VerbosityLevel} verbosity Response format: 0 (hex), 1 (json) or 2 (jsonext).
   * @returns {Promise<Array<RawTransactionResponse>>}
   */
  public async getRawTransactions(txids: string[], verbosity?: VerbosityLevel): Promise<RawTransactionResponse[]> {
    return await Promise.all(
      txids.map(
        async (txid) => await this.getRawTransaction(txid, verbosity ?? 2)
      )
    );
  }

}
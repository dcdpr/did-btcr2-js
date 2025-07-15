import { default as RpcClient } from 'bitcoin-core';
import {
  AddMultiSigAddressParams,
  BatchOption,
  BitcoinSignature,
  BlockHeader,
  BlockResponse,
  BlockV0,
  BlockV1,
  BlockV2,
  BlockV3,
  BumpFeeOption,
  BumpFeeOptions,
  BumpFeeResult,
  ChainInfo,
  CreateMultisigParams,
  CreateMultiSigResult,
  CreateRawTxInputs,
  CreateRawTxOutputs,
  CreateWalletDescriptorOptions,
  CreateWalletDescriptorsResult,
  CreateWalletParams,
  CreateWalletResult,
  DecodedRawTransaction,
  DerivedAddresses,
  FeeEstimateMode,
  FundRawTxOptions,
  FundRawTxResult,
  GetBlockParams,
  GetUTXOsResult,
  ImportDescriptorRequest,
  ImportMultiOptions,
  ImportMultiRequest,
  ImportMultiResult,
  ListTransactionsParams,
  ListTransactionsResult,
  ListUnspentParams,
  MemoryStats,
  MempoolContent,
  MempoolInfo,
  MethodNameInLowerCase,
  MiningInfo,
  Outpoint,
  PeerInfo,
  RawTransactionResponse,
  RawTransactionV0,
  RawTransactionV1,
  RawTransactionV2,
  ScanBlocksParams,
  ScriptDecoded,
  SendAllParams,
  SendAllResult,
  SendManyParams,
  SignedRawTx,
  UnspentTxInfo,
  ValidateAddressResult,
  VerbosityLevel,
  WalletTransaction
} from './types.js';
import { DEFAULT_RPC_CLIENT_CONFIG } from '../constants.js';
import { BitcoinRpcError } from '../errors.js';
import { ClientConfig, RpcClientConfig } from './config.js';

export interface ReturnFormatOptions {
    extension?: 'json' | 'bin' | 'hex';
}
export interface BlockHashOptions extends ReturnFormatOptions {
    summary?: boolean;
}

/**
 * Interface for the Bitcoin Core RPC client.
 */
export interface BitcoinRpcClient {
    /** Executes multiple commands in a batch request. */
    command?<R extends ReturnType<any>>(methods: BatchOption[]): Promise<ReadonlyArray<R>>;

    /** Marks a transaction and its in-wallet descendants as abandoned, allowing their inputs to be respent. */
    abandonTransaction(txid: string): Promise<void>;

    /** Stops the current wallet rescan triggered by an RPC call, such as by an importprivkey call. */
    abortRescan(): Promise<void>;

    /** Adds a multi-signature address with n required signatures and a set of keys. */
    addMultiSigAddress({ nrequired, keys, account }: AddMultiSigAddressParams): Promise<string>;

    /** Adds a witness address for SegWit compatibility. */
    addWitnessAddress(address: string): Promise<void>;

    /** Backs up the wallet file to a specified destination. */
    backupWallet(destination: string): Promise<void>;

    /** Increases the fee of an unconfirmed transaction to improve its confirmation time. */
    bumpFee(txid: string, options?: BumpFeeOption): Promise<BumpFeeResult>;

    /** Removes all banned nodes from the ban list. */
    clearBanned(): Promise<void>;

    /** Combines multiple raw transactions into a single transaction. */
    combineRawTransaction(txs: string[]): Promise<string>;

    /** Creates a multi-signature address with n required signatures and a set of keys. */
    createMultiSig(nrequired: number, keys: string[]): Promise<CreateMultiSigResult>;

    /** Creates a raw transaction spending specified inputs to specified outputs. */
    createRawTransaction(inputs: CreateRawTxInputs[], outputs: CreateRawTxOutputs[], locktime?: number, replacable?: boolean): Promise<string>;

    /** Creates a new wallet with various optional parameters. */
    createWallet({
      wallet_name,
      disable_private_keys,
      blank,
      passphrase,
      avoid_reuse,
      descriptors,
      load_on_startup,
    }: CreateWalletParams): Promise<CreateWalletResult>;

    /** Decodes a raw transaction hex string. */
    decodeRawTransaction(hexstring: string): Promise<DecodedRawTransaction>;

    /** Decodes a hex-encoded script. */
    decodeScript(hexstring: string): Promise<ScriptDecoded>;

    /** Disconnects a node by address or node ID. */
    disconnectNode(address?: string, nodeid?: number): Promise<void>;

    /** Reveals the private key corresponding to an address. */
    dumpPrivKey(address: string): Promise<string>;

    /** Dumps all wallet keys and metadata to a file. */
    dumpWallet(filename: string): Promise<{ filename: string }>;

    /** Encrypts the wallet with a passphrase. */
    encryptWallet(passphrase: string): Promise<void>;

    /** Estimates the fee rate for a given confirmation target. */
    estimateSmartFee(
        conf_target: number,
        estimate_mode?: FeeEstimateMode,
    ): Promise<{ feerate?: number; errors?: string[]; blocks?: number }>;

    /** Funds a raw transaction by adding necessary inputs and change. */
    fundRawTransaction(
        hexstring: string,
        options: FundRawTxOptions,
    ): Promise<{ hex: string; fee: number; changepos: number }>;

    /** Returns the number of blocks in the longest blockchain. */
    getBlockCount(): Promise<number>;

    /** Gets the hash of a block at a given height. */
    getBlockHash(height: number): Promise<string>;

    /** Gets detailed information about a specific block. */
    getBlock({ blockhash, height, verbosity }: GetBlockParams): Promise<BlockResponse | undefined>

    /** Retrieves general blockchain state info. */
    getBlockchainInfo(): Promise<ChainInfo>;

    /** Gets the number of active connections to other nodes. */
    getConnectionCount(): Promise<number>;

    /** Gets the estimated network difficulty. */
    getDifficulty(): Promise<number>;

    /** Retrieves memory pool statistics. */
    getMempoolInfo(): Promise<MempoolInfo>;

    /** Retrieves mining statistics. */
    getMiningInfo(): Promise<MiningInfo>;

    /** Gets a new Bitcoin address for receiving payments. */
    getNewAddress(account?: string): Promise<string>;

    /** Gets detailed peer connection information. */
    getPeerInfo(): Promise<PeerInfo[]>;

    /** Sends raw transaction hex to the Bitcoin network. */
    sendRawTransaction(
      hexstring: string,
      maxfeerate?: number | string,
      maxBurnAmount?: number | string
    ): Promise<string>;

    /** Sends bitcoins to a specified address. */
    sendToAddress(
        address: string,
        amount: number,
        comment?: string,
        comment_to?: string,
        subtreactfeefromamount?: boolean,
        replaceable?: boolean,
        conf_target?: number,
        estimate_mode?: FeeEstimateMode,
    ): Promise<RawTransactionResponse>;

    /** Validates a Bitcoin address. */
    validateAddress(address: string): Promise<ValidateAddressResult>;

    /** Verifies a signed message. */
    verifyMessage(address: string, signature: string, message: string): Promise<boolean>;

    /** Locks the wallet, requiring a passphrase to unlock. */
    walletLock(passphrase: string, timeout: number): Promise<void>;
}

/**
 * Encapsulates a {@link RpcClient | Client} object from {@link https://www.npmjs.com/package/bitcoin-core | `bitcoin-core`}.
 * Implements a strongly-typed {@link IBitcoinRpc | IBitcoinRpc interface} for added expresivity and developer support.
 * @class BitcoinRpc
 * @type {BitcoinRpc}
 */
export default class BitcoinRpc implements BitcoinRpcClient {
  /**
   * The encapsulated {@link RpcClientConfig} object.
   * @private
   * @type {RpcClient} An instance of the Client class from {@link https://www.npmjs.com/package/bitcoin-core | `bitcoin-core`}.
   * See {@link https://github.com/ruimarinho/bitcoin-core/blob/master/src/index.d.ts#L64 | `Client`} for more information.
   */
  private _client: RpcClient;

  /**
   * The encapsulated {@link RpcClientConfig} object.
   * @private
   * @type {RpcClientConfig} ClientConfig from {@link https://www.npmjs.com/package/bitcoin-core | `bitcoin-core`}.
   * See {@link https://github.com/ruimarinho/bitcoin-core/blob/master/src/index.d.ts#L39 | `ClientConfig`} for more information.
   */
  private _config: RpcClientConfig;

  /**
   * Constructs a new {@link BitcoinRpc} instance from a new {@link RpcClient | RpcClient}.
   * @param {RpcClientConfig} config The bitcoin-core client instance.
   * @example
   * ```
   *  import BitcoinRpc from '@did-btc1/method';
   *  const bob = BitcoinRpc.connect(); // To use default polar config, pass no args. Polar must run locally.
   * ```
   */
  constructor(config: RpcClientConfig) {
    this._config = new RpcClientConfig(config);
    this._client = new RpcClient(this._config);
  }

  /**
   * Get the config for the current BitcoinRpc object.
   * @returns {RpcClientConfig} The encapsulated {@link RpcClientConfig} object.
   * @example
   * ```
   *  import BitcoinRpc from '@did-btc1/method';
   *  const alice = BitcoinRpc.connect();
   *  const config = alice.config;
   * ```
   */
  get config(): RpcClientConfig {
    const config = this._config;
    return config;
  }

  /**
   * Get the client for the current BitcoinRpc object.
   * @returns {RpcClient} The encapsulated {@link RpcClient} object.
   * @example
   * ```
   * const alice = BitcoinRpc.connect();
   * const config = alice.client;
   * ```
   */
  get client(): RpcClient {
    const client = this._client;
    return client;
  }

  /**
   * Static method initializes a new BitcoinRpc client with the given configuration.
   * The RpcClient returned by this method does not have any named methods.
   * Use this method to create and pass a new RpcClient instance to a BitcoinRpc constructor.
   *
   * @param {ClientConfig} config The configuration object for the client (optional).
   * @returns {RpcClient} A new RpcClient instance.
   * @example
   * ```
   * const options: ClientConfig = {
   *     host: 'http://localhost:18443',
   *     username: 'alice',
   *     password: 'alicepass',
   *     version: '28.1.0',
   * }
   * const aliceClient = BitcoinRpc.initialize(options); // Client config required
   * const alice = new BitcoinRpc(aliceClient);
   * ```
   */
  public static initialize(config?: ClientConfig): RpcClient {
    const rpcConfig = RpcClientConfig.initialize(config);
    return new RpcClient(rpcConfig);
  }

  /**
   * Static method connects to a bitcoin node running the bitcoin core daemon (bitcoind).
   * To use default polar config, do not pass a config. See {@link DEFAULT_RPC_CLIENT_CONFIG} for default config.
   * @required A locally running {@link https://github.com/jamaljsr/polar | Polar Lightning} regtest node.
   *
   * @param {?RpcClientConfig} config The configuration object for the client (optional).
   * @returns A new {@link BitcoinRpc} instance.
   * @example
   * ```
   * const alice = BitcoinRpc.connect();
   * ```
   */
  public static connect(config?: RpcClientConfig): BitcoinRpc {
    const client = this.initialize(config ?? DEFAULT_RPC_CLIENT_CONFIG);
    return new BitcoinRpc(client);
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
      // raw call
      const raw = await this.client.command(
        [{ method, parameters }] as BatchOption[]
      );
      // normalization/unwrapping, if needed
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
   * Handle errors that occur while executing commands.
   * @param methods An array of {@link BatchOption} objects.
   * @param error The error that was thrown.
   * @throws Throws a {@link BitcoinRpcError} with the error message.
   */
  private handleError(err: unknown, method: string, params: any[]): never {
    if (this.isJsonRpcError(err)) {
      // a bitcoind JSON‑RPC error
      throw new BitcoinRpcError(
        err.code!,
        `RPC ${method} failed: ${err.message}`,
        { method, params }
      );
    }

    if (err instanceof Error) {
      // network, HTTP, or unexpected client error
      throw new BitcoinRpcError(
        'NETWORK_ERROR',
        `Network error in ${method}: ${err.message}`,
        { method, params, original: err }
      );
    }

    // absolutely unknown
    throw new BitcoinRpcError(
      'UNKNOWN_ERROR',
      `Unknown failure in ${method}`,
      { method, params, err }
    );
  }

  /**
   * TODO: Comments
   */
  public async getUnspentTransactionOutputs(outpoints: Outpoint[]): Promise<GetUTXOsResult> {
    return this.client.getUnspentTransactionOutputs(outpoints);
  }

  /**
   * TODO: Comments
   */
  public async getTransactionByHash(hash: string, options?: ReturnFormatOptions): Promise<string> {
    return this.client.getTransactionByHash(hash, options);
  }

  /**
   * TODO: Comments
   */
  public async getBlockHeadersByHash(hash: string, count: number, options?: ReturnFormatOptions): Promise<BlockHeader[]> {
    return this.client.getBlockHeadersByHash(hash, count, options);
  }

  /**
   * TODO: Comments
   */
  public async getMemoryPoolContent(): Promise<MempoolContent> {
    return this.client.getMemoryPoolContent();
  }

  /**
   * TODO: Comments
   */
  public async getMemoryPoolInformation(): Promise<MempoolInfo> {
    return this.client.getMemoryPoolInformation();
  }

  /**
   * Alias for `getblock <hash> 2`
   */
  public async getBlockByHash(hash: string, options?: BlockHashOptions): Promise<BlockHeader> {
    return this.client.getBlockByHash(hash, options);
  }

  /**
   * TODO: Comments
   */
  public async abandonTransaction(txid: string): Promise<void> {
    return await this.executeRpc('abandontransaction', [txid]);
  }

  /**
   * TODO: Comments
   */
  public async abortRescan(): Promise<void> {
    return await this.executeRpc('abortrescan');
  }

  /**
   * TODO: Comments
   */
  public async addMultiSigAddress(params: AddMultiSigAddressParams): Promise<string> {
    return await this.executeRpc('addmultisigaddress', [params]);
  }

  /**
   * TODO: Comments
   */
  public async addWitnessAddress(address: string): Promise<void> {
    return await this.executeRpc('addwitnessaddress', [address]);
  }

  /**
   * TODO: Comments
   */
  public async backupWallet(destination: string): Promise<void> {
    return await this.executeRpc('backupwallet', [destination]);
  }

  /**
   * TODO: Comments
   */
  public async bumpFee(txid: string, options?: BumpFeeOptions): Promise<BumpFeeResult> {
    return await this.executeRpc('bumpfee', [txid, options]);
  }

  /**
   * TODO: Comments
   */
  public async createMultiSig(nrequired: number, keys: string[]): Promise<CreateMultiSigResult> {
    return await this.executeRpc('createmultisig', [nrequired, keys]);
  }

  /**
   * TODO: Comments
   */
  public async createWallet(params: CreateWalletParams): Promise<CreateWalletResult> {
    return await this.executeRpc('createwallet', [params]);
  }

  /**
   * TODO: Comments
   */
  public async decodeScript(hexstring: string): Promise<ScriptDecoded> {
    return await this.executeRpc('decodescript', [hexstring]);
  }

  /**
   * TODO: Comments
   */
  public async getBestBlockHash(): Promise<string> {
    return await this.executeRpc('getbestblockhash', []);
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
      throw new BitcoinRpcError('blockhash or height required', 'INVALID_PARAMS_GET_BLOCK', { blockhash, height });
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
   * TODO: Comments
   */
  public async getBlockHeader(hash: string, verbose?: boolean): Promise<string | BlockHeader> {
    return await this.executeRpc('getblockheader', [hash, verbose]);
  }

  /**
   * TODO: Comments
   */
  public async getBlockchainInfo(): Promise<ChainInfo> {
    return this.client.getBlockchainInformation();
  }

  /**
   * TODO: Comments
   */
  public async getInfo(...args: any[]): Promise<void> {
    return await this.executeRpc('getinfo', [...args]);
  }

  /**
   * TODO: Comments
   */
  public async getMemoryInfo(mode?: 'stats' | 'mallocinfo'): Promise<MemoryStats | string> {
    return await this.executeRpc('getmemoryinfo', [mode]);
  }

  /**
   * TODO: Comments
   */
  public async scanBlocks(params: ScanBlocksParams): Promise<any> {
    return await this.executeRpc('scanblocks', [params]);
  }

  /**
   * TODO: Comments
   */
  public async fundRawTransaction(hexstring: string, options: FundRawTxOptions): Promise<FundRawTxResult> {
    return await this.executeRpc('fundrawtransaction', [hexstring, options]);
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
    console.log('sendRawTransaction', { hexstring, maxfeerate, maxBurnAmount });
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
   * TODO: Comments
   */
  public async listTransactions(params: ListTransactionsParams): Promise<ListTransactionsResult> {
    return await this.executeRpc('listtransactions', [params]);
  }

  /**
   * TODO: Comments
   */
  public async decodeRawTransaction(hexstring: string): Promise<DecodedRawTransaction> {
    return await this.executeRpc('decoderawtransaction', [hexstring]);
  }

  /**
   * TODO: Comments
   */
  public async combineRawTransaction(txs: string[]): Promise<string> {
    return await this.executeRpc<string>('combinerawtransaction', [txs]);
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
   * Creates a multi-signature address with n signature of m keys required.
   *
   * @param {CreateMultisigParams} params The parameters for the createMultisig command.
   * @param {number} params.nrequired The number of required signatures out of the n keys (required).
   * @param {string[]} params.keys The hex-encoded public keys (required).
   * @param {?string} params.address_type The address type to use (optional, options=["legacy", "p2sh-segwit", "bech32"], default="legacy").
   * @returns {CreateMultiSigResult} json object with the address and redeemScript.
   *
   * @example Create a multisig address from 2 public keys
   * ```
   * const bob = BitcoinRpc.connect();
   * const keys = [
   *  '03789ed0bb717d88f7d321a368d905e7430207ebbd82bd342cf11ae157a7ace5fd',
   *  '03dbc6764b8884a92e871274b87583e6d5c2a58819473e17e107ef3f6aa5a61626'
   * ];
   * const multisig = await bob.createMultisig({ nrequired: 2, keys });
   * ```
   */
  public async createMultisig({ nrequired, keys, address_type }: CreateMultisigParams): Promise<CreateMultiSigResult> {
    return await this.executeRpc('createmultisig', [nrequired, keys, address_type]);
  }

  /**
   * TODO: Comments
   */
  public async getDescriptorInfo(descriptor: string): Promise<any> {
    return await this.executeRpc('getdescriptorinfo', [descriptor]);
  }

  /**
   * TODO: Comments
   */
  public async signMessageWithPrivkey(privkey: string, message: string): Promise<BitcoinSignature> {
    return await this.executeRpc('signmessagewithprivkey', [privkey, message]);
  }

  /**
   * TODO: Comments
   */
  public async validateAddress(address: string): Promise<ValidateAddressResult> {
    return await this.executeRpc('validateaddress', [address]);
  }

  /**
   * TODO: Comments
   */
  public async verifyMessage(address: string, signature: string, message: string): Promise<boolean> {
    return await this.executeRpc('verifymessage', [address, signature, message]);
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
   * @async
   * @param {string} descriptor The descriptor.
   * @param {Array<number>} range If descriptor is ranged, must specify end or [begin,end] to derive.
   * @returns {Array<DerivedAddresses>} a list of derived addresses
   * @example First three native segwit receive addresses
   * ```
   * const bitcoind = BitcoinRpc.connect()
   * const addresses = bitcoind.deriveAddresses("wpkh([d34db33f/84h/0h/0h]xpub6DJ2dN.../0/*)#cjjspncu", [0,2])
   * ```
   */
  public async deriveAddresses(descriptor: string, range?: Array<number>): Promise<Array<DerivedAddresses>> {
    return await this.executeRpc('deriveaddresses', [descriptor, range]);
  }

  /**
   * TODO: Comments
   */
  public async addMultisigAddress(): Promise<any> {
    return await this.executeRpc('addmultisigaddress');
  }

  /**
   * Creates the wallet's descriptor for the given address type. The address type must be one that the
   * wallet does not already have a descriptor for. Requires wallet passphrase to be set with walletpassphrase call
   * if wallet is encrypted.
   * @param type The address type the descriptor will produce. Options are "legacy", "p2sh-segwit", "bech32", and "bech32m". (string, required)
   * @param options Options object that can be used to pass named arguments, listed below. (json object, optional)
   * @param options.internal Whether to only make one descriptor that is internal (if parameter is true) or external (if parameter is false)
   *                          (boolean, optional, default=Both external and internal will be generated unless this parameter is specified)
   * @param options.hdkey The HD key that the wallet knows the private key of, listed using 'gethdkeys', to use for this descriptor's key.
   *                       (string, optional, default=The HD key used by all other active descriptors)
   * @returns A {@link CreateWalletDescriptorsResult} response object
   */
  public async createWalletDescriptor(type: string, options: CreateWalletDescriptorOptions): Promise<CreateWalletDescriptorsResult> {
    return await this.executeRpc('createwalletdescriptor', [type, options]);
  }

  /**
   * TODO: Comments
   */
  public async getBalance(): Promise<any> {
    return await this.executeRpc('getbalance');
  }

  /**
   * TODO: Comments
   */
  public async getNewAddress(account?: string): Promise<string> {
    return await this.executeRpc('getnewaddress', [account]);
  }

  /**
   * TODO: Comments
   */
  public async importAddress(script: string, label?: string, rescan?: boolean, p2sh?: boolean): Promise<void> {
    return await this.executeRpc('importaddress', [script, label, rescan, p2sh]);
  }

  /**
   * Import descriptors.
   *
   * This will trigger a rescan of the blockchain based on the earliest timestamp of all descriptors being imported.
   * Requires a new wallet backup. Note: This call can take over an hour to complete if using an early timestamp;
   * during that time, other rpc calls may report that the imported keys, addresses or scripts exist but related
   * transactions are still missing. The rescan is significantly faster if block filters are available
   * (using startup option "-blockfilterindex=1").
   *
   * @param requests Array of {@link ImportDescriptorRequest} objects to be imported
   * @returns Array of {@link ImportDescriptorResult} objects
   * @returns
   */
  public async importDescriptors(requests: Array<ImportDescriptorRequest>): Promise<any> {
    return await this.executeRpc('importdescriptors', [requests]);
  }

  /**
   * TODO: Comments
   */
  public async importMulti(requests: ImportMultiRequest[], options?: ImportMultiOptions): Promise<Array<ImportMultiResult>> {
    return await this.executeRpc('importmulti', [requests, options]);
  }

  /**
   * TODO: Comments
   */
  public async listUnspent(params: ListUnspentParams): Promise<UnspentTxInfo[]> {
    return await this.executeRpc('listunspent', [params]);
  }

  /**
   * TODO: Comments
   */
  public async rescanBlockchain(): Promise<any> {
    return await this.executeRpc('addmultisigaddress');
  }

  /**
   * Send an amount to a given address.
   * @async
   * @param {string} address The address to send to.
   * @param {number} amount The amount to send in BTC.
   * @returns {Promise<SendToAddressResult>} A promise resolving to the transaction id.
   */
  public async sendToAddress(address: string, amount: number): Promise<RawTransactionV2> {
    const txid = await this.executeRpc<string>('sendtoaddress', [address, amount]);
    return await this.getRawTransaction(txid) as RawTransactionV2;
  }

  /**
   * TODO: Comments
   */
  public async signMessage(): Promise<any> {
    return await this.executeRpc('signmessage');
  }

  /**
   * TODO: Comments
   */
  public async signRawTransactionWithWallet(): Promise<any> {
    return await this.executeRpc('signrawtransactionwithwallet');
  }

  /**
   * TODO: Comments
   */
  public async send(): Promise<any> {
    return await this.executeRpc('send');
  }

  /**
   * @warning EXPERIMENTAL this call may be changed in future releases.
   *
   * Spend the value of all (or specific) confirmed UTXOs & unconfirmed change in the wallet to one or
   * more recipients. Unconfirmed inbound UTXOs and locked UTXOs will not be spent. Sendall will respect the
   * avoid_reuse wallet flag. If your wallet contains many small inputs, either because it received tiny payments or as
   * a result of accumulating change, consider using `send_max` to exclude inputs that are worth less than the fees
   * needed to spend them.
   *
   * @param {SendAllParams} params The parameters for the sendAll command.
   * @param {Recipients} params.recipients The recipient destination addresses.
   *    Each address may only appear once. Optionally some recipients can be specified with an
   *    amount to perform payments, but at least one address must appear without a specified amount.
   * @param {SendAllOptions} params.options Options object that can be used to pass named arguments.
   * @param {} params.options.conf_target Confirmation target in blocks. numeric, optional, default=wallet -txconfirmtarget.
   * @param estimate_mode The fee estimate mode, must be one of (case insensitive). string, optional, default="unset".
   *    See {@link FeeEstimateMode} for possible values.
   * @param fee_rate Specify a fee rate in sat/vB. numeric or string, optional, default=not set,
   *    falls back to wallet fee estimation
   * @param options: Options object that can be used to pass named arguments. json object, optional
   *
   * @returns A promise resolving to a {@link SendAllResult} object
   *
   * @example
   * Spend all UTXOs from the wallet with a fee rate of 1 sat/vB using named arguments
   * const bob = BitcoinRpc.connect({
   *    username: 'bob',
   *    password: 'bobpass',
   *    host: 'http://127.0.0.1:18443',
   *    allowDefaultWallet: true,
   *    version: '28.1.0'
   * });
   * const sendall = await bob.sendAll({
   *    recipients: [
   *      'bc1q09vm5lfy0j5reeulh4x5752q25uqqvz34hufdl',
   *      'bc1q02ad21edsxd23d32dfgqqsz4vv4nmtfzuklhy3'
   *    ],
   *     options: { fee_rate: 1.1 }
   * });
   */
  public async sendAll(params: SendAllParams): Promise<SendAllResult> {
    return await this.executeRpc('sendall', [params]);
  }

  /**
   * TODO: Comments
   */
  public async sendMany(params: SendManyParams): Promise<string> {
    return await this.executeRpc('sendmany', [params]);
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
   *
   * By default, this call only returns a transaction if it is in the mempool. If -txindex is enabled
   * and no blockhash argument is passed, it will return the transaction if it is in the mempool or any block.
   * If a blockhash argument is passed, it will return the transaction if the specified block is available and
   * the transaction is in that block.
   * @async
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
   *
   * @async
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

  clearBanned(): Promise<void> {
    throw new Error('Method not implemented.');
  }

  disconnectNode(address?: string, nodeid?: number): Promise<void> {
    throw new Error('Method not implemented.' + address + nodeid);
  }

  dumpPrivKey(address: string): Promise<string> {
    throw new Error('Method not implemented.' + address);
  }

  dumpWallet(filename: string): Promise<{ filename: string; }> {
    throw new Error('Method not implemented.' + filename);
  }

  encryptWallet(passphrase: string): Promise<void> {
    throw new Error('Method not implemented.' + passphrase);
  }

  estimateSmartFee(conf_target: number, estimate_mode?: FeeEstimateMode): Promise<{ feerate?: number; errors?: string[]; blocks?: number; }> {
    throw new Error('Method not implemented.' + conf_target + estimate_mode);
  }

  getConnectionCount(): Promise<number> {
    throw new Error('Method not implemented.');
  }

  getDifficulty(): Promise<number> {
    throw new Error('Method not implemented.');
  }

  getMempoolInfo(): Promise<MempoolInfo> {
    throw new Error('Method not implemented.');
  }

  getMiningInfo(): Promise<MiningInfo> {
    throw new Error('Method not implemented.');
  }

  getPeerInfo(): Promise<PeerInfo[]> {
    throw new Error('Method not implemented.');
  }

  walletLock(passphrase: string, timeout: number): Promise<void> {
    throw new Error('Method not implemented.' + passphrase + timeout);
  }
}
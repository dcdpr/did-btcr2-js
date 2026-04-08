import { JSONUtils } from '@did-btcr2/common';
import { BitcoinRpcError } from '../../errors.js';
import type {
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
  RawTransactionResponse,
  RawTransactionV0,
  RawTransactionV1,
  RawTransactionV2,
  RpcConfig,
  SignedRawTx,
  UnspentTxInfo,
  VerbosityLevel,
  WalletTransaction
} from '../../types.js';
import type { HttpExecutor } from '../http.js';
import type { BitcoinRpcClient } from './interface.js';
import { JsonRpcTransport } from './json-rpc.js';

// ── Typed RPC method map ────────────────────────────────────────────

/**
 * Maps Bitcoin Core JSON-RPC method names to their parameter and return types.
 * Used by `BitcoinCoreRpcClient.executeRpc` for compile-time safety.
 */
export interface RpcMethodMap {
  getbestblockhash:               { params: [];                                                       result: string };
  getblock:                       { params: [string, number?];                                        result: BlockResponse };
  getblockchaininfo:              { params: [];                                                       result: ChainInfo };
  getblockcount:                  { params: [];                                                       result: number };
  getblockhash:                   { params: [number];                                                 result: string };
  getbalance:                     { params: [];                                                       result: number };
  getnewaddress:                  { params: [string?, string?];                                       result: string };
  gettransaction:                 { params: [string, boolean?];                                       result: WalletTransaction };
  getrawtransaction:              { params: [string, number?, string?];                               result: RawTransactionResponse };
  createrawtransaction:           { params: [CreateRawTxInputs[], CreateRawTxOutputs[], number?, boolean?]; result: string };
  signrawtransactionwithwallet:   { params: [string];                                                 result: SignedRawTx };
  sendrawtransaction:             { params: [string, (number | string)?, (number | string)?];         result: string };
  listtransactions:               { params: [string?, number?, number?, boolean?];                    result: ListTransactionsResult };
  listunspent:                    { params: [number?, number?, string[]?, boolean?];                  result: UnspentTxInfo[] };
  sendtoaddress:                  { params: [string, number];                                         result: string };
  signmessage:                    { params: [string, string];                                         result: string };
  verifymessage:                  { params: [string, string, string];                                 result: boolean };
  deriveaddresses:                { params: [string, number[]?];                                      result: DerivedAddresses[] };
  generatetoaddress:              { params: [number, string];                                         result: string[] };
}

/** Method names that have typed definitions in {@link RpcMethodMap}. */
export type TypedRpcMethod = keyof RpcMethodMap;

// ── Client ──────────────────────────────────────────────────────────

/**
 * Bitcoin Core RPC client.
 * @implements {BitcoinRpcClient}
 */
export class BitcoinCoreRpcClient implements BitcoinRpcClient {
  readonly #transport: JsonRpcTransport;
  readonly #config: RpcConfig;

  constructor(config: RpcConfig, executor?: HttpExecutor) {
    this.#config = config;
    this.#transport = new JsonRpcTransport(config, executor);
  }

  get config(): RpcConfig {
    return this.#config;
  }

  get client(): JsonRpcTransport {
    return this.#transport;
  }

  /**
   * Executes a typed JSON-RPC command on the bitcoind node.
   */
  private async executeRpc<M extends TypedRpcMethod>(
    method: M,
    parameters: RpcMethodMap[M]['params'] = [] as unknown as RpcMethodMap[M]['params']
  ): Promise<RpcMethodMap[M]['result']> {
    try {
      const raw = await this.#transport.call(method, parameters as unknown[]);
      const normalized = JSONUtils.isUnprototyped(raw) ? JSONUtils.normalize(raw) : raw;
      return normalized as RpcMethodMap[M]['result'];
    } catch (err: unknown) {
      if (err instanceof BitcoinRpcError) throw err;
      const cause = err instanceof Error ? err.message : String(err);
      throw new BitcoinRpcError(
        'UNKNOWN_ERROR',
        500,
        `Unknown failure in ${method}: ${cause}`,
        { method }
      );
    }
  }

  /**
   * Returns the block data associated with a `blockhash` of a valid block.
   */
  public async getBlock({ blockhash, height, verbosity }: GetBlockParams): Promise<BlockResponse | undefined> {
    if (!blockhash && height === undefined) {
      throw new BitcoinRpcError('INVALID_PARAMS_GET_BLOCK', 400, 'blockhash or height required', { blockhash, height });
    }

    blockhash ??= await this.getBlockHash(height!);
    if (!blockhash || typeof blockhash !== 'string') {
      return undefined;
    }

    const block = await this.executeRpc('getblock', [blockhash, verbosity ?? 3]);

    switch (verbosity) {
      case 0:  return block as BlockV0;
      case 1:  return block as BlockV1;
      case 2:  return block as BlockV2;
      case 3:  return block as BlockV3;
      default: return block as BlockV3;
    }
  }

  /** Returns the blockheight of the most-work fully-validated chain. */
  public async getBlockCount(): Promise<number> {
    return await this.executeRpc('getblockcount');
  }

  /** Returns the blockhash of the block at the given height. */
  public async getBlockHash(height: number): Promise<string> {
    return await this.executeRpc('getblockhash', [height]);
  }

  /** Returns various blockchain state info. */
  public async getBlockchainInfo(): Promise<ChainInfo> {
    return await this.executeRpc('getblockchaininfo');
  }

  /** Sign inputs for raw transaction (serialized, hex-encoded). */
  public async signRawTransaction(hexstring: string): Promise<SignedRawTx> {
    return await this.executeRpc('signrawtransactionwithwallet', [hexstring]);
  }

  /** Submit a raw transaction (serialized, hex-encoded) to local node and network. */
  public async sendRawTransaction(
    hexstring: string,
    maxfeerate?: number | string,
    maxBurnAmount?: number | string
  ): Promise<string> {
    return await this.executeRpc('sendrawtransaction', [hexstring, maxfeerate ?? 0.10, maxBurnAmount ?? 0.00]);
  }

  /** Signs and sends a raw transaction. */
  public async signAndSendRawTransaction(hexstring: string): Promise<string> {
    const signedRawTx = await this.signRawTransaction(hexstring);
    if (!signedRawTx.complete) {
      throw new BitcoinRpcError(
        'SIGNING_INCOMPLETE',
        400,
        'Transaction signing incomplete',
        signedRawTx.errors
      );
    }
    return await this.sendRawTransaction(signedRawTx.hex);
  }

  /** Creates, signs, and sends a raw transaction. */
  public async createSignSendRawTransaction(inputs: CreateRawTxInputs[], outputs: CreateRawTxOutputs[]): Promise<string> {
    const rawTx = await this.createRawTransaction(inputs, outputs);
    const signedRawTx = await this.signRawTransaction(rawTx);
    if (!signedRawTx.complete) {
      throw new BitcoinRpcError(
        'SIGNING_INCOMPLETE',
        400,
        'Transaction signing incomplete',
        signedRawTx.errors
      );
    }
    return await this.sendRawTransaction(signedRawTx.hex);
  }

  /** Returns up to 'count' most recent transactions. */
  public async listTransactions(params: ListTransactionsParams): Promise<ListTransactionsResult> {
    return await this.executeRpc('listtransactions', [
      params.account ?? '*',
      params.count ?? 10,
      params.skip ?? 0,
      params.include_watchonly ?? false,
    ]);
  }

  /** Create a transaction spending the given inputs and creating new outputs. */
  public async createRawTransaction(inputs: CreateRawTxInputs[], outputs: CreateRawTxOutputs[], locktime?: number, replacable?: boolean): Promise<string> {
    return await this.executeRpc('createrawtransaction', [inputs, outputs, locktime, replacable]);
  }

  /** Derives one or more addresses corresponding to an output descriptor. */
  public async deriveAddresses(descriptor: string, range?: Array<number>): Promise<Array<DerivedAddresses>> {
    return await this.executeRpc('deriveaddresses', [descriptor, range]);
  }

  /** Mines blocks to a given address (regtest/signet only). Returns array of block hashes. */
  public async generateToAddress(nblocks: number, address: string): Promise<string[]> {
    return await this.executeRpc('generatetoaddress', [nblocks, address]);
  }

  /** Returns the total available balance. */
  public async getBalance(): Promise<number> {
    return await this.executeRpc('getbalance');
  }

  /** Returns a new Bitcoin address for receiving payments. */
  public async getNewAddress(addressType: string, label?: string): Promise<string> {
    return await this.executeRpc('getnewaddress', [label ?? '', addressType]);
  }

  /** Returns array of unspent transaction outputs. */
  public async listUnspent(params: {
    minconf?: number;
    maxconf?: number;
    address?: string[];
    include_unsafe?: boolean;
  }): Promise<UnspentTxInfo[]> {
    return await this.executeRpc('listunspent', [
      params.minconf ?? 0,
      params.maxconf ?? 9999999,
      params.address ?? [],
      params.include_unsafe ?? true,
    ]);
  }

  /** Send an amount to a given address. */
  public async sendToAddress(address: string, amount: number): Promise<RawTransactionV2> {
    const txid = await this.executeRpc('sendtoaddress', [address, amount]);
    return await this.getRawTransaction(txid) as RawTransactionV2;
  }

  /** Sign a message with the private key of an address. */
  public async signMessage(address: string, message: string): Promise<string> {
    return await this.executeRpc('signmessage', [address, message]);
  }

  /** Verify a signed message. */
  public async verifyMessage(address: string, signature: string, message: string): Promise<boolean> {
    return await this.executeRpc('verifymessage', [address, signature, message]);
  }

  /** Get detailed information about in-wallet transaction. */
  public async getTransaction(txid: string, include_watchonly?: boolean): Promise<WalletTransaction> {
    return await this.executeRpc('gettransaction', [txid, include_watchonly]);
  }

  /** Get detailed information about a transaction. */
  public async getRawTransaction(txid: string, verbosity?: VerbosityLevel, blockhash?: string): Promise<RawTransactionResponse> {
    const rawTransaction = await this.executeRpc('getrawtransaction', [txid, verbosity ?? 2, blockhash]);
    switch (verbosity) {
      case 0:  return rawTransaction as RawTransactionV0;
      case 1:  return rawTransaction as RawTransactionV1;
      case 2:  return rawTransaction as RawTransactionV2;
      default: return rawTransaction as RawTransactionV2;
    }
  }

  /** Get detailed information about multiple transactions using JSON-RPC batching. */
  public async getRawTransactions(txids: string[], verbosity?: VerbosityLevel): Promise<RawTransactionResponse[]> {
    const v = verbosity ?? 2;
    const results = await this.#transport.batch(
      txids.map(txid => ({ method: 'getrawtransaction', params: [txid, v] as unknown[] }))
    );
    return results.map(raw => {
      const normalized = JSONUtils.isUnprototyped(raw) ? JSONUtils.normalize(raw) : raw;
      switch (v) {
        case 0:  return normalized as RawTransactionV0;
        case 1:  return normalized as RawTransactionV1;
        case 2:  return normalized as RawTransactionV2;
        default: return normalized as RawTransactionV2;
      }
    });
  }
}

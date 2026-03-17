import {
  BlockResponse,
  ChainInfo,
  CreateRawTxInputs,
  CreateRawTxOutputs,
  DerivedAddresses,
  GetBlockParams,
  ListTransactionsParams,
  ListTransactionsResult,
  RawTransactionV2,
  SignedRawTx,
  UnspentTxInfo
} from '../../types.js';

/**
 * General interface for a Bitcoin Core RPC client.
 */
export interface BitcoinRpcClient {
  /** Gets detailed information about a specific block. */
  getBlock({ blockhash, height, verbosity }: GetBlockParams): Promise<BlockResponse | undefined>;

  /** Returns the number of blocks in the longest blockchain. */
  getBlockCount(): Promise<number>;

  /** Gets the hash of a block at a given height. */
  getBlockHash(height: number): Promise<string>;

  /** Retrieves general blockchain state info. */
  getBlockchainInfo(): Promise<ChainInfo>;

  /** Signs a raw transaction with the wallet's private keys. */
  signRawTransaction(hexstring: string): Promise<SignedRawTx>;

  /** Sends a raw transaction hex to the Bitcoin network. */
  sendRawTransaction(hexstring: string, maxfeerate?: number | string, maxBurnAmount?: number | string): Promise<string>;

  /** Signs and sends a raw transaction in one step. */
  signAndSendRawTransaction(hexstring: string): Promise<string>

  /** Creates, signs, and sends a raw transaction in one step. */
  createSignSendRawTransaction(inputs: CreateRawTxInputs[], outputs: CreateRawTxOutputs[]): Promise<string>;

  /** Lists transactions in the wallet. */
  listTransactions(params: ListTransactionsParams): Promise<ListTransactionsResult>;

  /** Creates a raw transaction spending specified inputs to specified outputs. */
  createRawTransaction(inputs: CreateRawTxInputs[], outputs: CreateRawTxOutputs[], locktime?: number, replacable?: boolean): Promise<string>;

  /** Derives addresses from a descriptor. */
  deriveAddresses(descriptor: string, range?: Array<number>): Promise<Array<DerivedAddresses>>;

  /** Mines a specified number of blocks to a given address. */
  generateToAddress(nblocks: number, address: string): Promise<string[]>;

  /** Gets the wallet's balance. */
  getBalance(): Promise<number>;

  /** Gets a new Bitcoin address for receiving payments. */
  getNewAddress(addressType: string, label?: string): Promise<string>;

  /** Lists unspent transaction outputs in the wallet. */
  listUnspent(params: { minconf?: number; maxconf?: number; address?: string[]; include_unsafe?: boolean; }): Promise<UnspentTxInfo[]>

  /** Creates a raw transaction spending specified inputs to specified outputs. */
  createRawTransaction(inputs: CreateRawTxInputs[], outputs: CreateRawTxOutputs[], locktime?: number, replacable?: boolean): Promise<string>;

  /** Returns the number of blocks in the longest blockchain. */
  getBlockCount(): Promise<number>;

  /** Gets the hash of a block at a given height. */
  getBlockHash(height: number): Promise<string>;

  /** Gets detailed information about a specific block. */
  getBlock({ blockhash, height, verbosity }: GetBlockParams): Promise<BlockResponse | undefined>

  /** Retrieves general blockchain state info. */
  getBlockchainInfo(): Promise<ChainInfo>;

  /** Gets a new Bitcoin address for receiving payments. */
  getNewAddress(account?: string): Promise<string>;

  /** Sends raw transaction hex to the Bitcoin network. */
  sendRawTransaction(
    hexstring: string,
    maxfeerate?: number | string,
    maxBurnAmount?: number | string
  ): Promise<string>;

  /** Sends bitcoins to a specified address. */
  sendToAddress(address: string, amount: number): Promise<RawTransactionV2>;

  /** Verifies a signed message. */
  verifyMessage(address: string, signature: string, message: string): Promise<boolean>;

  /** Sign a message with the private key of an address. */
  signMessage(address: string, message: string): Promise<string>;

  /** Mines a specified number of blocks to a given address. */
  generateToAddress(nblocks: number, address: string): Promise<string[]>;
}

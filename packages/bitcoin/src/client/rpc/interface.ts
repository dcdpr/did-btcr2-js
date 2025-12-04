import {
  BlockResponse,
  ChainInfo,
  CreateRawTxInputs,
  CreateRawTxOutputs,
  FeeEstimateMode,
  GetBlockParams,
  RawTransactionResponse
} from '../../types.js';

/**
 * General interface for a Bitcoin Core RPC client.\
 * @name BitcoinRpcClient
 * @type {BitcoinRpcClient}
 */
export interface BitcoinRpcClient {
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

    /** Verifies a signed message. */
    verifyMessage(address: string, signature: string, message: string): Promise<boolean>;

    signMessage(address: string, message: string): Promise<string>;
}

export function isBitcoinRpcClient(obj: any): obj is BitcoinRpcClient {
  return obj &&
    typeof obj.getBlockCount === 'function' &&
    typeof obj.getBlockHash === 'function' &&
    typeof obj.getBlockchainInfo === 'function';
}
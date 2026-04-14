// Core
export { BitcoinConnection, type BitcoinConnectionOptions } from './connection.js';

// Sans-I/O protocol layer
export type { HttpRequest, HttpExecutor } from './client/http.js';
export { defaultHttpExecutor } from './client/http.js';
export { EsploraProtocol } from './client/rest/protocol.js';
export { JsonRpcProtocol } from './client/rpc/protocol.js';

// Clients (convenience wrappers around the protocol layer)
export { BitcoinRestClient } from './client/rest/index.js';
export { BitcoinCoreRpcClient } from './client/rpc/index.js';
export type { RpcMethodMap, TypedRpcMethod } from './client/rpc/index.js';
export type { BitcoinRpcClient } from './client/rpc/interface.js';

// Sub-clients (for direct construction in tests or advanced use)
export { BitcoinAddress } from './client/rest/address.js';
export { BitcoinBlock } from './client/rest/block.js';
export { BitcoinTransaction } from './client/rest/transaction.js';
export { JsonRpcTransport } from './client/rpc/json-rpc.js';

// Errors
export { BitcoinRpcError, BitcoinRestError } from './errors.js';
export type { RpcErrorType } from './errors.js';

// Helpers
export { getNetwork } from './network.js';
export type { BTCNetwork } from './network.js';
export { toBase64, safeText } from './client/utils.js';

// Constants
export {
  DEFAULT_BITCOIN_NETWORK_CONFIG,
  INITIAL_BLOCK_REWARD,
  HALVING_INTERVAL,
  COINBASE_MATURITY_DELAY,
  DEFAULT_BLOCK_CONFIRMATIONS,
  TXIN_WITNESS_COINBASE,
  GENESIS_TX_ID,
} from './constants.js';

// Types
export type {
  // Network
  NetworkName,
  // REST
  RestConfig,
  EsploraBlock,
  TransactionStatus,
  Vin,
  Vout,
  ChainStats,
  MempoolStats,
  AddressInfo,
  RawTransactionRest,
  AddressUtxo,
  // RPC
  RpcConfig,
  ChainInfo,
  GetBlockParams,
  BlockResponse,
  BlockV0,
  BlockV1,
  BlockV2,
  BlockV3,
  RawTransactionResponse,
  RawTransactionV0,
  RawTransactionV1,
  RawTransactionV2,
  CreateRawTxInputs,
  CreateRawTxOutputs,
  SignedRawTx,
  UnspentTxInfo,
  WalletTransaction,
  DerivedAddresses,
  ListTransactionsParams,
  ListTransactionsResult,
  MethodNameInLowerCase,
  FeeEstimateMode,
} from './types.js';

export { VerbosityLevel } from './types.js';

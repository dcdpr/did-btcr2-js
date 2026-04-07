import type { UnixTimestamp } from '@did-btcr2/common';

/** Bitcoin network names supported by this package. */
export type NetworkName =
  | 'bitcoin'
  | 'testnet3'
  | 'testnet4'
  | 'signet'
  | 'mutinynet'
  | 'regtest';

// ── REST types ──────────────────────────────────────────────────────

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

/** Block data as returned by the Esplora REST API. */
export interface EsploraBlock {
  id: string;
  height: number;
  version: number;
  timestamp: number;
  tx_count: number;
  size: number;
  weight: number;
  merkle_root: string;
  previousblockhash: string;
  mediantime: number;
  nonce: number;
  bits: number;
  difficulty: number;
}

export interface RestConfig {
  host: string;
  headers?: Record<string, string>;
}

export interface RestApiCallParams {
  path: string;
  url?: string;
  method?: 'GET' | 'POST';
  body?: string | Record<string, unknown>;
  headers?: Record<string, string>;
}

export type RestResponse = Response;

// ── RPC types ───────────────────────────────────────────────────────

export interface RpcConfig {
  headers?: Record<string, string>;
  host?: string;
  password?: string;
  username?: string;
  wallet?: string;
  allowDefaultWallet?: boolean;
}

export type FeeEstimateMode = 'UNSET' | 'ECONOMICAL' | 'CONSERVATIVE';

export type TxIn = {
  coinbase?: string;
  txid?: string;
  vout?: number;
  scriptSig?: {
    asm: string;
    hex: string;
  };
  txinwitness?: string[];
  sequence: number;
};

export type TxInPrevout = {
  generated: boolean;
  height: number;
  value: number;
  scriptPubKey?: {
    asm: string;
    desc: string;
    hex: string;
    address?: string;
    type: string;
  };
}

export interface TxInExt extends TxIn {
  prevout: TxInPrevout;
}

export type ScriptPubKey = {
  asm: string;
  hex: string;
  reqSigs: number;
  type: string;
  address?: string;
  desc: string;
};

export type TxOut = {
  value: number;
  n: number;
  scriptPubKey: ScriptPubKey;
};

export type ChainInfo = {
  chain: string;
  blocks: number;
  headers: number;
  bestblockhash: string;
  difficulty: number;
  mediantime: number;
  verificationprogress: number;
  initialblockdownload: boolean;
  chainwork: string;
  size_on_disk: number;
  pruned: boolean;
  pruneheight: number;
  automatic_pruning: boolean;
  prune_target_size: number;
  softforks: {
    id: string;
    version: number;
    reject: {
      status: boolean;
    };
  }[];
  bip9_softforks: {
    [key: string]: {
      status: 'defined' | 'started' | 'locked_in' | 'active' | 'failed';
    };
  }[];
  warnings?: string;
};

// ── Block types ─────────────────────────────────────────────────────

export type Block = {
  hash: string;
  confirmations: number;
  height: number;
  version: number;
  versionHex: string;
  merkleroot: string;
  time: number;
  mediantime: number;
  nonce: number;
  bits: string;
  difficulty: number;
  chainwork: string;
  nTx: number;
  previousblockhash: string;
  nextblockhash?: string;
  strippedsize: number;
  size: number;
  weight: number;
};

export type BlockV0 = string;
export interface BlockV1 extends Block {
  tx: Array<string>;
}
export interface BlockV2 extends Block {
  tx: Array<RawTransactionV1>;
}
export interface BlockV3 extends Block {
  tx: Array<RawTransactionV2>;
}

export type BlockResponse = BlockV0 | BlockV1 | BlockV2 | BlockV3;

// ── Transaction types ───────────────────────────────────────────────

export type Transaction = {
  hex: string;
  txid: string;
  hash: string;
  size: number;
  vsize: number;
  weight: number;
  version: number;
  locktime: number;
};

export type RawTransactionV0 = string;
export interface RawTransactionV1 extends Transaction {
  vin: TxIn[];
  vout: TxOut[];
};
export interface RawTransactionV2 extends Transaction {
  fee?: number;
  vin: TxInExt[];
  vout: TxOut[];
};
export type RawTransactionResponse = RawTransactionV0 | RawTransactionV1 | RawTransactionV2;

export type CreateRawTxInputs = {
  txid: string;
  vout: number;
  sequence?: number;
};

export type CreateRawTxOutputs = { [address: string]: number } | { data: string };

export type SignedRawTx = {
  hex: string;
  complete: boolean;
  errors?: {
    txid: string;
    vout: number;
    scriptSig: string;
    sequence: number;
    error: string;
  }[];
};

export type UnspentTxInfo = {
  txid: string;
  vout: number;
  address: string;
  account: string;
  scriptPubKey: string;
  amount: number;
  confirmations: number;
  redeemScript: string;
  spendable: boolean;
  solvable: boolean;
  safe: boolean;
};

export type WalletTransaction = {
  amount: number;
  fee: number;
  confirmations: number;
  blockhash: string;
  blockindex: number;
  blocktime: number;
  txid: string;
  time: number;
  timereceived: number;
  'bip125-replaceable': 'yes' | 'no' | 'unknown';
  details: {
    account: string;
    address: string;
    category: 'send' | 'receive';
    amount: number;
    label?: string;
    vout: number;
    fee: number;
    abandoned: number;
  }[];
  hex: string;
};

export type DerivedAddresses = Array<string>;

export type ListTransactionsParams = {
  account?: string;
  count?: number;
  skip?: number;
  include_watchonly?: boolean
}

export type ListTransactionsResult = {
  trusted: boolean;
  otheraccount?: string;
  abandoned?: boolean;
  account: string;
  address: string;
  category: 'send' | 'receive';
  amount: number;
  vout: number;
  fee: number;
  confirmations: number;
  blockhash: string;
  blockindex: number;
  blocktime: number;
  txid: string;
  time: number;
  timereceived: number;
  walletconflicts: string[];
  'bip125-replaceable': 'yes' | 'no' | 'unknown';
  label: string;
};

/**
 * Defines verbosity levels for block and transaction outputs.
 * @enum {number}
 */
export enum VerbosityLevel {
  /** Return data in raw hex-encoded format */
  hex = 0,
  /** Return data in JSON object format */
  json = 1,
  /** Return data in JSON format with additional information */
  jsonext = 2,
  /** Return block data in JSON format with prevout information for inputs */
  jsonextprev = 3
}

export interface GetBlockParams {
  blockhash?: string;
  height?: number;
  verbosity?: VerbosityLevel
}

export type MethodNameInLowerCase =
  | 'getbestblockhash'
  | 'getblock'
  | 'getblockchaininfo'
  | 'getblockcount'
  | 'getblockhash'
  | 'getblockheader'
  | 'getchaintips'
  | 'getchaintxstats'
  | 'getdifficulty'
  | 'getmempoolancestors'
  | 'getmempooldescendants'
  | 'getmempoolentry'
  | 'getmempoolinfo'
  | 'getrawmempool'
  | 'gettxout'
  | 'gettxoutproof'
  | 'gettxoutsetinfo'
  | 'preciousblock'
  | 'pruneblockchain'
  | 'verifychain'
  | 'verifytxoutproof'
  | 'getinfo'
  | 'getmemoryinfo'
  | 'help'
  | 'stop'
  | 'uptime'
  | 'generate'
  | 'generatetoaddress'
  | 'getblocktemplate'
  | 'getmininginfo'
  | 'getnetworkhashps'
  | 'prioritisetransaction'
  | 'submitblock'
  | 'addnode'
  | 'clearbanned'
  | 'disconnectnode'
  | 'getaddednodeinfo'
  | 'getconnectioncount'
  | 'getnettotals'
  | 'getnetworkinfo'
  | 'getpeerinfo'
  | 'istbanned'
  | 'ping'
  | 'setban'
  | 'setnetworkactive'
  | 'combinerawtransaction'
  | 'createrawtransaction'
  | 'createwallet'
  | 'decoderawtransaction'
  | 'decodescript'
  | 'fundrawtransaction'
  | 'getrawtransaction'
  | 'sendrawtransaction'
  | 'signrawtransaction'
  | 'createmultisig'
  | 'estimatefee'
  | 'estimatesmartfee'
  | 'signmessagewithprivkey'
  | 'validateaddress'
  | 'verifymessage'
  | 'abandontransaction'
  | 'abortrescan'
  | 'addmultisigaddress'
  | 'addwitnessaddress'
  | 'backupwallet'
  | 'bumpfee'
  | 'dumpprivkey'
  | 'dumpwallet'
  | 'encryptwallet'
  | 'getaccount'
  | 'getaccountaddress'
  | 'getaddressesbyaccount'
  | 'getbalance'
  | 'getnewaddress'
  | 'getrawchangeaddress'
  | 'getreceivedbyaccount'
  | 'getreceivedbyaddress'
  | 'gettransaction'
  | 'getunconfirmedbalance'
  | 'getwalletinfo'
  | 'importaddress'
  | 'importmulti'
  | 'importprivkey'
  | 'importprunedfunds'
  | 'importpubkey'
  | 'importwallet'
  | 'keypoolrefill'
  | 'listaccounts'
  | 'listaddressgroupings'
  | 'listlockunspent'
  | 'listreceivedbyaccount'
  | 'listreceivedbyaddress'
  | 'listsinceblock'
  | 'listtransactions'
  | 'listunspent'
  | 'listwallets'
  | 'lockunspent'
  | 'move'
  | 'removeprunedfunds'
  | 'sendfrom'
  | 'sendmany'
  | 'sendtoaddress'
  | 'setaccount'
  | 'settxfee'
  | 'signmessage'
  | 'scanblocks'
  | 'getdescriptorinfo'
  | 'deriveaddresses'
  | 'importdescriptors'
  | 'createwalletdescriptor'
  | 'signrawtransactionwithwallet'
  | 'send'
  | 'sendall';


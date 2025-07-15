<<<<<<<< HEAD:packages/bitcoin/src/types.ts
import { Hex, UnixTimestamp } from '@did-btcr2/common';

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

export type BitcoinClientConfig = {
  rpc: {
    username: string;
    password: string;
    host: string;
    version: string;
    allowDefaultWallet: boolean;
  },
  rest: {
    host: string;
    headers?: Record<string, string>;
  }
};

export type AvailableNetworks = {
  bitcoin: true;
  testnet3: true;
  testnet4: true;
  signet: true;
  mutinynet: true;
  regtest: true;
};
========
import { Hex, UnixTimestamp } from '@did-btc1/common';
import BitcoinRpc from './index.js';
>>>>>>>> e63c2d7 (align with main):packages/method/src/bitcoin/rpc/types.ts

export type TxId = string;
<<<<<<<< HEAD:packages/bitcoin/src/types.ts
export interface BlockHashOptions extends ReturnFormatOptions {
    summary?: boolean;
}

export interface RpcClientConfig {
    headers?: Record<string, string>;
    host?: string;
    logger?: any;
    password?: string;
    timeout?: number;
    username?: string;
    version?: string;
    wallet?: string;
    allowDefaultWallet?: boolean;
}

export class BitcoinRpcClientConfig implements RpcClientConfig {
  network?: string;
  headers?: Record<string, string>;
  host?: string;
  logger?: any;
  password?: string;
  timeout?: number;
  username?: string;
  version?: string;
  wallet?: string;
  allowDefaultWallet?: boolean;

  constructor(options: RpcClientConfig = {
    headers            : {},
    host               : 'http://localhost',
    logger             : console,
    password           : '',
    timeout            : 30000,
    username           : '',
    version            : '0.21.1',
    wallet             : '',
    allowDefaultWallet : false,
  }) {
    this.headers = options.headers;
    this.host = options.host;
    this.logger = options.logger;
    this.password = options.password;
    this.timeout = options.timeout;
    this.username = options.username;
    this.version = options.version;
    this.wallet = options.wallet;
    this.allowDefaultWallet = options.allowDefaultWallet;
  }

  public static initialize(options?: RpcClientConfig): RpcClientConfig {
    return new BitcoinRpcClientConfig(options);
  }
}

export interface ClientConstructorOption {
    agentOptions?: any;
    headers?: boolean;
    host?: string;
    logger?: Function;
    network?: 'mainnet' | 'regtest' | 'testnet';
    password?: string;
    port?: string | number;
    ssl?: any;
    timeout?: number;
    username?: string;
    version?: string;
}
========
>>>>>>>> e63c2d7 (align with main):packages/method/src/bitcoin/rpc/types.ts

export type ScriptDecoded = {
    asm: string;
    hex: string;
    type: string;
    reqSigs: number;
    addresses: string[];
    ps2h?: string;
};

export type FundRawTxOptions = {
    changeAddress?: string;
    chnagePosition?: number;
    includeWatching?: boolean;
    lockUnspents?: boolean;
    feeRate?: number;
    subtractFeeFromOutputs?: number[];
    replaceable?: boolean;
    conf_target?: number;
    estimate_mode: FeeEstimateMode;
};

/**
 * unset
 *    - no mode set
 * economical
 *    - used if the transaction is replaceable
 *    - uses shorter time horizon to estimate
 *    - more responsive to short-term drops in the prevailing fee market
 *    - potentially returns a lower fee rate estimate
 * conservative
 *    - used is the transaction is not replaceable
 *    - use a longer time horizon to estimate
 *    - less responsive to short-term drops in the prevailing fee market
 *    - potentially returns a higher fee rate estimate
*/
export type FeeEstimateMode = 'UNSET' | 'ECONOMICAL' | 'CONSERVATIVE';

export type TxStats = {
    time: number;
    txcount: number;
    window_final_block_hash?: string;
    window_block_count?: number;
    window_tx_count?: number;
    window_interval?: number;
    txrate: number;
};

export type AddedNodeInfo = {
    addednode: string;
    connected: boolean;
    addresses: {
        address: string;
        connected: 'inbound' | 'outbound';
    }[];
};

export type MemoryStats = {
    locked: {
        used: number;
        free: number;
        total: number;
        locked: number;
        chunks_used: number;
        chunks_free: number;
    };
};

export type NetworkInfo = {
    version: number;
    subversion: string;
    protocolversion: number;
    localservices: string;
    localrelay: boolean;
    timeoffset: number;
    connections: number;
    networkactive: boolean;
    networks: {
        name: string;
        limited: boolean;
        reachable: boolean;
        proxy: string;
        proxy_randomize_credentials: boolean;
    }[];
    relayfee: number;
    incrementalfee: number;
    localaddresses: {
        address: string;
        port: number;
        score: number;
    }[];
    warnings?: string;
};

export type PeerInfo = {
    id: number;
    addr: string;
    addrbind: string;
    addrlocal: string;
    services: string;
    relaytxs: boolean;
    lastsend: number;
    lastrecv: number;
    bytessent: number;
    bytesrecv: number;
    conntime: number;
    timeoffset: number;
    pingtime: number;
    minping: number;
    version: number;
    subver: string;
    inbound: boolean;
    addnode: boolean;
    startinheight: number;
    banscore: number;
    synced_headers: number;
    synced_blocks: number;
    inflight: number[];
    whitelisted: boolean;
    bytessent_per_msg: {
        [key: string]: number;
    };
    byterecv_per_msg: {
        [key: string]: number;
    };
};

export type NetTotals = {
    totalbytesrecv: number;
    totalbytessent: number;
    timemlillis: number;
    uploadtarget: {
        timeframe: number;
        target: number;
        target_reached: boolean;
        save_historical_blocks: boolean;
        bytes_left_in_cycle: number;
        time_lef_in_cycle: number;
    };
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

export type ChainTip = {
    height: number;
    hash: string;
    branchlen: number;
    status: 'active' | 'valid-fork' | 'valid-headers' | 'headers-only' | 'invalid';
};

export type Outpoint = { id: string; index: number };

export type UTXO = {
    height: number;
    value: number;
    scriptPubkey: {
        asm: string;
        hex: string;
        reqSigs: number;
        type: string;
        addresses: string[];
    };
};

export type UnspentTxInfo = {
    txid: string;
    vout: number;
    address: string;
    acount: string;
    scriptPubKey: string;
    amount: number;
    confirmations: number;
    redeemScript: string;
    spendable: boolean;
    solvable: boolean;
    safe: boolean;
};

export type PrevOut = {
    txid: string;
    vout: number;
    scriptPubKey: string;
    redeemScript?: string;
    amount: number;
};

export type UTXOStats = {
    height: number;
    bestblock: string;
    transactions: number;
    txouts: number;
    bogosize: number;
    hash_serialized_2: string;
    disk_size: number;
    total_amount: number;
};

export type MempoolContent = {
    [key: string]: {
        size: number;
        fee: number;
        modifiedfee: number;
        time: number;
        height: number;
        descendantcount: number;
        descendantsize: number;
        descendantfees: number;
        ancestorcount: number;
        ancestorsize: number;
        ancestorfees: number;
        wtxid: string;
        depends: string[];
    };
};

export type DecodedRawTransaction = {
    txid: string;
    hash: string;
    size: number;
    vsize: number;
    version: number;
    locktime: number;
    vin: TxIn[];
    vout: TxOut[];
};

export interface FetchedRawTransaction extends DecodedRawTransaction {
    hex: string;
    blockhash: string;
    confirmations: number;
    time: number;
    blocktime: number;
}

export type MiningInfo = {
    blocks: number;
    currentblockweight: number;
    currentblocktx: number;
    difficulty: number;
    networkhashps: number;
    pooledtx: number;
    chain: 'main' | 'test' | 'regtest';
    warnings?: string;
};

export type MempoolInfo = {
    size: number;
    bytes: number;
    usage: number;
    maxmempol: number;
    mempoolminfee: number;
    minrelaytxfee: number;
};

export type BlockHeader = {
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
    previoutsblockchash: string;
};

/** Block and GetBlock */
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

/** Transaction and RawTransaction */
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
export type TxOut = {
    value: number;
    n: number;
    scriptPubKey: {
        asm: string;
        hex: string;
        reqSigs: number;
        type: scriptPubkeyType;
        address?: string;
        desc: string;
    };
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

export type TxOutForCreateRaw = {
    address: string;
    data: string;
};

export type TxOutInBlock = {
    bestblock: string;
    confirmations: number;
    value: number;
    scriptPubKey: {
        asm: string;
        hex: string;
        reqSigs: number;
        type: scriptPubkeyType;
        addresses: string[];
    };
    coinbase: boolean;
};

export type DecodedScript = {
    asm: string;
    hex: string;
    type: string;
    reqSigs: number;
    addresses: string[];
    p2sh: string;
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

export type WalletInfo = {
    walletname: string;
    walletversion: number;
    balance: number;
    unconfirmed_balance: number;
    immature_balance: number;
    txcount: number;
    keypoololdest: number;
    keypoolsize: number;
    paytxfee: number;
    hdmasterkeyid: string;
};

export type scriptPubkeyType = string;

export type SigHashType =
    | 'ALL'
    | 'NONE'
    | 'SINGLE'
    | 'ALL|ANYONECANPAY'
    | 'NONE|ANYONECANPAY'
    | 'SINGLE|ANYONECANPAY';

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

export type ValidateAddressResult = {
    isvalid: boolean;
    address?: string;
    scriptPubKey?: string;
    ismine?: boolean;
    iswatchonly?: boolean;
    isscript?: boolean;
    script?: string;
    hex?: string;
    addresses?: string[];
    sigsrequired?: number;
    pubkey?: string;
    iscompressed?: boolean;
    account?: string;
    timestamp?: number;
    hdkeypath?: string;
    hdmasterkeyid?: string;
};

export type ImportMultiRequest = {
    scriptPubKey: string | { address: string };
    timestamp: number | 'now';
    redeemScript?: string;
    pubkeys?: string[];
    keys?: string[];
    internal?: boolean;
    watchonly?: boolean;
    label?: string;
};

export type ImportMultiResult = {
    success: boolean;
    error?: {
        code: string;
        message: string;
    };
};

export type ImportMultiOptions = { rescan?: boolean; };

export type ImportDescriptorRequest = {
    /** (string, required) Descriptor to import. */
    desc: string;
    /**
     * (integer / string, required) Time from which to start rescanning the blockchain for this descriptor, in UNIX epoch time
     * Use the string "now" to substitute the current synced blockchain time.
     * "now" can be specified to bypass scanning, for outputs which are known to never have been used, and
     * 0 can be specified to scan the entire blockchain. Blocks up to 2 hours before the earliest timestamp
     * of all descriptors being imported will be scanned as well as the mempool.
     */
    timestamp: number | string;
    /** (boolean, optional, default=false) Make descriptor "active" for corresponding output type/externality */
    active?: boolean;
    /** (numeric or array, optional) If a ranged descriptor is used, this specifies the end or the range (in the form [begin,end]) to import */
    range?: number | Array<number>;
    /** (numeric, optional) If a ranged descriptor is set to active, this specifies the next index to generate addresses from */
    next_index?: number;
    /** (boolean, optional, default=false) Whether matching outputs should be treated as not incoming payments (e.g. change) */
    internal?: boolean;
    /** (string, optional, default="") Label to assign to the address, only allowed with internal=false. Disabled for ranged descriptors */
    label?: string;
};

export type JsonRPCError = {
    code: number;
    message: string;
};

export type ImportDescriptorResult = {
    success: boolean;
    warnings?: string;
    error: JsonRPCError;
};

export type Received = {
    involvesWatchonly?: boolean;
    account: string;
    amount: number;
    confirmations: number;
    label: string;
};

export type ListUnspentOptions = {
    minimumAmount: number | string;
    maximumAmount: number | string;
    maximumCount: number | string;
    minimumSumAmount: number | string;
};

export type ReceivedByAccount = Received;

export type ReceivedByAddress = {
    address: string;
    txids: string[];
} & Received;

export type RestExtension = 'json' | 'bin' | 'hex';

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
    | 'sendmany'
    | 'sendall';

export type BatchOption = {
    method: MethodNameInLowerCase;
    parameters?: Array<any>;
};

export type ReturnType<T> = T extends (...args: any[]) => infer R ? R : any;

export type BumpFeeOption = {
    confTarget?: number;
    totalFee?: number;
    replaceable?: boolean;
    estimate_mode?: FeeEstimateMode;
};


export type WalletTxBase = {
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
    abandoned?: boolean;
    comment?: string;
    label: string;
    to?: string;
};

export type TransactionInListSinceBlock = WalletTxBase;

export type ListSinceBlockResult = {
    transactions: TransactionInListSinceBlock[];
    removed?: TransactionInListSinceBlock[];
    lastblock: string;
};

export type ListTransactionsResult = {
    trusted: boolean;
    otheraccount?: string;
    abandoned?: boolean;
} & WalletTxBase;

export type AddressGrouping = [string, number] | [string, number, string];

export type RawOutputAddr = { [address: string]: number; };
export type RawOutputData = { data: string; };
export type CreateRawTxOutputs = RawOutputAddr | RawOutputData;

export type GetUTXOsResult = {
    chainHeight: number;
    chaintipHash: string;
    bipmap: string;
    utxos: UTXO[];

}

export type BumpFeeOptions = {
    confTarget?: number;
    totalFee?: number;
    replaceable?: boolean;
    estimate_mode?: FeeEstimateMode;

}

export type BumpFeeResult = {
    txid: string;
    origfee: number;
    fee: number;
    error?: string[];
}

export type AddMultiSigAddressParams = {
    nrequired: number,
    keys: string[],
    account?: string,
}
export type SignRawTxParams = {
    hexstring: string,
    prevtxs?: PrevOut[],
    privkeys?: string[],
    sighashtype?: SigHashType
}

export type BitcoinSignature = { signature: string }

export type CreateMultiSigResult = { address: string; redeemScript: string }

export type CreateRawTxParams = {
    inputs: CreateRawTxInputs[];
    outputs: CreateRawTxOutputs[];
    locktime?: number;
    replacable?: boolean
}

export type CreateWalletParams = {
    wallet_name: string;
    disable_private_keys?: boolean;
    blank?: boolean;
    passphrase?: string;
    avoid_reuse?: boolean;
    descriptors?: boolean;
    load_on_startup?: boolean
}

export type CreateWalletResult = {
    name: string;
    warning: string;
}

export type ScanBlocksParams = {
    action: 'start' | 'abort' | 'status';
    start_height?: number;
    stop_height?: number;
    filtertype?: string;
    options?: { filter_false_positives: boolean }
}

export type ListTransactionsParams = {
    account?: string;
    count?: number;
    skip?: number;
    include_watchonly?: boolean
}

export type FundRawTxResult = { hex: string; fee: number; changepos: number; }
<<<<<<<< HEAD:packages/bitcoin/src/types.ts
export type DerivedAddresses = Array<string>;
========

export type DerivedAddresses = Array<string>;

>>>>>>>> e63c2d7 (align with main):packages/method/src/bitcoin/rpc/types.ts
export type CreateWalletDescriptorOptions = { internal: boolean; hdkey: string }
export type WalletDescriptor = string;
export type CreateWalletDescriptorsResult = { descs: Array<WalletDescriptor>; }

export type SendManyParams = {
    fromaccount: string;
    amounts: { address: string; };
    minconf?: number;
    comment?: string;
    subtractfeefrom?: string[];
    replaeable?: boolean;
    conf_target?: number;
    estimate_mode?: FeeEstimateMode
}

export type ListUnspentParams = {
    minconf?: number;
    maxconf?: number;
    address?: string[];
    include_unsafe?: boolean;
    query_options?: ListUnspentOptions;
}

export type BitcoinRecipient = string | Record<string, number | string>;
export type Input = {
    txid: string;
    vout: number;
    sequence?: number;
}
export type SolvingData = {
    pubkeys: string[];
    scripts: string[];
    descriptors: string[];
}
export type Recipients = Array<BitcoinRecipient>;
export type SendAllOptions = {
    add_to_wallet?: boolean;
    fee_rate?: number | string;
    include_watching?: boolean;
    inputs?: Input[];
    locktime?: number;
    lock_unspents?: boolean;
    psbt?: boolean;
    send_max?: boolean;
    minconf?: number;
    maxconf?: number;
    conf_target?: number
    estimate_mode?: FeeEstimateMode;
    replaceable?: boolean;
    solving_data?: SolvingData
}
export type SendAllParams = {
    recipients: Recipients;
    options?: SendAllOptions;
}
export type SendAllResult = {
    txid: Hex;
    hex: Hex;
    psbt: string;
    complete: boolean;
}
export type SendToAddressResult = {
    txid: string;
    fee_reason?: string;
  }
export type CreateMultisigParams = {
    nrequired: number;
    keys: string[];
    address_type?: string;
}
export type CreateMultisigResult = {
    address: string;
    redeemScript: Hex;
    descriptor: string;
    warnings?: string[]
}


/**
 * Defines verbosity levels for block and transaction outputs.
 * Used to specify the format of returned block or transaction data.
 * @enum {number} VerbosityLevel for block and transaction outputs.
 */
export enum VerbosityLevel {
    /** Return block or transaction data in raw hex-encoded format */
    hex = 0,
    /** Return block or transaction data in JSON object format */
    json = 1,
    /**
     * Return block or transaction data in JSON object format with additional information.
     * Returns block data with information about each transaction.
     * Returns transaction data with information about the transaction including fee and prevout information.
     */
    jsonext = 2,
    /**
     * Return block data in JSON object format with additional information.
     * Returns block data with information about each transaction, including prevout information for inputs.
     */
    jsonextprev = 3
}

export type BlockHeight = number;

export interface GetBlockParams {
    blockhash?: string;
    height?: number;
    verbosity?: VerbosityLevel
}
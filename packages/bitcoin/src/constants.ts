export const INITIAL_BLOCK_REWARD = 50;
export const HALVING_INTERVAL = 150;
export const COINBASE_MATURITY_DELAY = 100;
export const DEFAULT_BLOCK_CONFIRMATIONS = 7;
export const TXIN_WITNESS_COINBASE = '0000000000000000000000000000000000000000000000000000000000000000';
export const GENESIS_TX_ID = '4a5e1e4baab89f3a32518a88c31bc87f618f76673e2cc77ab2127b7afdeda33b';
export const DEFAULT_BITCOIN_NETWORK_CONFIG = {
  bitcoin : {
    rpc  : undefined,
    rest : { host: 'https://mempool.space/api' }
  },
  testnet3 : {
    rpc  : undefined,
    rest : { host: 'https://mempool.space/testnet/api' }
  },
  testnet4 : {
    rpc  : undefined,
    rest : { host: 'https://mempool.space/testnet4/api' }
  },
  signet  : {
    rpc  : undefined,
    rest : { host: 'https://mempool.space/signet/api' }
  },
  mutinynet : {
    rpc  : undefined,
    rest : { host: 'https://mutinynet.com/api' }
  },
  regtest : {
    rpc  : {
      network            : 'regtest',
      host               : 'http://localhost:18443',
      port               : 18443,
      username           : 'polaruser',
      password           : 'polarpass',
      allowDefaultWallet : true,
      version            : '28.1.0',
    },
    rest : { host: 'http://localhost:3000' }
  },
} as const;

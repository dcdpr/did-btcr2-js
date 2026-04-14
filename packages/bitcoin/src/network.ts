import { NETWORK, TEST_NETWORK } from '@scure/btc-signer';
import type { BTC_NETWORK } from '@scure/btc-signer/utils';

/**
 * Bitcoin network parameters: bech32 HRP, address version bytes, WIF prefix.
 * Mirrors @scure/btc-signer's `BTC_NETWORK` type.
 */
export type BTCNetwork = BTC_NETWORK;

/** Regtest network params (bcrt HRP). */
const REGTEST_NETWORK: BTCNetwork = {
  bech32     : 'bcrt',
  pubKeyHash : 0x6f,
  scriptHash : 0xc4,
  wif        : 0xef,
};

/**
 * Resolve a named Bitcoin network to its @scure/btc-signer `BTC_NETWORK` params.
 * Mainnet maps to `NETWORK`; testnet3/testnet4/signet/mutinynet all share `TEST_NETWORK`
 * (identical address formats); regtest uses its own `bcrt` HRP.
 */
export function getNetwork(network: string): BTCNetwork {
  switch (network) {
    case 'bitcoin':
      return NETWORK;
    case 'testnet3':
    case 'testnet4':
    case 'signet':
    case 'mutinynet':
      return TEST_NETWORK;
    case 'regtest':
      return REGTEST_NETWORK;
    default:
      throw new Error(`Unknown network "${network}"`);
  }
}

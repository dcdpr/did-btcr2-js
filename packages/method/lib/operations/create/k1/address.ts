import { getNetwork } from '@did-btcr2/bitcoin';
import { hexToBytes } from '@noble/hashes/utils';
import { p2pkh } from '@scure/btc-signer';

const { address } = p2pkh(
  hexToBytes('0258f76c4f85af5dbc5f101884f3c0396121bed27eaf8beaef8d08782ee0e3ee9f'),
  getNetwork('regtest'),
);
if(!address) throw new Error('Failed to generate address');
console.log('Address:', address);

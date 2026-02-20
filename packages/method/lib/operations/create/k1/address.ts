import { payments } from 'bitcoinjs-lib';
import { regtest } from 'bitcoinjs-lib/src/networks';

const { address } = payments.p2pkh({ pubkey: Buffer.from('0258f76c4f85af5dbc5f101884f3c0396121bed27eaf8beaef8d08782ee0e3ee9f', 'hex'), network: regtest });
if(!address) throw new Error('Failed to generate address');
console.log('Address:', address);
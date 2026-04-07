import { BitcoinConnection } from '../src/bitcoin.js';
import type { BlockV3 } from '../src/types.js';

const bitcoin = BitcoinConnection.forNetwork('regtest');
const height = await bitcoin.rpc!.getBlockCount();
const block = await bitcoin.rpc!.getBlock({ height }) as BlockV3;
console.log(`block #${height}`, block);

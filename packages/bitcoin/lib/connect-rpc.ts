import { Bitcoin } from '../../src/bitcoin/index.js';
import { BlockV3 } from '../../method/src/index.js';

const bitcoin = new Bitcoin();
const height = await bitcoin.active.rpc.getBlockCount();
const block = await bitcoin.active.rpc.getBlock({ height }) as BlockV3;
console.log(`block #${height}`, block);

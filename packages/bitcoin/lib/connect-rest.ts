import { Bitcoin } from '../../src/bitcoin/index.js';
import { BlockV3 } from '../../method/src/index.js';

const bitcoin = new Bitcoin();
const height = await bitcoin.active.rest.getBlockCount();
const block = await bitcoin.active.rest.getBlock({ height }) as BlockV3;
console.log(`block #${height}`, block);

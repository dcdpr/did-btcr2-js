import BitcoinRpc from '../../src/bitcoin/rpc-client.js';
import { BlockV3 } from '../../method/src/index.js';

const rpc = BitcoinRpc.connect();
let height = 0;

const block = await rpc.getBlock({ height }) as BlockV3;
console.log(`block #${height}`, block);

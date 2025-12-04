import { BitcoinNetworkConnection } from "../src/bitcoin.js";
import { BlockV3 } from "../src/types.js";


const bitcoin = new BitcoinNetworkConnection({ });
const height = await bitcoin.network.rpc!.getBlockCount();
const block = await bitcoin.network.rpc!.getBlock({ height }) as BlockV3;
console.log(`block #${height}`, block);

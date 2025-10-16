import BitcoinRpc from '../../src/bitcoin/rpc-client.js';
import { BlockV3, DEFAULT_RPC_CLIENT_CONFIG } from '../../method/src/index.js';

const rpc = BitcoinRpc.connect(DEFAULT_RPC_CLIENT_CONFIG);
const block = await rpc.getBlock({ height: 0 }) as BlockV3;
console.log('block', block);
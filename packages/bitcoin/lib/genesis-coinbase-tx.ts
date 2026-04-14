import { BitcoinCoreRpcClient } from '../src/client/rpc/index.js';

const rpc = new BitcoinCoreRpcClient({
  host     : 'http://localhost:18443',
  username : 'polaruser',
  password : 'polarpass',
});
const genesis = await rpc.getBlock({ height: 0, verbosity: 2 });
console.log('genesis', genesis);
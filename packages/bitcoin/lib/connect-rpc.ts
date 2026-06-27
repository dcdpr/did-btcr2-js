import { BitcoinConnection } from '../src/connection.js';

const bitcoin = new BitcoinConnection({
  network : 'regtest',
  rest    : { host: 'http://localhost:3000' },
  rpc     : { host: 'http://localhost:18443', username: 'polaruser', password: 'polarpass' },
});
console.log('Bitcoin RPC connection:', bitcoin);

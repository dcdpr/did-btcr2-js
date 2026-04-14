import { BitcoinConnection } from '../src/connection.js';

const bitcoin = BitcoinConnection.forNetwork('regtest', { rpc: { host: 'http://localhost:18443', username: 'polaruser', password: 'polarpass' } });
console.log('Bitcoin RPC connection:', bitcoin);

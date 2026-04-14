import { BitcoinConnection } from '../src/connection.js';

const bitcoin = BitcoinConnection.forNetwork('bitcoin', { rest: { host: 'https://mempool.space/api'} });
console.log('Bitcoin REST connection:', bitcoin);

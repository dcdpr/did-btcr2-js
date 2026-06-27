import { BitcoinConnection } from '../src/connection.js';

const bitcoin = new BitcoinConnection({ network: 'bitcoin', rest: { host: 'https://mempool.space/api' } });
console.log('Bitcoin REST connection:', bitcoin);

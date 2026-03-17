import { hex } from '@scure/base';
import { DidBtcr2 } from '../../../../src/did-btcr2.js';

const genesisBytes = hex.decode('03620d4fb8d5c40b0dc2f9fd84636d85487e51ecf55fbcd5ccf08c6ac148bc8a36');
const did = DidBtcr2.create(genesisBytes, { idType: 'KEY', network: 'bitcoin' });
console.log('did:', did);
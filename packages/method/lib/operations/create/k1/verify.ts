import input from '../../../data/regtest/k1/qgpr45ch/create/input.json' with { type: 'json' };
import output from '../../../data/regtest/k1/qgpr45ch/create/output.json' with { type: 'json' };
import { DidBtcr2 } from '../../../../src/did-btcr2.js';

const genesisBytes = Buffer.from(input.genesisBytes, 'hex');
const did = await DidBtcr2.create(genesisBytes, {
  idType  : 'KEY',
  version : input.version,
  network : input.network,
});
console.log('Result:', did);
console.log('Expected:', output.did);
if(did !== output.did) throw new Error('DID does not match expected output');
import { DidBtcr2 } from '@did-btcr2/method';
import inputs from '../../../data/regtest/x1/q2pgxznc/create/input.json' with { type: 'json' };
import output from '../../../data/regtest/x1/q2pgxznc/create/output.json' with { type: 'json' };

const genesisBytes = Buffer.from(inputs.genesisBytes, 'hex');
const did = DidBtcr2.create(genesisBytes, {
  idType  : 'EXTERNAL',
  version : inputs.version,
  network : inputs.network
});
console.log('Result   =', did);
console.log('Expected =', output.did);
if(did !== output.did) throw new Error('DID does not match expected output');
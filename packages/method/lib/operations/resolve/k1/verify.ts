import { JSONUtils } from '@did-btcr2/common';
import input from '../../../data/regtest/k1/qgpu5pt4/resolve/input.json' with { type: 'json' };
import output from '../../../data/regtest/k1/qgpu5pt4/resolve/output.json' with { type: 'json' };
import { DidBtcr2 } from '../../../../src/did-btcr2.js';

const did = input.did;
const sidecar = input.sidecar as any;

const resolution = await DidBtcr2.resolve(did, { sidecar });

const normlizedResolution = JSON.stringify(resolution, null, 2);
const normlizedOutput = JSON.stringify(output, null, 2);

console.log('Expected:', normlizedOutput);
console.log('Actual:', normlizedResolution);
if(!JSONUtils.deepEqual(normlizedResolution, normlizedOutput)) {
  throw new Error('Resolution does not match expected output');
}
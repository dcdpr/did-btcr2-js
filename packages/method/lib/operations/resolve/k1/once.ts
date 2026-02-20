import { DidBtcr2 } from '../../../../src/did-btcr2.js';
import { ResolutionOptions } from '../../../../src/index.js';
import input from '../../../data/regtest/k1/qgpzvae5/resolve/input.json' with { type: 'json' };

const did = input.did;
const resolutionOptions = input.resolutionOptions as ResolutionOptions;
const resolution = await DidBtcr2.resolve(did, resolutionOptions);

console.log(JSON.stringify(resolution, null, 2));
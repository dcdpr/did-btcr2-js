import { DidBtcr2, ResolutionOptions } from '../../../../src/index.js';
import input from '../../../data/regtest/x1/qfk62y9t/resolve/input.json' with { type: 'json' };

const did = input.did;
const resolutionOptions = input.resolutionOptions as ResolutionOptions;

const resolution = await DidBtcr2.resolve(did, resolutionOptions);

console.log(JSON.stringify(resolution, null, 2));
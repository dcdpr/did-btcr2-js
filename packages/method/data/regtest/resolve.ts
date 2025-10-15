import { writeFile } from 'fs/promises';
import { DidBtcr2 } from '../../src/did-btcr2.js';

const resolutionResult = await DidBtcr2.resolve('', {});
console.log('resolutionResult', JSON.stringify(resolutionResult, null, 2));
await writeFile('./data/regtest/resolution-result.json', JSON.stringify(resolutionResult, null, 2), 'utf-8');
import { JSONUtils } from '../src/index.js';

const mapC = new Map([[1, 0], [3, 1]]);
const mapD = new Map([[2, 1], [1, 0]]);

const equal = JSONUtils.deepEqual(mapC, mapD);
console.log('Maps equal:', equal);

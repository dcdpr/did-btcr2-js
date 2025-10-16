import { DidBtcr2 } from '../../src/index.js';
import path from 'path';
import { readdir, readFile } from 'fs/promises';

const cwd = process.cwd();
const network = process.argv.slice(2)[0] || 'regtest';
const latestdir = `${cwd}/data/${network}/latest`;
const blockdir = (await readdir(latestdir)).find(dir => dir.startsWith('block'));
console.log('cwd:', cwd);
console.log('network:', network);
console.log('latestdir:', latestdir);
console.log('blockdir:', blockdir);
if(!blockdir) {
  throw new Error(`No block directory found in ${latestdir}`);
}
const initialDocument = JSON.parse(await readFile(path.join(latestdir, 'initialDocument.json'), 'utf-8'));
const resolutionOptions = JSON.parse(await readFile(path.join(latestdir, blockdir, 'resolutionOptions.json'), 'utf-8'));
const identifier = initialDocument.id;
const resolution = await DidBtcr2.resolve(identifier, resolutionOptions);
console.log('resolution:', resolution);
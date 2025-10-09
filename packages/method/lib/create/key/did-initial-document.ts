import { readFile, writeFile } from 'fs/promises';
import { DidBtcr2 } from '../../../src/did-btcr2.js';
import { SchnorrKeyPair } from '@did-btcr2/keypair';

const cwd = process.cwd();
const network = process.argv.slice(2)[0] || 'regtest';
console.log('Running for network:', network);

const latestdir = `${cwd}/data/${network}/latest`;
const keys = JSON.parse(await readFile(`${latestdir}/keys.json`, { encoding: 'utf-8' }));

const secretKey = Buffer.from(keys.genesisKey.sk, 'hex');
const keyPair = new SchnorrKeyPair({ secretKey });
const { did, initialDocument } = await DidBtcr2.create({
  idType      : 'KEY',
  pubKeyBytes : keyPair.publicKey.compressed,
  options     : { network, version: 1 }
});
await writeFile(`${latestdir}/did.txt`, did, { encoding: 'utf-8' });
console.log(`Created new did: ${latestdir}/did.txt`);

await writeFile(`${latestdir}/initialDocument.json`, JSON.stringify(initialDocument, null, 4), { encoding: 'utf-8' });
console.log(`Created new initial document: ${latestdir}/initialDocument.json`);
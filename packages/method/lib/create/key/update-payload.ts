import { readFile, writeFile } from 'fs/promises';
import path from 'path';
import { BeaconUtils, DidDocument, Btc1Update, getNetwork } from '../../../src/index.js';

const args = process.argv.slice(2);
const cwd = process.cwd();
const network = args[0] || 'regtest';

console.log('Running for network:', network);

const latestdir = `${cwd}/data/${network}/latest`;
const initialDocument = JSON.parse(await readFile(path.join(latestdir, 'initialDocument.json'), { encoding: 'utf-8' }));
const keys = JSON.parse(await readFile(path.join(latestdir, 'keys.json'), { encoding: 'utf-8' }));

const identifier = initialDocument.id;
const sourceDocument = new DidDocument(initialDocument);
const sourceVersionId = 1;
const patch = args[1] && JSON.parsable(args[1])
  ? JSON.parse(args[1])
  : JSON.patch.create([
    {
      op    : 'replace',
      path  : '/service/0',
      value : BeaconUtils.generateBeaconService({
        id          : identifier,
        publicKey   : Buffer.from(keys.replacementKey.pk, 'hex'),
        network     : getNetwork(network),
        addressType : 'p2pkh',
        type        : 'SingletonBeacon',
      })
    }
  ]);
const didUpdatePayload = [await Btc1Update.construct({ identifier, sourceDocument, sourceVersionId, patch })];

const didUpdatePayloadPath = path.join(latestdir, 'updates.json');
await writeFile(didUpdatePayloadPath, JSON.stringify(didUpdatePayload, null, 4), { encoding: 'utf-8' });
console.log(`Created did update payload: ${didUpdatePayloadPath}`, didUpdatePayload);
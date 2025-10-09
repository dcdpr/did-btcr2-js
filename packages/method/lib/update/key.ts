import { SchnorrKeyPair } from '@did-btcr2/keypair';
import { mkdir, readFile, writeFile } from 'fs/promises';
import { BeaconUtils, DidDocument, KeyManager, DidBtc1, getNetwork } from '../../src/index.js';
import { Did } from '@web5/dids';
import bitcoin from '../../../src/bitcoin/index.js';
import { RawTransactionRest } from '../../../src/bitcoin/rest-client.js';

const cwd = process.cwd();
const network = process.argv.slice(2)[0] || 'regtest';
const idType = process.argv[3] || 'key';
console.log('Running for network:', network);

const latestdir = `${cwd}/data/${network}/${idType}/latest`;
const initialDocument = JSON.parse(await readFile(`${latestdir}/initialDocument.json`, { encoding: 'utf-8' }));
const keys = JSON.parse(await readFile(`${latestdir}/keys.json`, { encoding: 'utf-8' }));
const genesisKey = keys.genesisKey;
const genesisKeyPair = new SchnorrKeyPair({
  secretKey : Buffer.from(genesisKey.sk, 'hex'),
  publicKey  : Buffer.from(genesisKey.pk, 'hex')
});

const parts = Did.parse(initialDocument.id);
if (!parts) {
  throw new Error('Failed to parse DID');
}
const replacementKey = keys[parts.id];
const replacementKeyPair = new SchnorrKeyPair({
  secretKey : Buffer.from(replacementKey.sk, 'hex'),
  publicKey  : Buffer.from(replacementKey.pk, 'hex')
});

const identifier = initialDocument.id;
const sourceDocument = new DidDocument(initialDocument);
const sourceVersionId = 1;
const patch = JSON.patch.create([
  {
    op    : 'replace',
    path  : '/service/0',
    value : BeaconUtils.generateBeaconService({
      id          : identifier,
      publicKey   : replacementKeyPair.publicKey.compressed,
      network     : getNetwork(network),
      addressType : 'p2pkh',
      type        : 'SingletonBeacon',
    })
  }
]);

const keyUri = KeyManager.computeKeyUri(parts.id, parts.fragment ?? '')
await KeyManager.initialize(genesisKeyPair, keyUri);

const verificationMethodId = initialDocument.verificationMethod[0].id;
const beaconIds = [initialDocument.service[0].id];
const signalsMetadata = await DidBtcr2.update({
  identifier,
  sourceDocument,
  sourceVersionId,
  patch,
  verificationMethodId,
  beaconIds,
});

for (const [txId, updates] of Object.entries(signalsMetadata)) {
  let tx = await bitcoin.rest.transaction.get(txId) as RawTransactionRest;
  let blockDir: string = `${latestdir}/block`;
  let blockHeight: number | undefined = tx.status.block_height;
  do {
    tx = await bitcoin.rest.transaction.get(txId) as RawTransactionRest;
    blockHeight = tx.status.block_height;
    if(!blockHeight) {
      console.log(`Transaction ${txId} not confirmed yet, waiting...`);
      await new Promise(resolve => setTimeout(resolve, 10000)); // Wait for 10 seconds before checking again
      continue;
    }
    blockDir = `${blockDir}${blockHeight}`;
  } while(!tx.status.confirmed);

  await mkdir(blockDir, { recursive: true });

  await writeFile(`${blockDir}/updates.json`, JSON.stringify(updates, null, 4), { encoding: 'utf-8' });

  await writeFile(`${blockDir}/signalsMetadata.json`, JSON.stringify(signalsMetadata, null, 4), { encoding: 'utf-8' });
  console.log(`Created new signalsMetadata: ${latestdir}/signalsMetadata.json`, patch);

  const targetDocument = JSON.patch.apply(sourceDocument, patch);
  await writeFile(`${blockDir}/targetDocument.json`, JSON.stringify(targetDocument, null, 4), { encoding: 'utf-8' });
  console.log(`Created new targetDocument: ${latestdir}/targetDocument.json`, targetDocument);

  const resolutionOptions = { versionTime: Date.now(), sidecarData: { did: identifier, signalsMetadata } };
  await writeFile(`${blockDir}/resolutionOptions.json`, JSON.stringify(resolutionOptions, null, 4), { encoding: 'utf-8' });
  console.log(`Created new resolutionOptions: ${latestdir}/resolutionOptions.json`, resolutionOptions);
}
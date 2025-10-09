import { SchnorrKeyPair } from '@did-btcr2/keypair';
import { mkdir, readFile, writeFile } from 'fs/promises';
import bitcoin from '../../../src/bitcoin/index.js';
import { RawTransactionRest } from '../../../src/bitcoin/rest-client.js';
import { BeaconUtils, DidDocument, KeyManager, DidBtc1, getNetwork } from '../../src/index.js';
import { ID_PLACEHOLDER_VALUE } from '@did-btcr2/common';

const cwd = process.cwd();
const network = process.argv.slice(2)[0] || 'regtest';
const idType = 'external';
console.log('Running for network:', network);
const latestdir = `${cwd}/data/${network}/${idType}/latest`;

const initialDocument = JSON.parse(await readFile(`${latestdir}/initialDocument.json`, { encoding: 'utf-8' }));
const identifier = initialDocument.id;
const sourceDocument = new DidDocument(initialDocument);

const keyPairMap = new Map(Object.entries(JSON.parse(await readFile(`${latestdir}/keys.json`, { encoding: 'utf-8' }))));

const keyId = `${identifier}#key-0`;
const key = keyPairMap.get(keyId) as { sk: string, pk: string };
const keys = new SchnorrKeyPair({ privateKey: Buffer.fromHex(key.sk) });

const kms = await KeyManager.initialize(keyPair, keyId);

const serviceId = `${initialDocument.id}#service-0`;
const serviceKey = keyPairMap.get(serviceId) as { sk: string, pk: string };
const serviceKeyPair = new SchnorrKeyPair({ privateKey: Buffer.fromHex(serviceKey.sk) });

await kms.importKey(serviceKeyPair, serviceId);

const serviceId1 = `${initialDocument.id}#service-1`;
const serviceKey1 = keyPairMap.get(serviceId1) as { sk: string, pk: string };
const serviceKeyPair1 = new SchnorrKeyPair({ privateKey: Buffer.fromHex(serviceKey1.sk) });

await kms.importKey(serviceKeyPair1, serviceId1);

const patch = JSON.patch.create([
  {
    op    : 'add',
    path  : '/service/1',
    value : BeaconUtils.generateBeaconService({
      id          : `${identifier}#service-1`,
      publicKey   : serviceKeyPair1.publicKey.bytes,
      network     : getNetwork(network),
      addressType : 'p2wpkh',
      type        : 'SingletonBeacon',
    })
  }
]);

const sourceVersionId = 1;
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
  await writeFile(`${latestdir}/resolutionOptions.json`, JSON.stringify(resolutionOptions, null, 4), { encoding: 'utf-8' });
  console.log(`Created new resolutionOptions: ${latestdir}/resolutionOptions.json`, resolutionOptions);
}
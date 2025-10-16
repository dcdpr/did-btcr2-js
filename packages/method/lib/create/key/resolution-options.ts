import { SchnorrKeyPair } from '@did-btcr2/keypair';
import { mkdir, readFile, writeFile } from 'fs/promises';
import path from 'path';
import bitcoin from '../../../../src/bitcoin/index.js';
import { RawTransactionRest } from '../../../../src/bitcoin/rest-client.js';
import { DidDocument, KeyManager, Btc1Update, DidBtc1 } from '../../../src/index.js';

const cwd = process.cwd();
const network = process.argv.slice(2)[0] || 'regtest';
console.log('Running for network:', network);

const latestdir = `${cwd}/data/${network}/latest`;
const initialDocument = JSON.parse(await readFile(path.join(latestdir, 'initialDocument.json'), { encoding: 'utf-8' }));
const keys = JSON.parse(await readFile(path.join(latestdir, 'keys.json'), { encoding: 'utf-8' }));
const didUpdatePayload = JSON.parse(await readFile(path.join(latestdir, 'updates.json'), { encoding: 'utf-8' }));

const sourceDocument = new DidDocument(initialDocument);
const verificationMethodId = initialDocument.verificationMethod[0].id;
const verificationMethod = DidBtcr2.getSigningMethod({ didDocument: sourceDocument, methodId: verificationMethodId, });

const identifier = verificationMethodId;
// const [controller, fragment] = identifier.split('#');
// console.log('id:', id);
// console.log('controller:', controller);

const secretKey = Buffer.from(keys.genesisKey.sk, 'hex');
// const keyUri = KeyManager.computeKeyUri(id, controller);
const keyPair = new SchnorrKeyPair({ secretKey });
const kms = await KeyManager.initialize(keyPair, identifier);
console.log('kms:', kms);

const didUpdateInvocation = await Btc1Update.invoke({ identifier, verificationMethod, didUpdatePayload, });

const beaconId = initialDocument.service[0].id;
await kms.importKey(keyPair, beaconId)
const signalsMetadata = await Btc1Update.announce({ sourceDocument, beaconIds: [beaconId], didUpdateInvocation });

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
  console.log(`Created updates.json: ${latestdir}/updates.json`);

  await writeFile(`${blockDir}/signalsMetadata.json`, JSON.stringify(signalsMetadata, null, 4), { encoding: 'utf-8' });
  console.log(`Created signalsMetadata: ${latestdir}/signalsMetadata.json`);

  const targetDocument = JSON.patch.apply(sourceDocument, didUpdateInvocation.patch);
  await writeFile(`${blockDir}/targetDocument.json`, JSON.stringify(targetDocument, null, 4), { encoding: 'utf-8' });
  console.log(`Created targetDocument: ${latestdir}/targetDocument.json`, targetDocument);

  const resolutionOptions = { versionTime: Date.now(), sidecarData: { did: identifier, signalsMetadata } };
  await writeFile(`${latestdir}/resolutionOptions.json`, JSON.stringify(resolutionOptions, null, 4), { encoding: 'utf-8' });
  console.log(`Created resolutionOptions: ${latestdir}/resolutionOptions.json`, resolutionOptions);
}
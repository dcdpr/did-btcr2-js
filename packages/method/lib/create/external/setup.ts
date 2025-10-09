import { ID_PLACEHOLDER_VALUE } from '@did-btcr2/common';
import { KeyPairUtils } from '@did-btcr2/keypair';
import { Did } from '@web5/dids';
import { writeFile } from 'fs/promises';
import path from 'path';
import { BeaconUtils, DidBtc1, getNetwork, IntermediateDidDocument } from '../../../src/index.js';

const cwd = process.cwd();
const network = process.argv[2] || 'regtest';
console.log('Setting up for network:', network);
const basedir = `${cwd}/data/${network}/external`;
const latestdir = path.join(basedir, 'latest');
const latestTxtPath = path.join(latestdir, 'latest.txt');

// await mkdir(latestdir, { recursive: true });

const key0 = KeyPairUtils.generate();
const service0 = KeyPairUtils.generate();
const service1 = KeyPairUtils.generate();

const service = BeaconUtils.generateBeaconService({
  id          : `${ID_PLACEHOLDER_VALUE}#service-0`,
  publicKey   : service0.publicKey.bytes,
  network     : getNetwork(network),
  addressType : 'p2pkh',
  type        : 'SingletonBeacon',
});

const relationships = {
  authentication       : [`${ID_PLACEHOLDER_VALUE}#key-0`],
  assertionMethod      : [`${ID_PLACEHOLDER_VALUE}#key-0`],
  capabilityInvocation : [`${ID_PLACEHOLDER_VALUE}#key-0`],
  capabilityDelegation : [`${ID_PLACEHOLDER_VALUE}#key-0`]
};
const verificationMethod = [
  {
    id                 : `${ID_PLACEHOLDER_VALUE}#key-0`,
    type               : 'Multikey',
    controller         : ID_PLACEHOLDER_VALUE,
    publicKeyMultibase : key0.publicKey.multibase,
  }
];
const intermediateDocument = IntermediateDidDocument.create(verificationMethod, relationships, [service]);
await writeFile(path.join(latestdir, 'intermediateDocument.json'), JSON.stringify(intermediateDocument, null, 4), { encoding: 'utf-8' });

const { did, initialDocument } = await DidBtcr2.create({
  idType  : 'EXTERNAL',
  intermediateDocument,
  options : { version: 1, network }
});
await writeFile(path.join(latestdir, 'did.txt'), did, { encoding: 'utf-8' });
await writeFile(path.join(latestdir, 'initialDocument.json'), JSON.stringify(initialDocument, null, 4), { encoding: 'utf-8' });

const keys = {
  [`${ID_PLACEHOLDER_VALUE}#key-0`] : {
    sk : key0.privateKey.hex,
    pk : key0.publicKey.hex,
  },
  [`${ID_PLACEHOLDER_VALUE}#service-0`] : {
    sk : service0.privateKey.hex,
    pk : service0.publicKey.hex,
  },
  [`${did}#service-1`] : {
    sk : service1.privateKey.hex,
    pk : service1.publicKey.hex,
  }
};
await writeFile(path.join(latestdir, 'keys.json'), JSON.stringify(keys, null, 4), { encoding: 'utf-8' });

// Step 4: Write the new latest.txt file with the new UUID
const parts = Did.parse(did);
if(!parts) {
  throw new Error('Failed to parse DID');
}
const keyId = parts.id;
await writeFile(latestTxtPath, keyId, { encoding: 'utf-8' });

console.log(`New output UUID: ${keyId}`);
console.log(`Output files written to: ${latestdir}`);
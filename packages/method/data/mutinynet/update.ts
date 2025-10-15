import { getNetwork } from '@did-btcr2/bitcoin';
import { SchnorrKeyPair } from '@did-btcr2/keypair';
import { writeFile } from 'fs/promises';
import { BeaconUtils, DidBtcr2, DidDocument } from '../../src/index.js';
import initialKeys from './initial-key-pair.json' with { type: 'json' };
import updateKeys from './update-key-pair.json' with { type: 'json' };
import initialDidDocument from './initial-did-document.json' with { type: 'json' };

const updateKp = new SchnorrKeyPair({ secretKey: Buffer.from(updateKeys.secret, 'hex') });
const beacon = BeaconUtils.generateBeacon({
  identifier : initialDidDocument.id,
  network    : getNetwork('mutinynet'),
  type       : 'SingletonBeacon',
  publicKey  : updateKp.publicKey.compressed,
});

const update = await DidBtcr2.update({
  identifier      : initialDidDocument.id,
  sourceDocument  : new DidDocument(initialDidDocument),
  sourceVersionId : 1,
  patch           : [
    {
      op    : 'add',
      path  : '/service/3',
      value :  beacon
    }
  ],
  verificationMethodId : initialDidDocument.verificationMethod![0].id,
  beaconIds            : ['did:btcr2:k1q5pua0p3syhn3p3kpvuqkx7sxd9ndv6uffwvuv008n4nq6fdwv22x5q4qfp5h#initialP2PKH'],
  secretKey            : Buffer.from(initialKeys.secret, 'hex'),
});
console.log('update', JSON.stringify(update, null, 2));
await writeFile('btcr2-update.json', JSON.stringify(update, null, 2), 'utf-8');
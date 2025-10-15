import { SchnorrKeyPair } from '@did-btcr2/keypair';
import { writeFile } from 'fs/promises';
import { DidBtcr2, DidDocument } from '../../src/index.js';
import initialDidDocument from './initial-did-document.json' with { type: 'json' };
import initialKeys from './initial-key-pair.json' with { type: 'json' };
import updateKeys from './update-key-pair.json' with { type: 'json' };

const updateKp = new SchnorrKeyPair({ secretKey: Buffer.from(updateKeys.secret, 'hex') });
const vm = {
  id                 : `${initialDidDocument.id}#updateKey`,
  type               : 'Multikey',
  controller         : initialDidDocument.id,
  publicKeyMultibase : updateKp.publicKey.multibase.encoded
};

const update = await DidBtcr2.update({
  identifier      : initialDidDocument.id,
  sourceDocument  : new DidDocument(initialDidDocument),
  sourceVersionId : 1,
  patch           : [
    {
      op    : 'add',
      path  : '/verificationMethod/1',
      value :  vm
    }
  ],
  verificationMethodId : initialDidDocument.verificationMethod![0].id,
  beaconIds            : ['did:btcr2:k1qgp7vmk76hx8nnjkzym5apyps76ycvf9uggcdyakc0942kccgq5vp0cnnv5l5#initialP2PKH'],
  secretKey            : Buffer.from(initialKeys.secret, 'hex'),
});
console.log('update', JSON.stringify(update, null, 2));
await writeFile('./data/regtest/btcr2-update.json', JSON.stringify(update, null, 2), 'utf-8');
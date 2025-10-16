import { SchnorrKeyPair } from '@did-btcr2/keypair';
import { DidDocument } from '../src/index.js';
import initialKeyDocument from '../in/resolve/key/initialDidDocument.json' with { type: 'json' };

const privateKeyBytes = new Uint8Array([
  121, 128,  10, 172,  99,   5, 171,  98,
  188,  80,  87,   6,  52,   6, 169, 170,
  99,  75,  82,  88, 114,  49,  77,  67,
  18,  37, 113,  33,  63, 198, 248, 180
]);
const keys = new SchnorrKeyPair({ privateKey: privateKeyBytes });
console.log('keys:', keys);
const service = initialKeyDocument.service;

const create = DidDocument.fromKeyIdentifier(initialKeyDocument.id, keys.publicKey.multibase, service);
console.log('create:', create);
console.log('--------------------------------------');
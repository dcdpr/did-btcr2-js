import { ID_PLACEHOLDER_VALUE } from '@did-btcr2/common';
import { SchnorrKeyPair } from '@did-btcr2/keypair';
import { IntermediateDidDocument } from '../src/index.js';
import initialExternalDocument from '../in/resolve/external/initialDidDoc.json' with { type: 'json' };

const privateKeyBytes = new Uint8Array([
  121, 128,  10, 172,  99,   5, 171,  98,
  188,  80,  87,   6,  52,   6, 169, 170,
  99,  75,  82,  88, 114,  49,  77,  67,
  18,  37, 113,  33,  63, 198, 248, 180
]);
const keys = new SchnorrKeyPair({ privateKey: privateKeyBytes });
console.log('keys:', keys);

const id = initialExternalDocument.id;
const verificationMethod = initialExternalDocument.verificationMethod;
const service = initialExternalDocument.service;

const intermediateDocument = new IntermediateDidDocument(initialExternalDocument);
const create = IntermediateDidDocument.create(keys.publicKey.multibase, service);
console.log('create:', create);
console.log('--------------------------------------');

const inter = create.toIntermediate();
console.log('inter:', inter);
console.log('--------------------------------------');

const from = IntermediateDidDocument.from({ id: ID_PLACEHOLDER_VALUE, verificationMethod, service });
console.log('from:', from);
console.log('--------------------------------------');

const fromExt = IntermediateDidDocument.fromExternalIdentifier({ id, verificationMethod, service, });
console.log('fromExt:', fromExt);
console.log('--------------------------------------');

const DidDocument = intermediateDocument.toBtc1DidDocument(initialExternalDocument.id);
console.log('DidDocument:', DidDocument);
console.log('--------------------------------------');
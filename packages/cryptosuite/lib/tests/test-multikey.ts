<<<<<<< HEAD
import { SchnorrKeyPair } from '@did-btcr2/keypair';
=======
import { SchnorrKeyPair } from '../../../keypair/dist/types/secret/index.js';
>>>>>>> 7878735 (rearranging various parts to adapt to taproot support)
import { SchnorrMultikey } from '../../src/index.js';
import data from '../data/test-data.js';

const { did, document, keyPair } = data;

const keys = new SchnorrKeyPair(keyPair);
console.log('keyPair', keyPair);

const { verificationMethod } = document;
const { id, controller } = verificationMethod[0];

const message = Buffer.from('hello, world');
const multikey = new SchnorrMultikey({ id, controller, keys });
console.log('multikey', multikey);

const signature = multikey.sign(message);
console.log('signature', signature);

const isValid = multikey.verify(signature, message);
console.log('isValid', isValid);

const encoded = multikey.publicKey.encode();
console.log('encoded', encoded);

let decoded = multikey.publicKey.decode();
console.log('decoded', decoded);

const prefix = decoded.subarray(0, 2);
console.log('prefix', prefix);

const publicKeyBytes = decoded.subarray(2);
console.log('publicKeyBytes', publicKeyBytes);

const toVM = multikey.toVerificationMethod();
console.log('toVM', toVM);

const multikeyFromVm = multikey.fromVerificationMethod(verificationMethod[0]);
console.log('multikeyFromVm', multikeyFromVm);

const fullId = multikey.fullId();
console.log('fullId', fullId);
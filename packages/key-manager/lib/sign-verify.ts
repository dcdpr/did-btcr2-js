import { SchnorrKeyPair } from '@did-btcr2/keypair';
import { LocalKeyManager } from '../src/local-key-manager.js';

const kms = new LocalKeyManager();
const id = kms.importKey(SchnorrKeyPair.generate());
const msg = new Uint8Array([1, 2, 3]);
const hash = kms.digest(msg);
const sig = kms.sign(hash, id);
console.log('Signature:', sig);
const verify = kms.verify(sig, hash, id);
console.log('Signature valid:', verify);
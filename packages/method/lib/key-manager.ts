// import { SchnorrKeyPair, SecretKey } from '@did-btcr2/keypair';
import { Identifier, KeyManager } from '../src/index.js';

// const bytes = new Uint8Array(Buffer.from('b193d273a8ed8167f2de94e70c6d340dfdb13f2ec8f8d0b5d435c5b1b247635d', 'hex'));
// const secretKey = new SecretKey(bytes);
// const keys = new SchnorrKeyPair({ secretKey });
const { keys, identifier: { controller, id } } = Identifier.generate();
console.log('keys.multibase:', keys.multibase);
const keyUri = KeyManager.computeKeyUri(id, controller);
const keyManager = await KeyManager.initialize(keys, keyUri);
console.log('keyManager:', keyManager);

import { SchnorrKeyPair } from '../src/pair.js';
import { SecretKey } from '../src/secret.js';

const sk = SecretKey.generate();
const pair = new SchnorrKeyPair(sk);
const json = pair.json();
console.log('KeyPair JSON:', json);
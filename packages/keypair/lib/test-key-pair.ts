import * as tinysecp from 'tiny-secp256k1';
import { SchnorrKeyPair } from '../src/pair.js';

const kp = SchnorrKeyPair.generate();
// console.log('Generated Schnorr Key Pair:', kp.toJSON());

const uncompressed = tinysecp.pointCompress(kp.publicKey.compressed, false);
console.log('uncompressed', uncompressed);
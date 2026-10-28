import { ProjectivePoint } from '@noble/secp256k1';
import { SchnorrKeyPair } from '../src/pair.js';

const kp = SchnorrKeyPair.generate();
// console.log('Generated Schnorr Key Pair:', kp.toJSON());

const uncompressed = ProjectivePoint.fromHex(kp.publicKey.compressed).toRawBytes(false);
console.log('uncompressed', uncompressed);

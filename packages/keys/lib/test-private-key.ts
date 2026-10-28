import { Secp256k1SecretKey } from '../src/secret.js';

const bytes =  new Uint8Array([
  115, 253, 220, 18, 252, 147, 66, 187,
  41, 174, 155, 94, 212, 118, 50,  59,
  220, 105,  58, 17, 110,  54, 81,  36,
  85, 174, 232, 48, 254, 138, 37, 162
]);
const sec1 = new Secp256k1SecretKey(bytes);
console.log('sec1.bytes', sec1.bytes);
console.log('sec1.hex', sec1.hex);
console.log('-------------------');

const bint = 52464508790539176856770556715241483442035423615466097401201513777400180778402n;
const sec2 = new Secp256k1SecretKey(bint);
console.log('sec2.bytes', sec2.bytes);
console.log('sec2.hex', sec2.hex);
console.log('-------------------');

const publicKey = sec2.computePublicKey();
console.log('publicKey', publicKey);
console.log('sec2.hex', sec2.hex);
const valid = sec2.isValid();
console.log('valid', valid);
const json = sec2.toJSON();
console.log('json', json);
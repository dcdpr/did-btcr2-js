import { CompressedSecp256k1PublicKey } from '../src/public.js';

const hex = '029ad5f6a85d27ee69b133aed273b4f2f5d70ed4a71675019c1a76f04c663526ef';
const pub = new CompressedSecp256k1PublicKey(hex);
console.log('pub', pub.toJSON());
console.log('pub.bytes', pub.compressed);
console.log('pub.hex', pub.hex);
console.log('pub.multibase', pub.multibase);
console.log('pub.parity', pub.parity);
console.log('pub.x', pub.x);
console.log('pub.y', pub.y);
console.log('pub.uncompressed', pub.uncompressed);
console.log('pub.prefix', pub.multibase.prefix);
console.log('-------------------');

const json = pub.toJSON();
const decoded = pub.decode();
const encoded = pub.encode();
const eq = pub.equals(pub);
console.log('json', json);
console.log('decoded', decoded);
console.log('encoded', encoded);
console.log('eq', eq);

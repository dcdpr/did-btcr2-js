import { KeyPairUtils } from '../src/keys/key-pair.js';
// import { PrivateKeyUtils } from '../src/keys/private-key.js';

// const privateKeyBytes = PrivateKeyUtils.random();
const privateKeyBytes = new Uint8Array([
  115, 253, 220, 18, 252, 147, 66, 187,
  41, 174, 155, 94, 212, 118, 50,  59,
  220, 105,  58, 17, 110,  54, 81,  36,
  85, 174, 232, 48, 254, 138, 37, 162
]);
const kpFromPrv = KeyPairUtils.fromPrivateKey(privateKeyBytes);
console.log('kpFromPrv.privateKey', kpFromPrv.privateKey);
console.log('kpFromPrv.publicKey', kpFromPrv.publicKey);

const keyPair = KeyPairUtils.generate();
console.log('keyPair.privateKey.raw', keyPair.privateKey.bytes);
console.log('keyPair.privateKey.secret', keyPair.privateKey.secret);
console.log('keyPair.privateKey.point', keyPair.privateKey.point);
console.log('keyPair.privateKey.hex', keyPair.privateKey.hex());
console.log('keyPair.publicKey.raw', keyPair.publicKey.compressed);
console.log('keyPair.publicKey.uncompressed', keyPair.publicKey.uncompressed);
console.log('keyPair.publicKey.x', keyPair.publicKey.x);
console.log('keyPair.publicKey.y', keyPair.publicKey.y);
const id = '#initialKey';
const controller = 'did:btcr2:k1qvddh3hl7n5czluwhz9ry35tunkhtldhgr66zp907ewg4l7p6u786tz863a';

const mk = keyPair.toMultikey({ id, controller });
console.log('mk', mk);
import { PrivateKeyUtils, PublicKeyUtils } from '@did-btcr2/keypair';

const SECRET = 52464508790539176856770556715241483442035423615466097401201513777400180778402n;
console.log('SECRET', SECRET);
const privateKey = PrivateKeyUtils.fromSecret(SECRET);
console.log('privateKey', privateKey);
const publicKey = privateKey.computePublicKey();
console.log('publicKey', publicKey);
const uncompressed = PublicKeyUtils.liftX(publicKey.x);
console.log('uncompressed', uncompressed);
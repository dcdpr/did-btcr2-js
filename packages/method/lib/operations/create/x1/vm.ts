import { SchnorrKeyPair } from '@did-btcr2/keypair';

const keypair = SchnorrKeyPair.generate();
const verificationMethod =  {
  id                 : 'did:btcr2:x1qfk62y9txdl683h3qwyfzqxumxkfdt8534g0kjhhgjqhtudvc0r2yskhaf7#key-1',
  type               : 'Multikey',
  controller         : 'did:btcr2:x1qfk62y9txdl683h3qwyfzqxumxkfdt8534g0kjhhgjqhtudvc0r2yskhaf7',
  publicKeyMultibase : keypair.publicKey.multibase.encoded,
};
console.log('keypair:', keypair.toJSON());
console.log('verificationMethod:', verificationMethod);
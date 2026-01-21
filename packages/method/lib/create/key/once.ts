import { SchnorrKeyPair, Secp256k1SecretKey } from '@did-btcr2/keypair';
import { DidBtcr2 } from '../../../src/did-btcr2.js';
import { Identifier } from '../../../src/index.js';

const kp = new SchnorrKeyPair({
  secretKey: new Secp256k1SecretKey(Buffer.from('80d5427d3191c13a0c8e7279abc538a31a1ea210158d38022a80b2fac1660a79', 'hex'))
})

const did = await DidBtcr2.create(
  kp.publicKey.compressed,
  {
    idType : 'KEY',
    version: 1,
    network: 'bitcoin'
  });
console.log('kp: ', kp);
console.log('did: ', did);
const comps = Identifier.decode(did)
console.log('comps: ', comps);
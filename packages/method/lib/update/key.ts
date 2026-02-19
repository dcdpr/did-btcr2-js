import { SchnorrKeyPair } from '@did-btcr2/keypair';
import { networks, payments } from 'bitcoinjs-lib';
import regtest from '../../data/key/regtest/k1qgpkyr20hr2ugzcdctulmprrdkz5slj3an64l0x4encgc6kpfz7g5ds4tgr4f/data.json' with { type: 'json' };
import { DidBtcr2 } from '../../src/index.js';

const kp = SchnorrKeyPair.fromSecret(regtest.keyPair.secret);
const signingMaterial = kp.secretKey.bytes;

const newBeaconKeyPair = SchnorrKeyPair.fromSecret('9f4b25da13b64eb59cddf064a4b374d13d14ffbc6624f4457eafae3cc69fb3fd');

const pubkey = newBeaconKeyPair.publicKey.compressed;
const network = networks.regtest;
const { address } = payments.p2pkh({ pubkey, network });

if(!address) throw new Error('Failed to generate address from public key');

const sourceDocument = regtest.initialDocument;

const patches = [
  {
    op    : 'add',
    path  : '/service/3',
    value : {
      id              : `${sourceDocument.id}#newP2PKH`,
      type            : 'SingletonBeacon',
      serviceEndpoint : `bitcoin:${address}`,
    }
  }
];

const verificationMethodId = 'did:btcr2:k1qgpkyr20hr2ugzcdctulmprrdkz5slj3an64l0x4encgc6kpfz7g5ds4tgr4f#initialKey';

const beaconId = 'did:btcr2:k1qgpkyr20hr2ugzcdctulmprrdkz5slj3an64l0x4encgc6kpfz7g5ds4tgr4f#initialP2PKH';

const sourceVersionId = 1;

const signedUpdate = await DidBtcr2.update(
    {
  sourceDocument,
  patches,
  sourceVersionId,
  verificationMethodId,
  beaconId,
  signingMaterial
    }
);

console.log('Signed Update:', JSON.stringify(signedUpdate, null, 2));
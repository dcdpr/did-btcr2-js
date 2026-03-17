import { canonicalize, hash } from '@did-btcr2/common';
import { SchnorrKeyPair } from '@did-btcr2/keypair';
import { hex } from '@scure/base';
import { DidBtcr2 } from '../../../../src/did-btcr2.js';
import { GenesisDocument } from '../../../../src/index.js';

const keypair = SchnorrKeyPair.generate();
const pubkey = keypair.publicKey.compressed;

const genesisDocument = GenesisDocument.fromPublicKey(pubkey, 'regtest');
const genesisBytes = hash(canonicalize(genesisDocument));
const genesisHex = hex.encode(genesisBytes);

const did = DidBtcr2.create(genesisBytes, { idType: 'EXTERNAL', network: 'regtest' });

console.log('did:', did);
console.log('genesisHex:', genesisHex);
console.log('genesisBytes:', genesisBytes);
console.log('genesisDocument:', genesisDocument);
console.log('keypair:', keypair.toJSON());
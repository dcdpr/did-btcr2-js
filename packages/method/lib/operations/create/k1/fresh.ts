import { SchnorrKeyPair } from '@did-btcr2/keypair';
import { DidBtcr2 } from '../../../../src/did-btcr2.js';

const keypair = SchnorrKeyPair.generate();
const genesisBytes = keypair.publicKey.compressed;
const result = DidBtcr2.create(genesisBytes, { idType: 'KEY', network: 'regtest' });

console.log('Key Pair:', keypair.json());
console.log('Result:', result);


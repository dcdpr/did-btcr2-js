import { SchnorrKeyPair } from '@did-btcr2/keypair';
import { DidBtcr2 } from '../../../../src/did-btcr2.js';

const networks = [
  'bitcoin',
  'mutinynet',
  'regtest',
  'signet',
  'testnet3',
  'testnet4',
];

const results = [];

for(const network of networks) {
  const kp = SchnorrKeyPair.generate();
  const genesisBytes = kp.publicKey.compressed;
  const did = DidBtcr2.create(genesisBytes, { idType: 'KEY', network });
  results.push({did, genesisBytes: kp.publicKey.hex, network, secretKey: kp.secretKey.hex});
}
console.log(JSON.stringify(results, null, 2));

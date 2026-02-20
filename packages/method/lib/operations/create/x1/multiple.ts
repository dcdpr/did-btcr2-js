import { Canonicalization } from '@did-btcr2/common';
import { SchnorrKeyPair } from '@did-btcr2/keypair';
import { DidBtcr2 } from '../../../../src/did-btcr2.js';
import { GenesisDocument } from '../../../../src/index.js';

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

  const genesisDocument = GenesisDocument.fromPublicKey(kp.publicKey.compressed, network);
  const genesisBytes = Canonicalization.andHash(genesisDocument);
  const genesisHex = Canonicalization.toHex(genesisBytes);

  const did = await DidBtcr2.create(genesisBytes, { idType: 'EXTERNAL', network: 'regtest' });
  results.push({
    did,
    network,
    genesisBytes : genesisHex,
    secretKey    : kp.secretKey.hex,
    genesisDocument
  });
}
console.log(JSON.stringify(results, null, 2));

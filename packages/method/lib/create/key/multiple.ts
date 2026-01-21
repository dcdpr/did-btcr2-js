import { DidBtcr2 } from '../../../src/did-btcr2.js';

const dids = [
  ['bitcoin', 'did:btcr2:k1qqpkyr20hr2ugzcdctulmprrdkz5slj3an64l0x4encgc6kpfz7g5dsaaw53r'],
  ['mutinynet', 'did:btcr2:k1q5pkyr20hr2ugzcdctulmprrdkz5slj3an64l0x4encgc6kpfz7g5dsfnpvmj'],
  ['regtest', 'did:btcr2:k1qgpkyr20hr2ugzcdctulmprrdkz5slj3an64l0x4encgc6kpfz7g5ds4tgr4f'],
  ['signet', 'did:btcr2:k1qypkyr20hr2ugzcdctulmprrdkz5slj3an64l0x4encgc6kpfz7g5dsekdtnx'],
  ['testnet3', 'did:btcr2:k1qvpkyr20hr2ugzcdctulmprrdkz5slj3an64l0x4encgc6kpfz7g5ds3qtuhv'],
  ['testnet4', 'did:btcr2:k1qspkyr20hr2ugzcdctulmprrdkz5slj3an64l0x4encgc6kpfz7g5dsdczneh']
];

for(const [network, did] of dids) {
  const idType = 'KEY';
  const genesisBytes = Buffer.from('03620d4fb8d5c40b0dc2f9fd84636d85487e51ecf55fbcd5ccf08c6ac148bc8a36', 'hex');

  const result = await DidBtcr2.create(genesisBytes, { idType, network });
  console.log(result === did); // true
}

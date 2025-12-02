import { DidBtcr2 } from "../../src/did-btcr2.js";

const deterministicDIDs = [
    ['bitcoin', 'did:btcr2:k1qqpkyr20hr2ugzcdctulmprrdkz5slj3an64l0x4encgc6kpfz7g5dsaaw53r'],
    ['mutinynet', 'did:btcr2:k1q5pkyr20hr2ugzcdctulmprrdkz5slj3an64l0x4encgc6kpfz7g5dsfnpvmj'],
    ['regtest', 'did:btcr2:k1qgpkyr20hr2ugzcdctulmprrdkz5slj3an64l0x4encgc6kpfz7g5ds4tgr4f'],
    ['signet', 'did:btcr2:k1qypkyr20hr2ugzcdctulmprrdkz5slj3an64l0x4encgc6kpfz7g5dsekdtnx'],
    ['testnet3', 'did:btcr2:k1qvpkyr20hr2ugzcdctulmprrdkz5slj3an64l0x4encgc6kpfz7g5ds3qtuhv'],
    ['testnet4', 'did:btcr2:k1qspkyr20hr2ugzcdctulmprrdkz5slj3an64l0x4encgc6kpfz7g5dsdczneh']
  ]
  
for(let [network, did] of deterministicDIDs) {
    const result = await DidBtcr2.resolve(did, { network });
    console.log(`Resolved DID Document for network=${network}:`, result.didDocument);
}
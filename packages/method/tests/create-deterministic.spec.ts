import { expect } from 'chai';
import { DidBtcr2 } from '../src/did-btcr2.js';

/**
 * Create Deterministic Test Cases
 * pubKeyBytes
 * idType=key, pubKeyBytes
 * idType=key, pubKeyBytes, version
 * idType=key, pubKeyBytes, network
 */
describe('Create Deterministic', () => {
  const version = 1;
  const expectedDidMap = new Map<string, string>([
    ['bitcoin', 'did:btcr2:k1qqpkyr20hr2ugzcdctulmprrdkz5slj3an64l0x4encgc6kpfz7g5dsaaw53r'],
    ['mutinynet', 'did:btcr2:k1q5pkyr20hr2ugzcdctulmprrdkz5slj3an64l0x4encgc6kpfz7g5dsfnpvmj'],
    ['regtest', 'did:btcr2:k1qgpkyr20hr2ugzcdctulmprrdkz5slj3an64l0x4encgc6kpfz7g5ds4tgr4f'],
    ['signet', 'did:btcr2:k1qypkyr20hr2ugzcdctulmprrdkz5slj3an64l0x4encgc6kpfz7g5dsekdtnx'],
    ['testnet3', 'did:btcr2:k1qvpkyr20hr2ugzcdctulmprrdkz5slj3an64l0x4encgc6kpfz7g5ds3qtuhv'],
    ['testnet4', 'did:btcr2:k1qspkyr20hr2ugzcdctulmprrdkz5slj3an64l0x4encgc6kpfz7g5dsdczneh']
  ]);
  const networkDidEntries = Object.entries(expectedDidMap);
  const idType = 'KEY';
  const genesisBytes = Buffer.fromHex('03620d4fb8d5c40b0dc2f9fd84636d85487e51ecf55fbcd5ccf08c6ac148bc8a36');

  it('should create a deterministic key identifier and DID document from a publicKey',
    async () => {
      const did = await DidBtcr2.create({ idType, genesisBytes });
      expect(did).to.equal(expectedDidMap.get('bitcoin'));
    });

  it('should create a deterministic key identifier and DID document from a publicKey and version',
    async () => {
      const did = await DidBtcr2.create({ idType, genesisBytes, options: { version } });
      expect(did).to.equal(did);
    });

  it('should create a deterministic key identifier and DID document from a publicKey and network',
    async () => {
      await Promise.all(
        networkDidEntries.map(
          async ([network, did]) => {
            const result = await DidBtcr2.create({ idType, genesisBytes, options: { network } });
            expect(result).to.equal(did);
          })
      );
    });
});

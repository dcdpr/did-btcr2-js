import { expect } from 'chai';
import { DidBtcr2 } from '../src/did-btcr2.js';
import data from './data/deterministic-data.js';

/**
 * Create Deterministic (k1) Test Cases
 */
describe('Create Deterministic (k1)', () => {
  it('should create a deterministic identifier from public key bytes on bitcoin (mainnet)',
    async () => {
      const {genesisBytes, did, network} = data[0];
      const result = await DidBtcr2.create(genesisBytes, { idType: 'KEY', network });
      expect(result).to.equal(did);
    });

  it('should create a deterministic identifiers from public key bytes on each network',
    async () => {
      for(const {genesisBytes, did, network} of data) {
        const result = await DidBtcr2.create(genesisBytes, { idType: 'KEY', network });
        expect(result).to.equal(did);
      }
    });
});

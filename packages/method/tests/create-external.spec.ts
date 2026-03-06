import { expect } from 'chai';
import { DidBtcr2 } from '../src/did-btcr2.js';
import data from './data/external-data.js';

/**
 * Create External Test Cases
 */
describe('Create External (x1)', () => {
  it('should create an external (x1) identifier from genesis document bytes on bitcoin (mainnet)',
    async () => {
      const {genesisBytes, did, network} = data[0];
      const result = DidBtcr2.create(genesisBytes, { idType: 'EXTERNAL', network });
      expect(result).to.equal(did);
    });

  it('should create an external (x1) identifiers from genesis document bytes on each network',
    async () => {
      for(const {genesisBytes, did, network} of data) {
        const result = DidBtcr2.create(genesisBytes, { idType: 'EXTERNAL', network });
        expect(result).to.equal(did);
      }
    });
});
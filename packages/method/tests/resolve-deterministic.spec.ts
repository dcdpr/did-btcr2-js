import { expect } from 'chai';
import { DidBtcr2 } from '../src/did-btcr2.js';
import data from './data/deterministic-data.js';

/**
 * Resolve Deterministic (k1) Test Cases
 */
describe('Resolve Deterministic (k1)', () => {
  it('should resolve each deterministic (k1) identifier to its correponding DID document',
    async () => {
      for(const {did} of data) {
        const result = await DidBtcr2.resolve(did);
        expect(result).to.have.property('didDocument');
        expect(result).to.have.property('didResolutionMetadata');
        expect(result).to.have.property('didDocumentMetadata');
      }
    });
});

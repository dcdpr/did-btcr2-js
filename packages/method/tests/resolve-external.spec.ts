import { expect } from 'chai';
import { DidBtcr2 } from '../src/did-btcr2.js';
import data from './data/external-data.js';

/**
 * Resolve External Test Cases
 */
describe('Resolve External', () => {
  it('should resolve each external identifier to its corresponding did document',
    async () => {
      for(const {did, genesisDocument} of data) {
        const options = {drivers: {}, sidecar: { genesisDocument }};
        const result = await DidBtcr2.resolve(did, options);
        expect(result).to.have.property('didDocument');
        expect(result).to.have.property('didResolutionMetadata');
        expect(result).to.have.property('didDocumentMetadata');
      }
    });
});
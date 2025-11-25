import { expect } from 'chai';
import { Identifier } from '../src/index.js';
import data from './data/encode-data.js';

/**
 * Encode Identifier Test Cases
 */
describe('Encode Identifier', () => {
  it('should properly encode each components into the respective identifier', () => {
    for(const { did, genesisBytes, options } of data) {
      const encoded = Identifier.encode(genesisBytes, options);
      expect(encoded).to.equal(did);
    }
  });
});
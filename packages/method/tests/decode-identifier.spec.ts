import { bytesToHex } from '@noble/hashes/utils';
import { expect } from 'chai';
import { Identifier } from '../src/index.js';
import data from './data/decode-data.js';

/**
 * Decode Identifier Test Cases
 */
describe('Decode Identifier', () => {
  it('should properly decode each identifier into its respective components', () => {
    for(const { did, components } of data) {
      const decoded = Identifier.decode(did);
      expect(decoded.hrp).to.equal(components.hrp);
      expect(decoded.idType).to.equal(components.idType);
      expect(decoded.version).to.equal(components.version);
      expect(decoded.network).to.equal(components.network);
      expect(bytesToHex(decoded.genesisBytes)).to.equal(components.genesisBytes);
    }
  });
});
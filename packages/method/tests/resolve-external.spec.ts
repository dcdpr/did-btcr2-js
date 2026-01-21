import { expect } from 'chai';
import bitcoin from '../data/external/bitcoin.json' with { type: 'json' };
import mutinynet from '../data/external/mutinynet.json' with { type: 'json' };
import regtest from '../data/external/regtest.json' with { type: 'json' };
import signet from '../data/external/signet.json' with { type: 'json' };
import testnet3 from '../data/external/testnet3.json' with { type: 'json' };
import testnet4 from '../data/external/testnet4.json' with { type: 'json' };
import { DidBtcr2 } from '../src/did-btcr2.js';

/**
 * Resolve External Test Cases
 */
describe('Resolve External', () => {
  it('should resolve each external identifier to its corresponding did document',
    async () => {
      for(const {did, genesisDocument} of [bitcoin, mutinynet, regtest, signet, testnet3, testnet4]) {
        const options = {drivers: {}, sidecar: { genesisDocument }};
        const result = await DidBtcr2.resolve(did, options);
        expect(result).to.have.property('didDocument');
        expect(result).to.have.property('didResolutionMetadata');
        expect(result).to.have.property('didDocumentMetadata');
      }
    });
});
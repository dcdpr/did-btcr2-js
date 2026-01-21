import { expect } from 'chai';
import { DidBtcr2 } from '../src/did-btcr2.js';

/**
 * Resolve Deterministic Test Cases
 */
describe('Resolve Deterministic', () => {
  const dids = [
    'did:btcr2:k1qqpkyr20hr2ugzcdctulmprrdkz5slj3an64l0x4encgc6kpfz7g5dsaaw53r',
    'did:btcr2:k1q5pkyr20hr2ugzcdctulmprrdkz5slj3an64l0x4encgc6kpfz7g5dsfnpvmj',
    'did:btcr2:k1qgpkyr20hr2ugzcdctulmprrdkz5slj3an64l0x4encgc6kpfz7g5ds4tgr4f',
    'did:btcr2:k1qypkyr20hr2ugzcdctulmprrdkz5slj3an64l0x4encgc6kpfz7g5dsekdtnx',
    'did:btcr2:k1qvpkyr20hr2ugzcdctulmprrdkz5slj3an64l0x4encgc6kpfz7g5ds3qtuhv',
    'did:btcr2:k1qspkyr20hr2ugzcdctulmprrdkz5slj3an64l0x4encgc6kpfz7g5dsdczneh'
  ];

  it('should resolve each deterministic key identifier to its correponding did document',
    async () => {
      for(const did of dids) {
        const result = await DidBtcr2.resolve(did);
        expect(result).to.have.property('didDocument');
        expect(result).to.have.property('didResolutionMetadata');
        expect(result).to.have.property('didDocumentMetadata');
      }
    });
});

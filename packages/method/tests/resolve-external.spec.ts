import { expect } from 'chai';
import { DidBtcr2 } from '../src/did-btcr2.js';

/**
 * Resolve External Test Cases
 */
describe('Resolve External', () => {
  const externalDIDs = [
    ['bitcoin', 'did:btcr2:x1qrn3k9ttngd7x6lgjlfpykz4aj03672675uw2gt2nj3m5vj680t8vaxz52w'],
    ['mutinynet', 'did:btcr2:x1q5uu7xjnle255xwwvgqu6f8j0x3ztxjs4307z9t04s3jw9z0d7wsswgwz3s'],
    ['regtest', 'did:btcr2:x1qguu7xjnle255xwwvgqu6f8j0x3ztxjs4307z9t04s3jw9z0d7wss687dcw'],
    ['signet', 'did:btcr2:x1qyuu7xjnle255xwwvgqu6f8j0x3ztxjs4307z9t04s3jw9z0d7wssa0g9a7'],
    ['testnet3', 'did:btcr2:x1qvuu7xjnle255xwwvgqu6f8j0x3ztxjs4307z9t04s3jw9z0d7wssqctjme'],
    ['testnet4', 'did:btcr2:x1qsuu7xjnle255xwwvgqu6f8j0x3ztxjs4307z9t04s3jw9z0d7wss5hmaj8']
  ];

  it('should resolve each external key identifier to its correcponding did document',
    async () => {
      await Promise.all(
        externalDIDs.map(
          async ([network, did]) => {
            const result = await DidBtcr2.resolve(did, { network });
            expect(result).to.have.property('didDocument');
            expect(result).to.have.property('didResolutionMetadata');
            expect(result).to.have.property('didDocumentMetadata');
          })
      );
    });
});
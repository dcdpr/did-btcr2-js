import { IdentifierError, INVALID_DID } from '@did-btcr2/std';
import { expect } from 'chai';
import { DidBtcr2 } from '../src/did-btcr2.js';
import data from './data/deterministic-data.js';

/**
 * Create Error Test Cases
 *
 * Create applies only the identifier encoding algorithm, and each error of that algorithm
 * MUST raise INVALID_DID.
 */
describe('Create errors', () => {
  const { genesisBytes } = data[0];

  it('gives INVALID_DID if the options or the idType are missing', () => {
    const cases: Array<[string, unknown]> = [
      ['no options', undefined],
      ['null options', null],
      ['options with no idType', { network: 'regtest' }],
      ['an empty idType', { idType: '' }],
    ];
    for (const [label, options] of cases) {
      expect(() => DidBtcr2.create(genesisBytes, options as never), label)
        .to.throw(IdentifierError, 'Expected "idType" to be "KEY" or "EXTERNAL"')
        .with.property('type', INVALID_DID);
    }
  });

  it('gives INVALID_DID for an idType that an object inherits', () => {
    expect(() => DidBtcr2.create(genesisBytes, { idType: 'toString' }))
      .to.throw(IdentifierError, 'Expected "idType" to be "KEY" or "EXTERNAL"')
      .with.property('type', INVALID_DID);
  });

  it('gives INVALID_DID for genesis bytes that are a string', () => {
    expect(() => DidBtcr2.create('a'.repeat(32) as never, { idType: 'EXTERNAL' }))
      .to.throw(IdentifierError, 'Expected "genesisBytes" to be a Uint8Array')
      .with.property('type', INVALID_DID);
  });
});

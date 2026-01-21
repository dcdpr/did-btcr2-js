import { expect } from 'chai';
import { DidBtcr2 } from '../src/did-btcr2.js';
import { Canonicalization } from '@did-btcr2/common';
import bitcoin from '../data/external/bitcoin.json' with { type: 'json' };
import mutinynet from '../data/external/mutinynet.json' with { type: 'json' };
import regtest from '../data/external/regtest.json' with { type: 'json' };
import signet from '../data/external/signet.json' with { type: 'json' };
import testnet3 from '../data/external/testnet3.json' with { type: 'json' };
import testnet4 from '../data/external/testnet4.json' with { type: 'json' };

/**
 * Create External Test Cases
 */
describe('Create External', () => {
  const idType = 'EXTERNAL';
  const canonicalization = new Canonicalization();

  it('should create a valid did:btcr2 external identifier on each supported network',
    async () => {
      for(const {network, did, genesisDocument} of [bitcoin, mutinynet, regtest, signet, testnet3, testnet4]) {
        const genesisBytes = canonicalization.canonicalhash(genesisDocument);
        const result = await DidBtcr2.create(genesisBytes, {idType, network});
        expect(result).to.equal(did);
      }
    }
  );
});
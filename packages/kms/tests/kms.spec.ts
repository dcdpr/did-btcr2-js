import { expect } from 'chai';
import { KeyManager } from '../src/kms.js';
import { SchnorrKeyPair } from '@did-btcr2/keypair';


/**
 * DidBtcr2 KMS Test
 */
describe('KMS Test', () => {
  const keyPair = SchnorrKeyPair.generate();

  it('should initialize the KMS', () => {
    const kms = new KeyManager({ keyPair });
    expect(kms).to.exist;
  });
});
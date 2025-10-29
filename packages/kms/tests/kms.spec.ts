import { expect } from 'chai';
import { KeyManager } from '../src/kms.js';


/**
 * DidBtcr2 KMS Test
 */
describe('KMS Test', () => {
  it('should initialize the KMS', () => {
    const kms = new KeyManager();
    expect(kms).to.exist;
  });
});
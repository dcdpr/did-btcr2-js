import { expect } from 'chai';
import { BitcoinNetworkConnection } from '../src/bitcoin.js';

/**
 * Bitcoin Network Connection - Browser Tests
 */
describe('Bitcoin Network Connection Tests', () => {
  it('should initialize the browser Bitcoin class', () => {
    const bitcoin = new BitcoinNetworkConnection();
    expect(bitcoin).to.exist;
  });
});
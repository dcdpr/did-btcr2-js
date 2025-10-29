import { expect } from 'chai';
import { DidBtcr2Api } from '../src/index.js';

/**
 * DidBtcr2 API Test
 */
describe('API Test', () => {
  it('should initialize the API', () => {
    const btcr2 = new DidBtcr2Api({});
    expect(btcr2).to.exist;
  });
});
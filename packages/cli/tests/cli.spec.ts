import { expect } from 'chai';
import { DidBtcr2Cli } from '../src/cli.js';

/**
 * DidBtcr2 CLI Test
 */
describe('CLI Tests', () => {
  it('should initialize the CLI', () => {
    const btcr2 = new DidBtcr2Cli();
    expect(btcr2).to.exist;
  });
});
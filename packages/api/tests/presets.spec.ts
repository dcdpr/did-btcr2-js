import { expect } from 'chai';
import type { NetworkName } from '@did-btcr2/bitcoin';
import { explorerAddressUrl, explorerTxUrl, faucetUrl, NETWORK_PRESETS } from '../src/index.js';

describe('network presets (ADR 082)', () => {
  const ALL: NetworkName[] = [ 'bitcoin', 'testnet3', 'testnet4', 'signet', 'mutinynet', 'regtest' ];

  it('defines a preset entry for every supported network', () => {
    for (const n of ALL) expect(NETWORK_PRESETS).to.have.property(n);
  });

  it('mutinynet carries the demo faucet, explorer, and block-time hint', () => {
    const p = NETWORK_PRESETS.mutinynet;
    expect(p.faucetUrl).to.equal('https://faucet.mutinynet.com/');
    expect(p.explorerBaseUrl).to.equal('https://mutinynet.com');
    expect(p.blockTimeHint).to.equal('~30 seconds');
  });

  it('regtest has no public faucet or explorer', () => {
    expect(NETWORK_PRESETS.regtest.faucetUrl).to.equal(undefined);
    expect(NETWORK_PRESETS.regtest.explorerBaseUrl).to.equal(undefined);
  });

  it('mainnet has an explorer but intentionally no faucet', () => {
    expect(NETWORK_PRESETS.bitcoin.explorerBaseUrl).to.equal('https://mempool.space');
    expect(NETWORK_PRESETS.bitcoin.faucetUrl).to.equal(undefined);
  });

  describe('explorerTxUrl', () => {
    it('appends /tx/<txid> to the explorer base', () => {
      expect(explorerTxUrl('mutinynet', 'deadbeef')).to.equal('https://mutinynet.com/tx/deadbeef');
      expect(explorerTxUrl('signet', 'abc')).to.equal('https://mempool.space/signet/tx/abc');
    });

    it('returns undefined for a network without an explorer', () => {
      expect(explorerTxUrl('regtest', 'abc')).to.equal(undefined);
    });
  });

  describe('explorerAddressUrl', () => {
    it('appends /address/<addr> to the explorer base', () => {
      expect(explorerAddressUrl('mutinynet', 'tb1qxyz')).to.equal('https://mutinynet.com/address/tb1qxyz');
    });

    it('returns undefined for a network without an explorer', () => {
      expect(explorerAddressUrl('regtest', 'bcrt1q')).to.equal(undefined);
    });
  });

  describe('faucetUrl', () => {
    it('returns the faucet for a testnet', () => {
      expect(faucetUrl('mutinynet')).to.equal('https://faucet.mutinynet.com/');
    });

    it('returns undefined for regtest and mainnet', () => {
      expect(faucetUrl('regtest')).to.equal(undefined);
      expect(faucetUrl('bitcoin')).to.equal(undefined);
    });
  });
});

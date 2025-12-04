import { expect } from 'chai';
import { BitcoinNetworkConnection } from '../src/bitcoin.js';
import { DEFAULT_BITCOIN_NETWORK_CONFIG } from '../src/constants.js';

/**
 * BitcoinNetworkConnection Test Suite
 */
describe('BitcoinNetworkConnection', () => {
  const originalEnv = { ...process.env };

  afterEach(() => {
    Object.assign(process.env, originalEnv);
    for (const key of Object.keys(process.env)) {
      if (!(key in originalEnv)) delete (process.env as any)[key];
    }
  });


  it('throws an error if process.env.ACTIVE_NETWORK is missing', () => {
    const originalActiveNetwork = process.env.ACTIVE_NETWORK;
    process.env.ACTIVE_NETWORK = '';

    try {
      expect(() => new BitcoinNetworkConnection()).to.throw('Missing ACTIVE_NETWORK environment variable');
    } finally {
      process.env.ACTIVE_NETWORK = originalActiveNetwork;
    }
  });

  it('initializes with provided configs and switches networks', () => {
    const config = {
      regtest : {
        rpc  : { host: 'http://localhost', username: 'u', password: 'p', version: '0.1', allowDefaultWallet: true },
        rest : { host: 'http://rest' }
      }
    } as any;
    process.env.ACTIVE_NETWORK = 'regtest';
    const btc = new BitcoinNetworkConnection(config);
    expect(btc.network.name).to.equal('regtest');
    btc.setActiveNetwork('regtest');
    expect(() => btc.setActiveNetwork('unknown')).to.throw('No configuration found for network=\'unknown\'');
    expect(() => btc.getNetworkConnection('missing')).to.throw('No configuration found for network=\'missing\'');
    expect(btc.getNetworkConnection('regtest')).to.be.instanceOf(BitcoinNetworkConnection);
    expect(BitcoinNetworkConnection.btcToSats(1.5)).to.equal(150000000);
    expect(BitcoinNetworkConnection.satsToBtc(150000000)).to.equal(1.5);
  });

  it('validates environment configuration', () => {
    process.env.BITCOIN_NETWORK_CONFIG = '';
    try {
      new BitcoinNetworkConnection();
      expect.fail('Expected missing config error');
    } catch (err: any) {
      expect(err.message).to.include('No BITCOIN_NETWORK_CONFIG');
    }

    process.env.BITCOIN_NETWORK_CONFIG = '{';
    try {
      new BitcoinNetworkConnection();
      expect.fail('Expected parse error');
    } catch (err: any) {
      expect(err.message).to.include('Parsing failed');
    }

    process.env.BITCOIN_NETWORK_CONFIG = JSON.stringify({ bitcoin: DEFAULT_BITCOIN_NETWORK_CONFIG.bitcoin });
    process.env.ACTIVE_NETWORK = 'regtest';
    try {
      new BitcoinNetworkConnection();
      expect.fail('Expected missing active network config');
    } catch (err: any) {
      expect(err.message).to.include('No configuration found for ACTIVE_NETWORK');
    }
  });
});
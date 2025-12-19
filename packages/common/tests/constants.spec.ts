import { expect } from 'chai';
import {
  BIP340_PUBLIC_KEY_MULTIBASE_PREFIX_HASH,
  BIP340_SECRET_KEY_MULTIBASE_PREFIX_HASH,
  DEFAULT_POLAR_CONFIG,
  getDefaultRpcConfig
} from '../src/index.js';

describe('constants', () => {
  it('derives multibase prefix hashes deterministically', () => {
    expect(BIP340_PUBLIC_KEY_MULTIBASE_PREFIX_HASH).to.have.length.greaterThan(0);
    expect(BIP340_SECRET_KEY_MULTIBASE_PREFIX_HASH).to.have.length.greaterThan(0);
  });

  it('loads default RPC config with env overrides', () => {
    const original = { ...DEFAULT_POLAR_CONFIG };
    process.env.BTCR2_RPC_HOST = 'http://override';
    process.env.BTCR2_RPC_USER = 'user1';
    process.env.BTCR2_RPC_PASS = 'pass1';
    const cfg = getDefaultRpcConfig();
    expect(cfg.host).to.equal('http://override');
    expect(cfg.username).to.equal('user1');
    expect(cfg.password).to.equal('pass1');

    process.env.BTCR2_RPC_HOST = original.host;
    process.env.BTCR2_RPC_USER = original.username;
    process.env.BTCR2_RPC_PASS = original.password;
  });
});

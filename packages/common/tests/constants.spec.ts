import { expect } from 'chai';
import {
  BIP340_PUBLIC_KEY_MULTIBASE_PREFIX_HASH,
  BIP340_SECRET_KEY_MULTIBASE_PREFIX_HASH,
  getDefaultRpcConfig
} from '../src/index.js';

describe('constants', () => {
  it('derives multibase prefix hashes deterministically', () => {
    expect(BIP340_PUBLIC_KEY_MULTIBASE_PREFIX_HASH).to.have.length.greaterThan(0);
    expect(BIP340_SECRET_KEY_MULTIBASE_PREFIX_HASH).to.have.length.greaterThan(0);
  });

  it('loads default RPC config with env overrides', () => {
    const originalHost = process.env.BTCR2_RPC_HOST;
    const originalUser = process.env.BTCR2_RPC_USER;
    const originalPass = process.env.BTCR2_RPC_PASS;

    process.env.BTCR2_RPC_HOST = 'http://override';
    process.env.BTCR2_RPC_USER = 'user1';
    process.env.BTCR2_RPC_PASS = 'pass1';
    const cfg = getDefaultRpcConfig();
    expect(cfg.host).to.equal('http://override');
    expect(cfg.username).to.equal('user1');
    expect(cfg.password).to.equal('pass1');

    // Restore
    if (originalHost === undefined) delete process.env.BTCR2_RPC_HOST;
    else process.env.BTCR2_RPC_HOST = originalHost;
    if (originalUser === undefined) delete process.env.BTCR2_RPC_USER;
    else process.env.BTCR2_RPC_USER = originalUser;
    if (originalPass === undefined) delete process.env.BTCR2_RPC_PASS;
    else process.env.BTCR2_RPC_PASS = originalPass;
  });
});

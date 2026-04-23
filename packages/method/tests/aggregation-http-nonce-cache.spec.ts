import { expect } from 'chai';

import { NonceCache } from '../src/index.js';

describe('HTTP transport nonce cache', () => {
  it('accepts a novel (did, nonce) pair', () => {
    const cache = new NonceCache();
    expect(cache.store('did:btcr2:k.a', 'n1', 1000)).to.be.true;
  });

  it('rejects a replayed nonce for the same DID', () => {
    const cache = new NonceCache();
    expect(cache.store('did:btcr2:k.a', 'n1', 1000)).to.be.true;
    expect(cache.store('did:btcr2:k.a', 'n1', 1001)).to.be.false;
  });

  it('allows the same nonce from different DIDs', () => {
    const cache = new NonceCache();
    expect(cache.store('did:btcr2:k.a', 'n1', 1000)).to.be.true;
    expect(cache.store('did:btcr2:k.b', 'n1', 1000)).to.be.true;
  });

  it('allows different nonces from the same DID', () => {
    const cache = new NonceCache();
    expect(cache.store('did:btcr2:k.a', 'n1', 1000)).to.be.true;
    expect(cache.store('did:btcr2:k.a', 'n2', 1000)).to.be.true;
  });

  it('evicts the oldest entry past maxEntries (FIFO)', () => {
    const cache = new NonceCache({ maxEntries: 3 });
    cache.store('d', 'a', 1);
    cache.store('d', 'b', 2);
    cache.store('d', 'c', 3);
    cache.store('d', 'e', 4); // forces eviction of 'a' → cache is now [b, c, e]
    expect(cache.size()).to.equal(3);
    // 'a' was evicted; replaying it now succeeds (and evicts 'b' as the new oldest).
    expect(cache.store('d', 'a', 5)).to.be.true;
    // 'c' is still present → replay rejected.
    expect(cache.store('d', 'c', 5)).to.be.false;
  });

  it('reports its size', () => {
    const cache = new NonceCache();
    expect(cache.size()).to.equal(0);
    cache.store('d', 'n1', 100);
    expect(cache.size()).to.equal(1);
  });
});

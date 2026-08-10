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

  it('rejects new admissions past maxEntries when nothing is expired (never evicts live entries)', () => {
    // Pin the clock near the test timestamps so nothing falls outside the
    // expiry window: at capacity the cache fails closed (refuses the new
    // admission) rather than evicting a live in-window entry and reopening its
    // replay window (audit MS-10).
    const cache = new NonceCache({ maxEntries: 3, windowSec: 10_000, nowSec: () => 10 });
    cache.store('d', 'a', 1);
    cache.store('d', 'b', 2);
    cache.store('d', 'c', 3);
    expect(cache.store('d', 'e', 4), 'novel admission refused at capacity').to.be.false;
    expect(cache.size()).to.equal(3);
    // Every live entry retained its replay protection.
    expect(cache.store('d', 'a', 5)).to.be.false;
    expect(cache.store('d', 'c', 5)).to.be.false;
  });

  it('reports its size', () => {
    const cache = new NonceCache();
    expect(cache.size()).to.equal(0);
    cache.store('d', 'n1', 100);
    expect(cache.size()).to.equal(1);
  });
});

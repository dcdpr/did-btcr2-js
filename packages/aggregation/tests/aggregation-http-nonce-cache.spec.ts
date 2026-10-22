import { expect } from 'chai';

import { AggregationServiceError, NonceCache } from '../src/index.js';

describe('HTTP transport nonce cache', () => {
  const NOW = 1_000;

  it('has() is false for a pair that the cache does not hold', () => {
    const cache = new NonceCache();
    expect(cache.has('did:btcr2:k.a', 'n1', NOW)).to.be.false;
  });

  it('store() records a pair and has() then finds it', () => {
    const cache = new NonceCache();
    expect(cache.store('did:btcr2:k.a', 'n1', NOW + 120, NOW)).to.equal('stored');
    expect(cache.has('did:btcr2:k.a', 'n1', NOW)).to.be.true;
  });

  it('keys an entry by DID and nonce', () => {
    const cache = new NonceCache();
    cache.store('did:btcr2:k.a', 'n1', NOW + 120, NOW);
    expect(cache.has('did:btcr2:k.b', 'n1', NOW)).to.be.false;
    expect(cache.has('did:btcr2:k.a', 'n2', NOW)).to.be.false;
  });

  it('an entry is live at its expiry second and expired one second later', () => {
    const cache = new NonceCache();
    cache.store('d', 'n1', NOW + 120, NOW);
    expect(cache.has('d', 'n1', NOW + 120)).to.be.true;
    expect(cache.has('d', 'n1', NOW + 121)).to.be.false;
  });

  it('store() purges the expired entries from the head', () => {
    const cache = new NonceCache();
    cache.store('d', 'a', NOW + 10, NOW);
    cache.store('d', 'b', NOW + 20, NOW);
    cache.store('d', 'c', NOW + 30, NOW);
    expect(cache.size()).to.equal(3);

    // At NOW + 21, 'a' and 'b' are expired and 'c' is live.
    expect(cache.store('d', 'e', NOW + 141, NOW + 21)).to.equal('stored');
    expect(cache.size()).to.equal(2);
    expect(cache.has('d', 'c', NOW + 21)).to.be.true;
    expect(cache.has('d', 'e', NOW + 21)).to.be.true;
  });

  it('a store at the expiry second of the head does not purge the head', () => {
    const cache = new NonceCache();
    cache.store('d', 'a', NOW + 10, NOW);

    // At NOW + 10 the head 'a' is still live, so the purge of this store keeps it.
    expect(cache.store('d', 'b', NOW + 130, NOW + 10)).to.equal('stored');
    expect(cache.size()).to.equal(2);
    expect(cache.has('d', 'a', NOW + 10)).to.be.true;
  });

  it('the purge stops at the first live head', () => {
    const cache = new NonceCache();
    // A clock step back: the head expires later than the entry behind it.
    cache.store('d', 'a', NOW + 100, NOW);
    cache.store('d', 'b', NOW + 10, NOW - 90);
    cache.store('d', 'c', NOW + 30, NOW + 20);

    // 'b' is expired at NOW + 20 but stays behind the live head 'a'; has() treats it as absent.
    expect(cache.size()).to.equal(3);
    expect(cache.has('d', 'b', NOW + 20)).to.be.false;
  });

  it('store() returns evicted when the cache is full of live entries, and the head goes', () => {
    const cache = new NonceCache({ maxEntries: 3 });
    expect(cache.store('d', 'a', NOW + 120, NOW)).to.equal('stored');
    expect(cache.store('d', 'b', NOW + 120, NOW)).to.equal('stored');
    expect(cache.store('d', 'c', NOW + 120, NOW)).to.equal('stored');

    expect(cache.store('d', 'e', NOW + 121, NOW + 1)).to.equal('evicted');
    expect(cache.size()).to.equal(3);
    expect(cache.has('d', 'a', NOW + 1)).to.be.false;
    expect(cache.has('d', 'b', NOW + 1)).to.be.true;
    expect(cache.has('d', 'c', NOW + 1)).to.be.true;
    expect(cache.has('d', 'e', NOW + 1)).to.be.true;
  });

  it('store() returns stored when the purge makes space', () => {
    const cache = new NonceCache({ maxEntries: 2 });
    cache.store('d', 'a', NOW + 10, NOW);
    cache.store('d', 'b', NOW + 120, NOW);
    expect(cache.store('d', 'c', NOW + 131, NOW + 11)).to.equal('stored');
    expect(cache.has('d', 'b', NOW + 11)).to.be.true;
    expect(cache.has('d', 'c', NOW + 11)).to.be.true;
  });

  it('a second store of a key moves the entry to the tail', () => {
    const cache = new NonceCache({ maxEntries: 3 });
    cache.store('d', 'a', NOW + 120, NOW);
    cache.store('d', 'b', NOW + 120, NOW);
    cache.store('d', 'c', NOW + 120, NOW);

    // Store 'a' again: it goes to the tail and the size does not change.
    expect(cache.store('d', 'a', NOW + 121, NOW + 1)).to.equal('stored');
    expect(cache.size()).to.equal(3);

    // The head is now 'b', so the next eviction takes 'b' and keeps 'a'.
    expect(cache.store('d', 'e', NOW + 122, NOW + 2)).to.equal('evicted');
    expect(cache.has('d', 'b', NOW + 2)).to.be.false;
    expect(cache.has('d', 'a', NOW + 2)).to.be.true;
  });

  it('reports its size', () => {
    const cache = new NonceCache();
    expect(cache.size()).to.equal(0);
    cache.store('d', 'n1', NOW + 120, NOW);
    expect(cache.size()).to.equal(1);
  });

  for(const maxEntries of [0, -1, 1.5, Number.NaN]) {
    it(`refuses maxEntries ${maxEntries} with INVALID_NONCE_CACHE_CAPACITY`, () => {
      expect(() => new NonceCache({ maxEntries }))
        .to.throw(AggregationServiceError).with.property('type', 'INVALID_NONCE_CACHE_CAPACITY');
    });
  }

  it('accepts maxEntries 1', () => {
    const cache = new NonceCache({ maxEntries: 1 });
    expect(cache.store('d', 'a', NOW + 120, NOW)).to.equal('stored');
    expect(cache.store('d', 'b', NOW + 120, NOW)).to.equal('evicted');
    expect(cache.has('d', 'b', NOW)).to.be.true;
  });
});

import { expect } from 'chai';

import type { BucketState, RateLimitStore } from '../src/index.js';
import { InMemoryRateLimitStore, RateLimiter } from '../src/index.js';

describe('HTTP transport rate limiter', () => {
  it('allows requests up to burst, then rejects', () => {
    const limiter = new RateLimiter({ rps: 1, burst: 3 });
    expect(limiter.consume('k', 0)).to.be.true;
    expect(limiter.consume('k', 0)).to.be.true;
    expect(limiter.consume('k', 0)).to.be.true;
    expect(limiter.consume('k', 0)).to.be.false;
  });

  it('refills linearly with elapsed time', () => {
    const limiter = new RateLimiter({ rps: 10, burst: 5 });
    // Drain the bucket.
    for(let i = 0; i < 5; i++) limiter.consume('k', 0);
    expect(limiter.consume('k', 0)).to.be.false;

    // 200ms later → 2 tokens refilled (10 rps * 0.2s = 2).
    expect(limiter.consume('k', 200)).to.be.true;
    expect(limiter.consume('k', 200)).to.be.true;
    expect(limiter.consume('k', 200)).to.be.false;
  });

  it('caps refills at burst size', () => {
    const limiter = new RateLimiter({ rps: 10, burst: 3 });
    limiter.consume('k', 0);
    // Huge elapsed time — but bucket won't exceed burst.
    expect(limiter.consume('k', 1_000_000)).to.be.true;
    expect(limiter.consume('k', 1_000_000)).to.be.true;
    expect(limiter.consume('k', 1_000_000)).to.be.true;
    expect(limiter.consume('k', 1_000_000)).to.be.false;
  });

  it('isolates buckets by key', () => {
    const limiter = new RateLimiter({ rps: 0, burst: 1 });
    expect(limiter.consume('a', 0)).to.be.true;
    expect(limiter.consume('a', 0)).to.be.false;
    expect(limiter.consume('b', 0)).to.be.true;
  });

  it('accepts an injected store', () => {
    const seen: Array<{ key: string; op: string }> = [];
    const store: RateLimitStore = {
      get(key) { seen.push({ key, op: 'get' }); return undefined; },
      set(key, _state: BucketState) { seen.push({ key, op: 'set' }); },
    };
    const limiter = new RateLimiter({ rps: 1, burst: 2, store });
    limiter.consume('k', 0);
    expect(seen.some((s) => s.key === 'k' && s.op === 'get')).to.be.true;
    expect(seen.some((s) => s.key === 'k' && s.op === 'set')).to.be.true;
  });

  it('InMemoryRateLimitStore exposes get/set', () => {
    const store = new InMemoryRateLimitStore();
    expect(store.get('k')).to.be.undefined;
    store.set('k', { tokens: 5, lastRefillMs: 0 });
    expect(store.get('k')).to.deep.equal({ tokens: 5, lastRefillMs: 0 });
  });
});

import { expect } from 'chai';
import { MemoryStore } from '../src/store.js';

describe('MemoryStore', () => {
  it('set/get/has work', () => {
    const s = new MemoryStore();
    s.set('a', 1);
    expect(s.get('a')).to.equal(1);

    expect(s.has('a')).to.equal(true);
    expect(s.has('b')).to.equal(false);
  });

  it('list() returns values; entries() returns key-value tuples', () => {
    const s = new MemoryStore();
    s.set('x', 10);
    s.set('y', 20);

    const vals = s.list().sort();
    expect(vals).to.deep.equal([10, 20]);

    const ents = s.entries().sort((a, b) => String(a[0]).localeCompare(String(b[0])));
    expect(ents).to.deep.equal([['x', 10], ['y', 20]]);
  });

  it('delete() returns boolean and removes, then clear() empties; close() is a no-op', () => {
    const s = new MemoryStore();
    s.set('k1', 123);
    s.set('k2', 456);

    expect(s.delete('k1')).to.equal(true);
    expect(s.get('k1')).to.equal(undefined);
    expect(s.delete('missing')).to.equal(false);

    s.close();
    s.set('k3', 789);
    expect(s.get('k3')).to.equal(789);

    s.clear();
    expect(s.list()).to.deep.equal([]);
    expect(s.entries()).to.deep.equal([]);
  });
});

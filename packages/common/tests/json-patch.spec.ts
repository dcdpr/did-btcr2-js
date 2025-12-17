import { expect } from 'chai';
import { JSONPatch, MethodError } from '../src/index.js';

describe('JSONPatch', () => {
  it('applies patches without mutating the source', () => {
    const source = { a: 1, nested: { b: 2 } };
    const ops = [
      { op: 'replace', path: '/a', value: 3 },
      { op: 'add', path: '/nested/c', value: 4 }
    ];

    const result = JSONPatch.apply(source, ops);
    expect(result).to.deep.equal({ a: 3, nested: { b: 2, c: 4 } });
    expect(source).to.deep.equal({ a: 1, nested: { b: 2 } }); // unmodified
  });

  it('can mutate the source when requested', () => {
    const source = { items: [1] };
    const ops = [{ op: 'add', path: '/items/1', value: 2 }];
    const result = JSONPatch.apply(source, ops, { mutate: true });
    expect(result).to.equal(source);
    expect(source.items).to.deep.equal([1, 2]);
  });

  it('rejects invalid operations with MethodError', () => {
    const source = { a: 1 };
    const ops = [{ op: 'move', path: '/b' } as any];
    expect(() => JSONPatch.apply(source, ops)).to.throw(MethodError, 'Invalid JSON Patch operations');
  });

  it('computes diffs and prefixes paths with escaping', () => {
    const source = { 'a/b': 1 };
    const target = { 'a/b': 2, c: 3 };
    const ops = JSONPatch.diff(source, target, '/base');
    expect(ops).to.deep.equal([
      { op: 'replace', path: '/base/a~1b', value: 2 },
      { op: 'add', path: '/base/c', value: 3 },
    ]);
  });
});

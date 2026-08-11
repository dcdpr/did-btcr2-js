import { expect } from 'chai';
import { JSONPatch, MethodError, type PatchOperation } from '../src/index.js';

describe('JSONPatch', () => {
  it('applies patches without mutating the source', () => {
    const source = { a: 1, nested: { b: 2 } };
    const ops: PatchOperation[] = [
      { op: 'replace', path: '/a', value: 3 },
      { op: 'add', path: '/nested/c', value: 4 }
    ];

    const result = JSONPatch.apply(source, ops);
    expect(result).to.deep.equal({ a: 3, nested: { b: 2, c: 4 } });
    expect(source).to.deep.equal({ a: 1, nested: { b: 2 } }); // unmodified
  });

  it('can mutate the source when requested', () => {
    const source = { items: [1] };
    const ops: PatchOperation[] = [{ op: 'add', path: '/items/1', value: 2 }];
    const result = JSONPatch.apply(source, ops, { mutate: true });
    expect(result).to.equal(source);
    expect(source.items).to.deep.equal([1, 2]);
  });

  it('rejects invalid operations with MethodError', () => {
    const source = { a: 1 };
    const ops = [{ op: 'move', path: '/b' } as any];
    expect(() => JSONPatch.apply(source, ops)).to.throw(MethodError, 'Invalid JSON Patch operations');
  });

  it('rejects a patch with too many operations', () => {
    const ops = Array.from({ length: 1025 }, () => ({ op: 'add', path: '/x', value: 1 }) as any);
    expect(() => JSONPatch.apply({ a: 1 }, ops)).to.throw(MethodError, 'Invalid JSON Patch operations');
    expect(JSONPatch.validateOperations(ops)?.message).to.match(/Too many operations/);
  });

  it('rejects an operation with an over-long path', () => {
    const ops = [{ op: 'add', path: `/${'a'.repeat(2048)}`, value: 1 } as any];
    expect(JSONPatch.validateOperations(ops)?.message).to.match(/path too long/);
  });

  it('rejects an operation with an oversized value', () => {
    const ops = [{ op: 'add', path: '/x', value: 'x'.repeat(300 * 1024) } as any];
    expect(JSONPatch.validateOperations(ops)?.message).to.match(/value too large/);
  });

  it('measures value size in UTF-8 bytes, not UTF-16 code units', () => {
    // 200k three-byte characters: ~200k UTF-16 code units (under the old cap)
    // but ~600k UTF-8 bytes (over the 256 KiB cap).
    const ops = [{ op: 'add', path: '/x', value: '\u20AC'.repeat(200 * 1024) } as any];
    expect(JSONPatch.validateOperations(ops)?.message).to.match(/value too large/);
  });

  it('rejects a move/copy operation with an over-long from pointer', () => {
    const from = `/${'a'.repeat(2048)}`;
    expect(JSONPatch.validateOperations([{ op: 'move', path: '/x', from } as any])?.message)
      .to.match(/from too long/);
    expect(JSONPatch.validateOperations([{ op: 'copy', path: '/x', from } as any])?.message)
      .to.match(/from too long/);
  });

  it('rejects a patch whose operations individually fit but exceed the total budget', () => {
    // 5 x 250 KiB values: each under the 256 KiB per-op cap, ~1.25 MiB in total.
    const ops = Array.from({ length: 5 }, () => ({ op: 'add', path: '/x', value: 'x'.repeat(250 * 1024) }) as any);
    expect(JSONPatch.validateOperations(ops)?.message).to.match(/Patch too large/);
  });

  it('accepts a patch within the total budget', () => {
    const ops = Array.from({ length: 3 }, () => ({ op: 'add', path: '/x', value: 'x'.repeat(250 * 1024) }) as any);
    expect(JSONPatch.validateOperations(ops)).to.be.null;
  });

  it('accepts a patch within the bounds', () => {
    const ops = [{ op: 'add', path: '/x', value: 'y' } as any];
    expect(JSONPatch.validateOperations(ops)).to.be.null;
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

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

  describe('prototype-traversal path segments', () => {
    const exploits: Array<{ name: string; op: PatchOperation; owner: any; prop: string }> = [
      {
        name  : 'Object.keys via /constructor/keys',
        op    : { op: 'replace', path: '/constructor/keys', value: null },
        owner : Object,
        prop  : 'keys'
      },
      {
        name  : 'Object.assign via /constructor/assign',
        op    : { op: 'replace', path: '/constructor/assign', value: null },
        owner : Object,
        prop  : 'assign'
      },
      {
        name  : 'Array.of via /arr/constructor/of',
        op    : { op: 'replace', path: '/arr/constructor/of', value: null },
        owner : Array,
        prop  : 'of'
      },
      {
        name  : 'Object.freeze via a move `from` pointer',
        op    : { op: 'move', from: '/constructor/freeze', path: '/sink/moved' },
        owner : Object,
        prop  : 'freeze'
      },
      {
        name  : 'Object.entries via a copy `from` pointer',
        op    : { op: 'copy', from: '/constructor/entries', path: '/sink/copied' },
        owner : Object,
        prop  : 'entries'
      }
    ];

    for (const { name, op, owner, prop } of exploits) {
      it(`rejects ${name} and leaves the global intact`, () => {
        const original = owner[prop];
        const source = { id: 'did:btcr2:x', arr: [1, 2], sink: {} };
        try {
          expect(() => JSONPatch.apply(source, [op])).to.throw(MethodError, 'Invalid JSON Patch operations');
          expect(owner[prop]).to.equal(original);
          expect(typeof owner[prop]).to.equal('function');
        } finally {
          // Repair the global if the guard ever regresses, so one failure cannot cascade.
          owner[prop] = original;
        }
      });
    }

    it('rejects __proto__ and prototype segments at any position', () => {
      const paths = ['/__proto__/polluted', '/constructor/prototype/polluted', '/a/__proto__/b', '/a/prototype/b'];
      for (const path of paths) {
        expect(() => JSONPatch.apply({ a: {} }, [{ op: 'add', path, value: 'x' }]))
          .to.throw(MethodError, 'Invalid JSON Patch operations');
      }
      expect(({} as Record<string, unknown>).polluted).to.equal(undefined);
    });

    it('reports the offending segment on the validation error', () => {
      const error = JSONPatch.validateOperations([{ op: 'replace', path: '/constructor/keys', value: null }]);
      expect(error).to.be.instanceOf(MethodError);
      expect(error?.message).to.include('constructor');
    });

    it('still allows escaped literal keys that merely resemble unsafe segments', () => {
      const source = { 'co~nstructor': 1, 'a/constructor': 2 };
      const result = JSONPatch.apply(source, [
        { op: 'replace', path: '/co~0nstructor', value: 9 },
        { op: 'replace', path: '/a~1constructor', value: 8 }
      ]);
      expect(result).to.deep.equal({ 'co~nstructor': 9, 'a/constructor': 8 });
    });
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

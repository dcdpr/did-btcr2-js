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

  describe('strict option (ADR 112)', () => {
    const source = () => ({ a: 1, nested: { b: 2 }, list: [1, 2] });

    it('applies a valid patch with the same result as the default mode', () => {
      const ops: PatchOperation[] = [
        { op: 'replace', path: '/a', value: 3 },
        { op: 'add', path: '/nested/c', value: 4 },
        { op: 'remove', path: '/list/0' },
        { op: 'move', from: '/nested/b', path: '/b' },
        { op: 'copy', from: '/a', path: '/d' },
        { op: 'test', path: '/d', value: 3 },
      ];
      expect(JSONPatch.apply(source(), ops, { strict: true })).to.deep.equal(JSONPatch.apply(source(), ops));
    });

    it('the default mode passes a remove of a missing path silently; strict fails it at that operation', () => {
      const ops: PatchOperation[] = [{ op: 'remove', path: '/missing' }];
      expect(JSONPatch.apply(source(), ops)).to.deep.equal(source());
      expect(() => JSONPatch.apply(source(), ops, { strict: true }))
        .to.throw(MethodError, /at operation 0 \(remove \/missing\).*does not exist/);
    });

    it('the default mode replaces a missing path by adding it; strict fails it', () => {
      const ops: PatchOperation[] = [{ op: 'replace', path: '/missing', value: 1 }];
      expect(JSONPatch.apply(source(), ops)).to.have.property('missing', 1);
      expect(() => JSONPatch.apply(source(), ops, { strict: true })).to.throw(MethodError, /does not exist/);
    });

    it('strict fails a move from a missing path', () => {
      const ops: PatchOperation[] = [{ op: 'move', from: '/missing', path: '/b' }];
      expect(() => JSONPatch.apply(source(), ops, { strict: true })).to.throw(MethodError, /does not exist/);
    });

    it('the default mode ignores an unknown op on the root path; strict rejects it', () => {
      const ops = [{ op: 'frobnicate', path: '' } as unknown as PatchOperation];
      expect(JSONPatch.apply(source(), ops)).to.deep.equal(source());
      expect(() => JSONPatch.apply(source(), ops, { strict: true }))
        .to.throw(MethodError, /not an RFC 6902 operation: frobnicate/);
    });

    it('the default mode writes a missing value as undefined; strict rejects it', () => {
      const ops = [{ op: 'add', path: '/a' } as PatchOperation];
      const lenient = JSONPatch.apply(source(), ops);
      expect('a' in lenient).to.equal(true);
      expect(lenient.a).to.equal(undefined);
      expect(() => JSONPatch.apply(source(), ops, { strict: true }))
        .to.throw(MethodError, /Operation.value is required for op=add/);
    });

    it('a failed test fails the patch in both modes, at the failing operation', () => {
      const ops: PatchOperation[] = [
        { op: 'replace', path: '/a', value: 2 },
        { op: 'test', path: '/a', value: 1 },
      ];
      expect(() => JSONPatch.apply(source(), ops)).to.throw(MethodError, /Test operation failed/);
      expect(() => JSONPatch.apply(source(), ops, { strict: true }))
        .to.throw(MethodError, /at operation 1 \(test \/a\): Test operation failed/);
    });

    it('the failure carries the type JSON_PATCH_APPLY_ERROR and the inner error', () => {
      const ops: PatchOperation[] = [{ op: 'remove', path: '/missing' }];
      let thrown: any;
      try {
        JSONPatch.apply(source(), ops, { strict: true });
      } catch(error) {
        thrown = error;
      }
      expect(thrown).to.be.instanceOf(MethodError);
      expect(thrown.type).to.equal('JSON_PATCH_APPLY_ERROR');
      expect(thrown.data.error.name).to.equal('OPERATION_PATH_UNRESOLVABLE');
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

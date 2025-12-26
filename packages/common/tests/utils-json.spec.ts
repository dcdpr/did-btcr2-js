import { expect } from 'chai';
import { JSONUtils } from '../src/index.js';

describe('utils/json', () => {
  it('detects JSON objects, prototypes, parsable/stringifiable content', () => {
    expect(JSONUtils.isObject({})).to.be.true;
    expect(JSONUtils.isObject([])).to.be.false;
    expect(JSONUtils.isParsable('{"a":1}')).to.be.true;
    expect(JSONUtils.isParsable('{bad}')).to.be.false;
    expect(JSONUtils.isUnprototyped(Object.create(null))).to.be.true;
    expect(JSONUtils.isUnprototyped({})).to.be.false;
  });

  it('copies JSON content correctly', () => {
    const original = { a: 1, b: { c: 2 } };
    const copy = JSONUtils.copy(original);
    expect(copy).to.deep.equal(original);
    expect(copy).to.not.equal(original);
    expect(copy.b).to.equal(original.b);
  });

  it('clones internal structures correctly', () => {
    const originalStructuredClone = globalThis.structuredClone;
    delete (globalThis as any).structuredClone;

    const original = { a: 1, b: { c: 2 } };
    const clone = JSONUtils.clone(original);
    expect(clone).to.deep.equal(original);
    expect(clone).to.not.equal(original);
    expect(clone.b).to.not.equal(original.b);

    globalThis.structuredClone = originalStructuredClone;
  });

  it('normalizes and clones with prototype stripping', () => {
    const obj = Object.create(null);
    obj.a = 1;
    const normalized = JSONUtils.normalize(obj);
    expect(Object.getPrototypeOf(normalized)).to.equal(Object.prototype);
    const clone = JSONUtils.clone({ a: 1 });
    expect(clone).to.deep.equal({ a: 1 });
  });

  it('deeply compares complex structures', () => {
    const mapA = new Map([['k', new Set([1, 2])]]);
    const mapB = new Map([['k', new Set([1, 2])]]);
    expect(JSONUtils.deepEqual(mapA, mapB)).to.be.true;

    const mapC = new Map([[1, 0], [3, 1]]);
    const mapD = new Map([[2, 1], [1, 0]]);
    expect(JSONUtils.deepEqual(mapC, mapD)).to.be.false;

    const mapE = new Map([[{id: 1}, [3, 1]]]);
    const mapF = new Map([[{id: 1}, [3, 1]]]);
    expect(JSONUtils.deepEqual(mapE, mapF)).to.be.true;

    const typedA = new Uint8Array([1, 2, 3]);
    const typedB = new Uint8Array([1, 2, 3]);
    expect(JSONUtils.deepEqual(typedA, typedB)).to.be.true;

    const dateA = new Date();
    const dateB = new Date();
    const dateC = new Date(dateA.getTime() + 1000);
    expect(JSONUtils.deepEqual(dateA, dateB)).to.be.true;
    expect(JSONUtils.deepEqual(dateA, dateC)).to.be.false;
  });

  it('throws on excessive recursion depth', () => {
    const makeDeep = (depth: number): any => depth === 0 ? {} : { child: makeDeep(depth - 1) };
    const deep = makeDeep(1030);
    const deepOther = makeDeep(1030);
    expect(() => JSONUtils.deepEqual(deep, deepOther)).to.throw('Maximum comparison depth exceeded');
    expect(() => JSONUtils.cloneInternal(deep)).to.throw('Maximum clone depth exceeded');
  });

  it('throws on circular clone', () => {
    const a: any = {};
    a.self = a;
    expect(() => JSONUtils.cloneInternal(a)).to.throw('Cannot clone circular structure');
  });

  it('clones array and typed arrays correctly', () => {
    const ui8a = new Uint8Array([10, 20]);
    const cloned = JSONUtils.cloneInternal(ui8a) as Uint8Array;
    expect(cloned).to.deep.equal(ui8a);
    expect(cloned).to.not.equal(ui8a);

    const arr = new Array([1, 2, ui8a]);
    const clonedArr = JSONUtils.cloneInternal(arr) as Array<any>;
    expect(clonedArr).to.deep.equal(arr);
    expect(clonedArr[2]).to.not.equal(ui8a);
  });

  it('clones DataView correctly', () => {
    const buf = new ArrayBuffer(16);
    const partial = new DataView(buf, 4, 8);

    partial.setUint32(0, 0xdeadbeef);

    const cloneA = JSONUtils.cloneInternal(partial) as DataView;

    expect(cloneA).to.be.instanceOf(DataView);
    expect(cloneA.byteLength).to.equal(partial.byteLength);
    expect(cloneA.getUint32(0)).to.equal(0xdeadbeef);
    expect(cloneA.buffer).to.not.equal(partial.buffer);
  });

  it('clones Date objects correctly', () => {
    const date = new Date('2024-01-02T03:04:05.678Z');
    const clone = JSONUtils.cloneInternal(date) as Date;
    expect(clone).to.be.instanceOf(Date);
    expect(clone.getTime()).to.equal(date.getTime());
    expect(clone).to.not.equal(date);
  });

  it('cloneReplace applies replacements', () => {
    const result = JSONUtils.cloneReplace({ msg: 'hello world' }, /world/, 'btcr2');
    expect(result).to.deep.equal({ msg: 'hello btcr2' });
  });

  it('deleteKeys removes specified keys in JSON objects', () => {
    const deleteA = JSONUtils.deleteKeys(['b', 1, { a: 3, c: '4' }, 'a'], ['a']);
    expect(deleteA).to.deep.equal([ 'b', 1, { c: '4' }, 'a' ]);

    const deleteB = JSONUtils.deleteKeys({ a: 1, b: 2, nested: { b: 3 } }, ['b']);
    expect(deleteB).to.deep.equal({ a: 1, nested: {} });
  });

  it('sanitize drops undefined values in JSON objects', () => {
    const sanitizeA = JSONUtils.sanitize({ a: undefined, b: 2, c: { d: undefined, e: 5 } });
    expect(sanitizeA).to.deep.equal({ b: 2, c: { e: 5 } });

    const sanitizeB = JSONUtils.sanitize(['b', undefined, 2, { d: undefined, e: 5 }]);
    expect(sanitizeB).to.deep.equal(['b', undefined, 2, { e: 5 }]);
  });
});

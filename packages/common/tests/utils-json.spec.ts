import { expect } from 'chai';
import { JSONUtils } from '../src/index.js';

describe('utils/json', () => {
  it('detects JSON objects and parsable/stringifiable content', () => {
    expect(JSONUtils.isJsonObject({})).to.be.true;
    expect(JSONUtils.isJsonObject([])).to.be.false;
    expect(JSONUtils.isParsableJson('{"a":1}')).to.be.true;
    expect(JSONUtils.isParsableJson('{bad}')).to.be.false;
    expect(JSONUtils.isStringifiableJson({ a: 1 })).to.be.true;
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

    const typedA = new Uint8Array([1, 2, 3]);
    const typedB = new Uint8Array([1, 2, 3]);
    expect(JSONUtils.deepEqual(typedA, typedB)).to.be.true;
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

  it('clones typed arrays correctly', () => {
    const arr = new Uint16Array([10, 20]);
    const cloned = JSONUtils.cloneInternal(arr) as Uint16Array;
    expect(cloned).to.deep.equal(arr);
    expect(cloned).to.not.equal(arr);
  });

  it('cloneReplace applies replacements', () => {
    const result = JSONUtils.cloneReplace({ msg: 'hello world' }, /world/, 'btcr2');
    expect(result).to.deep.equal({ msg: 'hello btcr2' });
  });

  it('deleteKeys removes specified keys', () => {
    const cleaned = JSONUtils.deleteKeys({ a: 1, b: 2, nested: { b: 3 } }, ['b']);
    expect(cleaned).to.deep.equal({ a: 1, nested: {} });
  });

  it('sanitize drops undefined values', () => {
    const sanitized = JSONUtils.sanitize({ a: undefined, b: 2, c: { d: undefined, e: 5 } });
    expect(sanitized).to.deep.equal({ b: 2, c: { e: 5 } });
  });
});

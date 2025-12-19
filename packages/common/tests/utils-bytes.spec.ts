import { expect } from 'chai';
import { toNumberArray, toUint8Array } from '../src/index.js';

describe('utils/bytes', () => {
  it('converts array-like inputs to Uint8Array', () => {
    const fromArray = toUint8Array([1, 2, 3]);
    expect(fromArray).to.be.instanceOf(Uint8Array);
    expect(Array.from(fromArray)).to.deep.equal([1, 2, 3]);

    const base = new Uint8Array([4, 5]);
    const fromView = toUint8Array(base.subarray(0, 1));
    expect(Array.from(fromView)).to.deep.equal([4]);
  });

  it('converts to plain number arrays', () => {
    expect(toNumberArray(new Uint8Array([7, 8]))).to.deep.equal([7, 8]);
  });
});

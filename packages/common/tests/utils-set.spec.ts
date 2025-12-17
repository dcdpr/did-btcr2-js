import { expect } from 'chai';
import { SetUtils } from '../src/index.js';

describe('utils/set', () => {
  it('computes set difference', () => {
    const left = new Set([1, 2, 3]);
    const right = new Set([2, 4]);
    const diff = SetUtils.difference(left, right);
    expect(diff).to.deep.equal(new Set([1, 3]));
    expect(left).to.deep.equal(new Set([1, 2, 3]));
    expect(right).to.deep.equal(new Set([2, 4]));
  });
});

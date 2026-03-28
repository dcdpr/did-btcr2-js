import { expect } from 'chai';
import { StaticFeeEstimator } from '../src/core/beacon/fee-estimator.js';

describe('StaticFeeEstimator', () => {
  it('defaults to 5 sat/vB', async () => {
    const estimator = new StaticFeeEstimator();
    expect(estimator.satsPerVbyte).to.equal(5);
    expect(await estimator.estimateFee(100)).to.equal(500n);
  });

  it('uses the provided sat/vB rate', async () => {
    const estimator = new StaticFeeEstimator(10);
    expect(await estimator.estimateFee(200)).to.equal(2000n);
  });

  it('supports zero fee rate (free transactions)', async () => {
    const estimator = new StaticFeeEstimator(0);
    expect(await estimator.estimateFee(500)).to.equal(0n);
  });

  it('rounds up fractional fees with Math.ceil', async () => {
    const estimator = new StaticFeeEstimator(1.5);
    // 100 * 1.5 = 150 — exact
    expect(await estimator.estimateFee(100)).to.equal(150n);
    // 101 * 1.5 = 151.5 — rounds up to 152
    expect(await estimator.estimateFee(101)).to.equal(152n);
  });

  it('throws on negative sat/vB rate', () => {
    expect(() => new StaticFeeEstimator(-1)).to.throw('Invalid satsPerVbyte');
  });

  it('throws on non-finite sat/vB rate', () => {
    expect(() => new StaticFeeEstimator(Infinity)).to.throw('Invalid satsPerVbyte');
    expect(() => new StaticFeeEstimator(NaN)).to.throw('Invalid satsPerVbyte');
  });

  it('throws on negative vsize', async () => {
    const estimator = new StaticFeeEstimator(5);
    try {
      await estimator.estimateFee(-1);
      expect.fail('expected throw');
    } catch(err) {
      expect((err as Error).message).to.contain('Invalid vsize');
    }
  });
});

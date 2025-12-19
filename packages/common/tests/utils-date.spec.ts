import { expect } from 'chai';
import { getUTCDateTime, toUnixSeconds } from '../src/index.js';

describe('utils/date', () => {
  it('formats UTC datetime without milliseconds', () => {
    const dt = new Date('2020-01-02T03:04:05.678Z');
    expect(getUTCDateTime(dt)).to.equal('2020-01-02T03:04:05Z');
  });

  it('returns unix seconds', () => {
    const dt = new Date('1970-01-01T00:00:02Z');
    expect(toUnixSeconds(dt)).to.equal(2);
  });

  it('throws on invalid dates', () => {
    const bad = new Date('invalid');
    expect(() => getUTCDateTime(bad)).to.throw('Invalid date');
    expect(() => toUnixSeconds(bad)).to.throw('Invalid date');
  });
});

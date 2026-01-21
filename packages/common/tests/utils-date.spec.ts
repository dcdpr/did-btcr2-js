import { expect } from 'chai';
import { DateUtils } from '../src/index.js';

describe('utils/date', () => {
  describe('toISOStringNonFractional', () => {
    it('strips fractional seconds from an ISO string', () => {
      const dt = new Date('2020-01-02T03:04:05.678Z');
      expect(DateUtils.toISOStringNonFractional(dt)).to.equal('2020-01-02T03:04:05Z');
    });

    it('handles a date with zero milliseconds', () => {
      const dt = new Date('2024-06-15T12:00:00.000Z');
      expect(DateUtils.toISOStringNonFractional(dt)).to.equal('2024-06-15T12:00:00Z');
    });

    it('uses current date when no argument is provided', () => {
      const result = DateUtils.toISOStringNonFractional();
      expect(result).to.match(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/);
    });

    it('throws on an invalid date', () => {
      const bad = new Date('invalid');
      expect(() => DateUtils.toISOStringNonFractional(bad)).to.throw('Invalid date');
    });
  });

  describe('toUnixSeconds', () => {
    it('returns unix seconds for a given date', () => {
      const dt = new Date('1970-01-01T00:00:02Z');
      expect(DateUtils.toUnixSeconds(dt)).to.equal(2);
    });

    it('returns an integer (floors fractional seconds)', () => {
      const dt = new Date('1970-01-01T00:00:02.999Z');
      expect(DateUtils.toUnixSeconds(dt)).to.equal(2);
    });

    it('returns 0 for the epoch', () => {
      expect(DateUtils.toUnixSeconds(new Date(0))).to.equal(0);
    });

    it('uses current date when no argument is provided', () => {
      const before = Math.floor(Date.now() / 1000);
      const result = DateUtils.toUnixSeconds();
      const after = Math.floor(Date.now() / 1000);
      expect(result).to.be.at.least(before);
      expect(result).to.be.at.most(after);
    });

    it('throws on an invalid date', () => {
      const bad = new Date('invalid');
      expect(() => DateUtils.toUnixSeconds(bad)).to.throw('Invalid date');
    });
  });

  describe('dateStringToTimestamp', () => {
    it('parses a valid ISO date string into a Date', () => {
      const result = DateUtils.dateStringToTimestamp('2024-03-15T10:30:00Z');
      expect(result.toISOString()).to.equal('2024-03-15T10:30:00.000Z');
    });

    it('returns epoch (Date(0)) for an invalid date string', () => {
      const result = DateUtils.dateStringToTimestamp('not-a-date');
      expect(result.getTime()).to.equal(0);
    });

    it('returns epoch for an empty string', () => {
      const result = DateUtils.dateStringToTimestamp('');
      expect(result.getTime()).to.equal(0);
    });

    it('parses a date-only string', () => {
      const result = DateUtils.dateStringToTimestamp('2000-01-01');
      expect(result.getUTCFullYear()).to.equal(2000);
    });
  });

  describe('blocktimeToTimestamp', () => {
    it('converts a blocktime in seconds to a Date', () => {
      const result = DateUtils.blocktimeToTimestamp(1700000000);
      expect(result.getTime()).to.equal(1700000000 * 1000);
    });

    it('converts 0 to the Unix epoch', () => {
      const result = DateUtils.blocktimeToTimestamp(0);
      expect(result.getTime()).to.equal(0);
    });

    it('handles a known Bitcoin block timestamp', () => {
      const genesis = 1231006505;
      const result = DateUtils.blocktimeToTimestamp(genesis);
      expect(result.toISOString()).to.equal('2009-01-03T18:15:05.000Z');
    });
  });

  describe('isValidXsdDateTime', () => {
    it('accepts a basic UTC dateTime', () => {
      expect(DateUtils.isValidXsdDateTime('2024-01-15T10:30:00Z')).to.be.true;
    });

    it('accepts a dateTime without timezone', () => {
      expect(DateUtils.isValidXsdDateTime('2024-01-15T10:30:00')).to.be.true;
    });

    it('accepts a dateTime with positive timezone offset', () => {
      expect(DateUtils.isValidXsdDateTime('2024-01-15T10:30:00+05:30')).to.be.true;
    });

    it('accepts a dateTime with negative timezone offset', () => {
      expect(DateUtils.isValidXsdDateTime('2024-01-15T10:30:00-08:00')).to.be.true;
    });

    it('accepts a dateTime with fractional seconds', () => {
      expect(DateUtils.isValidXsdDateTime('2024-01-15T10:30:00.123Z')).to.be.true;
    });

    it('accepts end-of-day 24:00:00', () => {
      expect(DateUtils.isValidXsdDateTime('2024-01-15T24:00:00Z')).to.be.true;
    });

    it('accepts a negative (BCE) year', () => {
      expect(DateUtils.isValidXsdDateTime('-0044-03-15T12:00:00Z')).to.be.true;
    });

    it('accepts a year with more than 4 digits', () => {
      expect(DateUtils.isValidXsdDateTime('12345-06-15T00:00:00Z')).to.be.true;
    });

    it('accepts Feb 29 in a leap year', () => {
      expect(DateUtils.isValidXsdDateTime('2024-02-29T00:00:00Z')).to.be.true;
    });

    it('rejects undefined', () => {
      expect(DateUtils.isValidXsdDateTime(undefined)).to.be.false;
    });

    it('rejects an empty string', () => {
      expect(DateUtils.isValidXsdDateTime('')).to.be.false;
    });

    it('rejects a plain date without time', () => {
      expect(DateUtils.isValidXsdDateTime('2024-01-15')).to.be.false;
    });

    it('rejects year 0000 (no year zero in XSD)', () => {
      expect(DateUtils.isValidXsdDateTime('0000-01-15T00:00:00Z')).to.be.false;
    });

    it('rejects month 00', () => {
      expect(DateUtils.isValidXsdDateTime('2024-00-15T00:00:00Z')).to.be.false;
    });

    it('rejects month 13', () => {
      expect(DateUtils.isValidXsdDateTime('2024-13-15T00:00:00Z')).to.be.false;
    });

    it('rejects day 00', () => {
      expect(DateUtils.isValidXsdDateTime('2024-01-00T00:00:00Z')).to.be.false;
    });

    it('rejects day 32 in January', () => {
      expect(DateUtils.isValidXsdDateTime('2024-01-32T00:00:00Z')).to.be.false;
    });

    it('rejects Feb 29 in a non-leap year', () => {
      expect(DateUtils.isValidXsdDateTime('2023-02-29T00:00:00Z')).to.be.false;
    });

    it('rejects Feb 29 in a century non-leap year', () => {
      expect(DateUtils.isValidXsdDateTime('1900-02-29T00:00:00Z')).to.be.false;
    });

    it('accepts Feb 29 in a 400-year leap year', () => {
      expect(DateUtils.isValidXsdDateTime('2000-02-29T00:00:00Z')).to.be.true;
    });

    it('rejects hour 25', () => {
      expect(DateUtils.isValidXsdDateTime('2024-01-15T25:00:00Z')).to.be.false;
    });

    it('rejects 24:01:00 (only 24:00:00 is valid)', () => {
      expect(DateUtils.isValidXsdDateTime('2024-01-15T24:01:00Z')).to.be.false;
    });

    it('rejects 24:00:01 (only 24:00:00 is valid)', () => {
      expect(DateUtils.isValidXsdDateTime('2024-01-15T24:00:01Z')).to.be.false;
    });

    it('rejects minute 60', () => {
      expect(DateUtils.isValidXsdDateTime('2024-01-15T10:60:00Z')).to.be.false;
    });

    it('rejects second 60', () => {
      expect(DateUtils.isValidXsdDateTime('2024-01-15T10:30:60Z')).to.be.false;
    });

    it('rejects timezone offset hour > 14', () => {
      expect(DateUtils.isValidXsdDateTime('2024-01-15T10:30:00+15:00')).to.be.false;
    });

    it('rejects timezone +14:01', () => {
      expect(DateUtils.isValidXsdDateTime('2024-01-15T10:30:00+14:01')).to.be.false;
    });

    it('rejects garbage input', () => {
      expect(DateUtils.isValidXsdDateTime('not-a-date')).to.be.false;
    });
  });
});

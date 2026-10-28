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

    it('accepts year 0000 (1 BCE in XML Schema 1.1)', () => {
      expect(DateUtils.isValidXsdDateTime('0000-01-15T00:00:00Z')).to.be.true;
    });

    it('accepts Feb 29 in year 0000 and year -0004 (leap years)', () => {
      expect(DateUtils.isValidXsdDateTime('0000-02-29T00:00:00Z')).to.be.true;
      expect(DateUtils.isValidXsdDateTime('-0004-02-29T00:00:00Z')).to.be.true;
      expect(DateUtils.isValidXsdDateTime('-0001-02-29T00:00:00Z')).to.be.false;
    });

    it('uses the last 4 digits of the year text for a leap year', () => {
      // Number() rounds 9007199254740993 to 9007199254740992, a leap year. The year is odd.
      expect(DateUtils.isValidXsdDateTime('9007199254740993-02-29T00:00:00Z')).to.be.false;
      // Number() gives Infinity for this year. 10^400 is a multiple of 400, so it is a leap year.
      expect(DateUtils.isValidXsdDateTime(`1${'0'.repeat(400)}-02-29T00:00:00Z`)).to.be.true;
      expect(DateUtils.isValidXsdDateTime('-0004-02-29T00:00:00Z')).to.be.true;
      expect(DateUtils.isValidXsdDateTime('-0001-02-29T00:00:00Z')).to.be.false;
    });

    it('rejects a year with more than 4 digits that starts with 0', () => {
      expect(DateUtils.isValidXsdDateTime('01000-01-15T00:00:00Z')).to.be.false;
      expect(DateUtils.isValidXsdDateTime('-01000-01-15T00:00:00Z')).to.be.false;
    });

    it('rejects a year with less than 4 digits', () => {
      expect(DateUtils.isValidXsdDateTime('999-01-15T00:00:00Z')).to.be.false;
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

    it('rejects a fraction other than zeros after 24:00:00', () => {
      expect(DateUtils.isValidXsdDateTime('2024-01-15T24:00:00.000Z')).to.be.true;
      expect(DateUtils.isValidXsdDateTime('2024-01-15T24:00:00.5Z')).to.be.false;
    });

    it('accepts the offsets -00:00 and +13:59', () => {
      expect(DateUtils.isValidXsdDateTime('2024-01-15T10:30:00-00:00')).to.be.true;
      expect(DateUtils.isValidXsdDateTime('2024-01-15T10:30:00+13:59')).to.be.true;
    });

    it('rejects an offset with no colon or one digit', () => {
      expect(DateUtils.isValidXsdDateTime('2024-01-15T10:30:00+0530')).to.be.false;
      expect(DateUtils.isValidXsdDateTime('2024-01-15T10:30:00+5:30')).to.be.false;
    });

    it('rejects a value that is not a string, with no TypeError', () => {
      for(const value of [5, null, {}, ['2024-01-15T10:30:00Z'], true]) {
        expect(DateUtils.isValidXsdDateTime(value)).to.be.false;
      }
    });

    it('rejects text before or after the dateTime', () => {
      expect(DateUtils.isValidXsdDateTime(' 2024-01-15T10:30:00Z')).to.be.false;
      expect(DateUtils.isValidXsdDateTime('2024-01-15T10:30:00Z\n')).to.be.false;
    });
  });

  describe('isValidXsdDateTimeStamp', () => {
    it('accepts a dateTime with Z or an offset', () => {
      expect(DateUtils.isValidXsdDateTimeStamp('2024-01-15T10:30:00Z')).to.be.true;
      expect(DateUtils.isValidXsdDateTimeStamp('2024-01-15T10:30:00-08:00')).to.be.true;
      expect(DateUtils.isValidXsdDateTimeStamp('10000-01-15T10:30:00Z')).to.be.true;
    });

    it('rejects a dateTime with no timezone', () => {
      expect(DateUtils.isValidXsdDateTimeStamp('2024-01-15T10:30:00')).to.be.false;
    });

    it('rejects an invalid dateTime that ends with Z', () => {
      expect(DateUtils.isValidXsdDateTimeStamp('2023-02-29T00:00:00Z')).to.be.false;
    });

    it('rejects a value that is not a string', () => {
      expect(DateUtils.isValidXsdDateTimeStamp(5)).to.be.false;
      expect(DateUtils.isValidXsdDateTimeStamp(undefined)).to.be.false;
    });
  });

  describe('xsdDateTimeToEpochMs', () => {
    it('gives the Date.parse value for a year 0001 to 9999', () => {
      for(const value of [
        '1970-01-01T00:00:00Z',
        '0001-01-01T00:00:00Z',
        '9999-12-31T23:59:59.999Z',
        '2024-02-29T12:34:56.789+05:30',
        '2026-10-27T08:00:00-14:00',
        '1969-12-31T23:59:59.5Z'
      ]) {
        expect(DateUtils.xsdDateTimeToEpochMs(value)).to.equal(Date.parse(value));
      }
    });

    it('gives the instant of a year above 9999, where Date.parse gives NaN', () => {
      expect(Date.parse('10000-01-01T00:00:00Z')).to.be.NaN;
      expect(DateUtils.xsdDateTimeToEpochMs('10000-01-01T00:00:00Z')).to.equal(Date.parse('+010000-01-01T00:00:00Z'));
      expect(DateUtils.xsdDateTimeToEpochMs('10000-01-01T00:00:00Z')).to.equal(253_402_300_800_000);
    });

    it('gives the instant of a negative year and of year 0000', () => {
      expect(Date.parse('-0001-01-01T00:00:00Z')).to.be.NaN;
      expect(DateUtils.xsdDateTimeToEpochMs('-0001-01-01T00:00:00Z')).to.equal(Date.parse('-000001-01-01T00:00:00Z'));
      expect(DateUtils.xsdDateTimeToEpochMs('0000-03-01T00:00:00Z')).to.equal(Date.parse('0000-03-01T00:00:00Z'));
    });

    it('reads a value with no timezone as UTC', () => {
      expect(DateUtils.xsdDateTimeToEpochMs('2024-01-15T10:30:00')).to.equal(Date.parse('2024-01-15T10:30:00Z'));
    });

    it('reads 24:00:00 as the first instant of the next day', () => {
      expect(DateUtils.xsdDateTimeToEpochMs('2024-12-31T24:00:00Z')).to.equal(Date.parse('2025-01-01T00:00:00Z'));
    });

    it('uses only the first 3 digits of a fraction of a second', () => {
      expect(DateUtils.xsdDateTimeToEpochMs('1970-01-01T00:00:00.0009Z')).to.equal(0);
      expect(DateUtils.xsdDateTimeToEpochMs('1970-01-01T00:00:00.12Z')).to.equal(120);
    });

    it('keeps the order of two instants far outside the Date range', () => {
      // Above Number.MAX_SAFE_INTEGER, two instants can give the same number, but a later
      // instant never gives a smaller number.
      const late = DateUtils.xsdDateTimeToEpochMs('100000000-01-01T00:00:00Z') as number;
      const early = DateUtils.xsdDateTimeToEpochMs('99999999-12-31T23:59:59Z') as number;
      expect(late).to.be.at.least(early);
      expect(early).to.be.greaterThan(Number.MAX_SAFE_INTEGER);
    });

    it('never gives a smaller number for a later instant (the BigInt value is rounded once)', () => {
      // A sum of rounded numbers gave 100000000002-12-31T23:59:59.999Z a larger number than
      // 100000000003-01-01T00:00:00.000Z.
      const early = DateUtils.xsdDateTimeToEpochMs('100000000002-12-31T23:59:59.999Z') as number;
      const late = DateUtils.xsdDateTimeToEpochMs('100000000003-01-01T00:00:00.000Z') as number;
      expect(early).to.be.at.most(late);
      expect(DateUtils.xsdDateTimeToEpochMs('-100000000003-01-01T00:00:00.000Z')).to.be.at.most(
        DateUtils.xsdDateTimeToEpochMs('-100000000002-12-31T23:59:59.999Z') as number
      );
    });

    it('gives Infinity or -Infinity for a year with more than 400 digits', () => {
      expect(DateUtils.xsdDateTimeToEpochMs(`1${'0'.repeat(400)}-01-01T00:00:00Z`)).to.equal(Infinity);
      expect(DateUtils.xsdDateTimeToEpochMs(`-1${'0'.repeat(400)}-01-01T00:00:00Z`)).to.equal(-Infinity);
    });

    it('gives undefined for a value that is not a valid dateTime', () => {
      for(const value of [undefined, 5, '', '2023-02-29T00:00:00Z', '01000-01-01T00:00:00Z']) {
        expect(DateUtils.xsdDateTimeToEpochMs(value)).to.equal(undefined);
      }
    });
  });

  describe('compareXsdDateTime', () => {
    it('compares the digits of a fraction after the third', () => {
      expect(DateUtils.compareXsdDateTime('2023-11-14T22:13:20.0005Z', '2023-11-14T22:13:20Z')).to.equal(1);
      expect(DateUtils.compareXsdDateTime('2023-11-14T22:13:20Z', '2023-11-14T22:13:20.0005Z')).to.equal(-1);
      expect(DateUtils.compareXsdDateTime('2023-11-14T22:13:10.0001Z', '2023-11-14T22:13:10.0002Z')).to.equal(-1);
      expect(DateUtils.compareXsdDateTime('2023-11-14T22:13:10.0002Z', '2023-11-14T22:13:10.0001Z')).to.equal(1);
      expect(DateUtils.compareXsdDateTime('2023-11-14T22:13:10.00015Z', '2023-11-14T22:13:10.0002Z')).to.equal(-1);
      expect(DateUtils.compareXsdDateTime('2023-11-14T22:13:10.0005Z', '2023-11-14T22:13:10.00049999Z')).to.equal(1);
    });

    it('compares the milliseconds before the digits after the third', () => {
      expect(DateUtils.compareXsdDateTime('2023-11-14T22:13:10.0019Z', '2023-11-14T22:13:10.002Z')).to.equal(-1);
      expect(DateUtils.compareXsdDateTime('1969-12-31T23:59:59.9995Z', '1969-12-31T23:59:59.9996Z')).to.equal(-1);
      expect(DateUtils.compareXsdDateTime('1969-12-31T23:59:59.9999Z', '1970-01-01T00:00:00Z')).to.equal(-1);
    });

    it('drops trailing zeros of a fraction', () => {
      expect(DateUtils.compareXsdDateTime('2023-11-14T22:13:20.5Z', '2023-11-14T22:13:20.500Z')).to.equal(0);
      expect(DateUtils.compareXsdDateTime('2023-11-14T22:13:20.50000Z', '2023-11-14T22:13:20.5Z')).to.equal(0);
      expect(DateUtils.compareXsdDateTime('2023-11-14T22:13:20.0000Z', '2023-11-14T22:13:20Z')).to.equal(0);
    });

    it('applies the timezone offset; no timezone is UTC', () => {
      expect(DateUtils.compareXsdDateTime('2023-01-01T01:00:00+01:00', '2023-01-01T00:00:00Z')).to.equal(0);
      expect(DateUtils.compareXsdDateTime('2022-12-31T23:30:00-00:30', '2023-01-01T00:00:00Z')).to.equal(0);
      expect(DateUtils.compareXsdDateTime('2023-01-01T00:00:00', '2023-01-01T00:00:00Z')).to.equal(0);
      expect(DateUtils.compareXsdDateTime('2023-01-01T00:30:00+01:00', '2023-01-01T00:00:00Z')).to.equal(-1);
    });

    it('reads 24:00:00 as 00:00:00 of the next day', () => {
      expect(DateUtils.compareXsdDateTime('2024-12-31T24:00:00Z', '2025-01-01T00:00:00Z')).to.equal(0);
      expect(DateUtils.compareXsdDateTime('2024-12-31T24:00:00.000Z', '2024-12-31T23:59:59.9999Z')).to.equal(1);
    });

    it('keeps the order of huge years, where the numbers of xsdDateTimeToEpochMs are equal', () => {
      const early = '100000000002-12-31T23:59:59.999Z';
      const late = '100000000003-01-01T00:00:00.000Z';
      expect(DateUtils.compareXsdDateTime(early, late)).to.equal(-1);
      expect(DateUtils.compareXsdDateTime(late, early)).to.equal(1);
      const huge = `1${'0'.repeat(400)}-01-01T00:00:00Z`;
      const hugePlusOne = `1${'0'.repeat(399)}1-01-01T00:00:00Z`;
      expect(DateUtils.xsdDateTimeToEpochMs(huge)).to.equal(DateUtils.xsdDateTimeToEpochMs(hugePlusOne));
      expect(DateUtils.compareXsdDateTime(huge, hugePlusOne)).to.equal(-1);
      expect(DateUtils.compareXsdDateTime(`-${huge}`, `-${hugePlusOne}`)).to.equal(1);
      expect(DateUtils.compareXsdDateTime('-0001-12-31T23:59:59Z', '0000-01-01T00:00:00Z')).to.equal(-1);
    });

    it('gives undefined if a value is not a valid dateTime', () => {
      for(const value of [undefined, 5, '', '2023-02-29T00:00:00Z', '2023-01-01']) {
        expect(DateUtils.compareXsdDateTime(value, '2023-01-01T00:00:00Z')).to.equal(undefined);
        expect(DateUtils.compareXsdDateTime('2023-01-01T00:00:00Z', value)).to.equal(undefined);
      }
    });
  });
});

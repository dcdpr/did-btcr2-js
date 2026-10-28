import { MethodError } from '../errors.js';

/**
 * The `dateTimeLexicalRep` regular expression of XML Schema 1.1 Part 2, with capture groups:
 * year, month, day, hour, minute, second, fraction, end of day (`24:00:00`), timezone.
 */
const XSD_DATE_TIME = new RegExp(
  '^(-?(?:[1-9][0-9]{3,}|0[0-9]{3}))-(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01])'
  + 'T(?:([01][0-9]|2[0-3]):([0-5][0-9]):([0-5][0-9])(?:\\.([0-9]+))?|(24:00:00(?:\\.0+)?))'
  + '(Z|[+-](?:(?:0[0-9]|1[0-3]):[0-5][0-9]|14:00))?$'
);

/** The parts of a valid XML Schema 1.1 `dateTime` string. */
type XsdDateTimeParts = {
  year: bigint;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
  /** The digits of the fraction of a second, or the empty string if there is no fraction. */
  fraction: string;
  timezone?: string;
};

/**
 * Returns true if the year is a leap year of the proleptic Gregorian calendar. Year 0 (1 BCE)
 * is a leap year. The function reads only the last 4 digits of the year text: 10000 is a
 * multiple of 400, so these digits give the same result as the full year. Thus a year above
 * `Number.MAX_SAFE_INTEGER` gets the correct result.
 * @param {string} year The year text: 4 or more digits, with an optional `-` before them.
 * @returns {boolean} True for a leap year.
 */
function isLeapYear(year: string): boolean {
  const lastDigits = Number(year.slice(-4));
  return (lastDigits % 4 === 0 && lastDigits % 100 !== 0) || lastDigits % 400 === 0;
}

/**
 * Divide two integers and round the result down (toward negative infinity). BigInt division
 * rounds toward zero.
 * @param {bigint} dividend The dividend.
 * @param {bigint} divisor The divisor, larger than zero.
 * @returns {bigint} The quotient, rounded down.
 */
function floorDivide(dividend: bigint, divisor: bigint): bigint {
  const quotient = dividend / divisor;
  return dividend % divisor < 0n ? quotient - 1n : quotient;
}

/**
 * Parse an XML Schema 1.1 `dateTime` string into its parts.
 * @param {unknown} value The value to parse.
 * @returns {XsdDateTimeParts | undefined} The parts, or `undefined` if the value is not a valid
 * `dateTime` string.
 */
function xsdDateTimeParts(value: unknown): XsdDateTimeParts | undefined {
  if(typeof value !== 'string') return undefined;
  const match = XSD_DATE_TIME.exec(value);
  if(!match) return undefined;
  const [, y, mo, d, h, mi, s, fraction, endOfDay, timezone] = match;
  const month = Number(mo);
  const day = Number(d);
  const daysInMonth = [31, isLeapYear(y) ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  if(day > daysInMonth[month - 1]) return undefined;
  return {
    year     : BigInt(y),
    month,
    day,
    hour     : endOfDay === undefined ? Number(h) : 24,
    minute   : endOfDay === undefined ? Number(mi) : 0,
    second   : endOfDay === undefined ? Number(s) : 0,
    fraction : fraction ?? '',
    timezone
  };
}

/**
 * The number of days from 1970-01-01 to a date of the proleptic Gregorian calendar, for each
 * year (the days_from_civil algorithm of Howard Hinnant).
 * @param {bigint} year The year (0 is 1 BCE).
 * @param {number} month The month, 1 to 12.
 * @param {number} day The day of the month.
 * @returns {bigint} The number of days; negative before 1970-01-01.
 */
function daysFromCivil(year: bigint, month: number, day: number): bigint {
  const y = month <= 2 ? year - 1n : year;
  const era = floorDivide(y, 400n);
  const yearOfEra = Number(y - era * 400n);
  const dayOfYear = Math.floor((153 * (month > 2 ? month - 3 : month + 9) + 2) / 5) + day - 1;
  const dayOfEra = yearOfEra * 365 + Math.floor(yearOfEra / 4) - Math.floor(yearOfEra / 100) + dayOfYear;
  return era * 146_097n + BigInt(dayOfEra - 719_468);
}

/**
 * The exact number of whole milliseconds from the Unix epoch to the instant of the parts. The
 * fraction digits after the third are not in the result. A value with no timezone is read as UTC.
 * @param {XsdDateTimeParts} parts The parts of a valid `dateTime` string.
 * @returns {bigint} The milliseconds; negative before the Unix epoch.
 */
function epochMilliseconds(parts: XsdDateTimeParts): bigint {
  const { year, month, day, hour, minute, second, fraction, timezone } = parts;
  const millisecond = Number(fraction.slice(0, 3).padEnd(3, '0'));
  let ms = daysFromCivil(year, month, day) * 86_400_000n
    + BigInt(hour * 3_600_000 + minute * 60_000 + second * 1_000 + millisecond);
  if(timezone !== undefined && timezone !== 'Z') {
    const sign = timezone.startsWith('-') ? -1 : 1;
    const offsetMinutes = Number(timezone.slice(1, 3)) * 60 + Number(timezone.slice(4, 6));
    ms -= BigInt(sign * offsetMinutes * 60_000);
  }
  return ms;
}

/**
 * Utility class for date-related operations.
 * @name DateUtils
 * @class DateUtils
 */
export class DateUtils {
  /**
   * Render an ISO 8601 UTC timestamp without fractional seconds.
   * @param {Date} [date=new Date()] - The date to format.
   * @returns {string} The formatted date string.
   */
  static toISOStringNonFractional(date: Date = new Date()): string {
    const time = date.getTime();
    if (Number.isNaN(time)) {
      throw new MethodError(`Invalid date: ${date}`, 'INVALID_DATE');
    }
    return date.toISOString().replace(/\.\d{3}Z$/, 'Z');
  }

  /**
   * Unix timestamp in seconds (integer).
   * @param {Date} [date=new Date()] - The date to convert.
   * @returns {number} The Unix timestamp in seconds.
   */
  static toUnixSeconds(date: Date = new Date()): number {
    const time = date.getTime();
    if (Number.isNaN(time)) {
      throw new MethodError(`Invalid date: ${date}`, 'INVALID_DATE');
    }
    return Math.floor(date.getTime() / 1000);
  }

  /**
   * Parse a date string into a Date object.
   * @param {string} dateString - The date string to parse.
   * @returns {Date} The parsed Date, or Date(0) (Unix epoch) if the string is invalid.
   */
  static dateStringToTimestamp(dateString: string): Date {
    const date = new Date(dateString);
    if (Number.isNaN(date.getTime())) {
      return new Date(0);
    }
    return date;
  }

  /**
   * Convert a blocktime (Unix timestamp in seconds) to a Date object.
   * @param {number} blocktime - The blocktime in seconds.
   * @returns {Date} The corresponding Date object.
   */
  static blocktimeToTimestamp(blocktime: number): Date {
    return new Date(blocktime * 1000);
  }

  /**
   * Returns true if the value is an XML Schema 1.1 `dateTime` string: it matches the
   * `dateTimeLexicalRep` regular expression of
   * {@link https://www.w3.org/TR/xmlschema11-2/#dateTime | XML Schema 1.1 Part 2, dateTime}, and
   * the day exists in its month. The timezone is optional. The year has 4 or more digits, and a
   * year with more than 4 digits does not start with `0`. Thus `0000` (1 BCE) and `10000` are
   * valid years, and `01000` is not.
   * @param {unknown} value The value to check.
   * @returns {boolean} True if the value is a valid `dateTime` string.
   */
  static isValidXsdDateTime(value: unknown): boolean {
    return xsdDateTimeParts(value) !== undefined;
  }

  /**
   * Returns true if the value is an XML Schema 1.1 `dateTimeStamp` string: a valid `dateTime`
   * string with a timezone (`Z` or an offset).
   * @param {unknown} value The value to check.
   * @returns {boolean} True if the value is a valid `dateTimeStamp` string.
   */
  static isValidXsdDateTimeStamp(value: unknown): value is string {
    return xsdDateTimeParts(value)?.timezone !== undefined;
  }

  /**
   * Convert an XML Schema 1.1 `dateTime` string to milliseconds since the Unix epoch. The
   * function accepts each year, also a year above 9999 or below 0000, where `Date.parse` gives
   * `NaN`. A value with no timezone is read as UTC. The function uses only the first 3 digits
   * of a fraction of a second, as `Date.parse` does.
   *
   * The function calculates the exact value as a BigInt, and then converts it to a number. If
   * the absolute value is above `Number.MAX_SAFE_INTEGER` (about 285000 years from 1970), the
   * conversion rounds it, so two instants can give the same number. The conversion does not
   * change the order: if instant a is before instant b, the result of a is not larger than the
   * result of b. For a year with more than about 300 digits, the result is `Infinity` or
   * `-Infinity`. For an exact comparison, use {@link DateUtils.compareXsdDateTime}.
   * @param {unknown} value The `dateTime` string.
   * @returns {number | undefined} The milliseconds since the Unix epoch, or `undefined` if the
   * value is not a valid `dateTime` string.
   */
  static xsdDateTimeToEpochMs(value: unknown): number | undefined {
    const parts = xsdDateTimeParts(value);
    return parts === undefined ? undefined : Number(epochMilliseconds(parts));
  }

  /**
   * Compare the instants of two XML Schema 1.1 `dateTime` strings. The comparison is exact: it
   * uses each year and each digit of a fraction of a second. A value with no timezone is read as
   * UTC, as in {@link DateUtils.xsdDateTimeToEpochMs}. Thus `2023-01-01T01:00:00+01:00` and
   * `2023-01-01T00:00:00Z` are equal, and `24:00:00` is equal to `00:00:00` of the next day.
   * @param {unknown} a The first `dateTime` string.
   * @param {unknown} b The second `dateTime` string.
   * @returns {-1 | 0 | 1 | undefined} `-1` if a is before b, `0` if a and b are the same instant,
   * `1` if a is after b, or `undefined` if a value is not a valid `dateTime` string.
   */
  static compareXsdDateTime(a: unknown, b: unknown): -1 | 0 | 1 | undefined {
    const partsA = xsdDateTimeParts(a);
    const partsB = xsdDateTimeParts(b);
    if(partsA === undefined || partsB === undefined) return undefined;
    const msA = epochMilliseconds(partsA);
    const msB = epochMilliseconds(partsB);
    if(msA !== msB) return msA < msB ? -1 : 1;
    // The digits after the third, with no trailing zeros: the text order is the number order.
    const restA = partsA.fraction.slice(3).replace(/0+$/, '');
    const restB = partsB.fraction.slice(3).replace(/0+$/, '');
    if(restA === restB) return 0;
    return restA < restB ? -1 : 1;
  }
}

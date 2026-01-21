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
      throw new Error(`Invalid date: ${date}`);
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
      throw new Error(`Invalid date: ${date}`);
    }
    return Math.floor(date.getTime() / 1000);
  }

  /**
   * Validate if a string is a valid UTC date string.
   * @param {string} dateString - The date string to validate.
   * @returns {boolean} True if valid, otherwise false.
   * @throws {Error} If the date string is invalid.
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
   * Validates an XMLSCHEMA11-2 dateTime string.
   * Format: [-]YYYY-MM-DDThh:mm:ss[.fractional][Z|(+|-)hh:mm]
   *
   * @see https://www.w3.org/TR/xmlschema11-2/#dateTime
   */
  static isValidXsdDateTime(value?: string): boolean {
    // Empty or undefined value is not a valid dateTime
    if(!value) return false;

    // Regex for XML Schema dateTime:
    // - Optional leading minus for BCE years
    // - Year: 4+ digits
    // - Month: 01-12
    // - Day: 01-31 (further validated below)
    // - T separator
    // - Hour: 00-23 (24:00:00 is valid end-of-day per spec)
    // - Minute: 00-59
    // - Second: 00-59 (with optional fractional part)
    // - Timezone: Z or (+|-)hh:mm
    const xsdDateTimeRegex =
        /^-?(\d{4,})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(\.\d+)?(Z|[+-]\d{2}:\d{2})?$/;

    const match = value.match(xsdDateTimeRegex);
    if (!match) return false;

    const [, y, m, d, H, M, S, , tz] = match;

    const year = parseInt(y, 10);
    const month = parseInt(m, 10);
    const day = parseInt(d, 10);
    const hour = parseInt(H, 10);
    const minute = parseInt(M, 10);
    const second = parseInt(S, 10);

    // Year 0000 is not valid in XML Schema (no year zero)
    if (year === 0) return false;

    // Month: 1-12
    if (month < 1 || month > 12) return false;

    // Day: validate against month (and leap year for February)
    const daysInMonth = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
    const isLeapYear = (year % 4 === 0 && year % 100 !== 0) || (year % 400 === 0);
    const maxDay = month === 2 && isLeapYear ? 29 : daysInMonth[month - 1];
    if (day < 1 || day > maxDay) return false;

    // Hour: 00-23, or 24:00:00 exactly (end-of-day)
    if (hour === 24) {
      if (minute !== 0 || second !== 0) return false;
    } else if (hour > 23) {
      return false;
    }

    // Minute: 00-59
    if (minute > 59) return false;

    // Second: 00-59 (leap second 60 is debatable; XML Schema doesn't explicitly allow it)
    if (second > 59) return false;

    // Validate timezone offset if present
    if (tz && tz !== 'Z') {
      const tzMatch = tz.match(/^[+-](\d{2}):(\d{2})$/);
      if (tzMatch) {
        const tzHour = parseInt(tzMatch[1], 10);
        const tzMin = parseInt(tzMatch[2], 10);
        if (tzHour > 14 || (tzHour === 14 && tzMin !== 0) || tzMin > 59) {
          return false;
        }
      }
    }

    return true;
  }
}
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
  static getUTCDateTime(date: Date = new Date()): string {
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
}
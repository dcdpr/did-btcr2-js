/**
 * Returns the date-time string in UTC format (YYYY-MM-DDTHH:mm:ssZ)
 * @param {Date} date - The date object to convert.
 * @returns {string} The UTC date-time string.
 */
export function getUTCDateTime(date: Date): string {
  return `${date.toISOString().slice(0, -5)}Z`;
}

/**
 * Converts a Date object to a Unix timestamp (milliseconds since epoch).
 * @param {Date} date - The date object to convert.
 * @returns {number} The Unix timestamp.
 * @throws {Error} If the date is invalid.
 */
export function toUnix(date: Date): number {
  const time = date.getTime();
  if (Number.isNaN(time)) {
    throw new Error(`Invalid date: "${date}"`);
  }
  return time;
}

/**
 * Utility class string-related operations.
 * @name StringUtils
 * @class StringUtils
 */
export class StringUtils {
  /**
   * Escape special characters in a string for use in a regular expression.
   * @param {string} value - The string to escape.
   * @returns {string} The escaped string.
   */
  static escapeRegExp(value: string): string {
    return value.replace(/[-/\\^$*+?.()|[\]{}]/g, '\\$&');
  }

  /**
   * Convert a camelCase string to snake_case.
   * @param {string} value - The camelCase string to convert.
   * @returns {string} The converted snake_case string.
   */
  static toSnake(value: string): string {
    return value
      .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
      .toLowerCase();
  }

  /**
   * Convert a string to SNAKE_SCREAMING_CASE.
   * @param {string} value - The string to convert.
   * @returns {string} The converted SNAKE_SCREAMING_CASE string.
   */
  static toSnakeScream(value: string): string {
    return this.toSnake(value).toUpperCase();
  }

  /**
   * Remove the last character from a string.
   * @param {string} value - The string to chop.
   * @returns {string} The chopped string.
   */
  static chop(value: string): string {
    return value.length > 0 ? value.slice(0, -1) : '';
  }

  /**
   * Replace the end of a string if it matches a given pattern.
   * @param {string} value - The string to modify.
   * @param {string | RegExp} pattern - The pattern to match at the end of the string.
   * @param {string} [replacement=''] - The replacement string.
   * @returns {string} The modified string.
   */
  static replaceEnd(value: string, pattern: string | RegExp, replacement: string = ''): string {
    const regex = pattern instanceof RegExp
      ? new RegExp(pattern.source.endsWith('$') ? pattern.source : `${pattern.source}$`, pattern.flags.replace(/g/g, ''))
      : new RegExp(`${this.escapeRegExp(pattern)}$`);

    return value.replace(regex, replacement);
  }
}
/**
 * Utility class for set operations.
 * @name SetUtils
 * @class SetUtils
 */
export class SetUtils {
  /**
   * Compute the set difference without mutating the inputs.
   * @param {Set<T>} left - The left set.
   * @param {Set<T>} right - The right set.
   * @returns {Set<T>} A new set containing elements in `left` that are not in `right`.
   */
  static difference<T>(left: Set<T>, right: Set<T>): Set<T> {
    const result = new Set<T>();
    for (const value of left) {
      if (!right.has(value)) {
        result.add(value);
      }
    }
    return result;
  }

}
import { JSONObject, Prototyped, Unprototyped } from '../types.js';

/**
 * Options for cloning JSON values.
 */
type CloneOptions = {
  stripPrototypes?: boolean;
  transform?: (value: any) => any;
};

/**
 * Utilities for working with JSON data.
 * @name JSONUtils
 * @class JSONUtils
 */
export class JSONUtils {
  /**
   * Check if a value is a JSON object (not an array, not null, and has Object prototype).
   * @param {unknown} value - The value to check.
   * @returns {boolean} True if the value is a JSON object.
   */
  static isObject(value: unknown): value is JSONObject {
    if (value === null || typeof value !== 'object') return false;
    if (Array.isArray(value)) return false;
    const proto = Object.getPrototypeOf(value);
    return proto === Object.prototype || proto === null;
  }

  /**
   * Check if a value is a parsable JSON string.
   * @param {unknown} value - The value to check.
   * @returns {boolean} True if the value is a parsable JSON string.
   */
  static isParsable(value: unknown): value is string {
    if (typeof value !== 'string') return false;
    try {
      JSON.parse(value);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Check if a value is an unprototyped object (i.e., Object.create(null)).
   * @param {unknown} value - The value to check.
   * @returns {boolean} True if the value is an unprototyped object.
   */
  static isUnprototyped(value: unknown): value is Unprototyped {
    if (value === null || typeof value !== 'object') return false;
    return Object.getPrototypeOf(value) === null;
  }

  /**
   * Normalize a JSON value by stripping prototypes from all objects within it.
   * @param {T} value - The JSON value to normalize.
   * @returns {Prototyped} The normalized JSON value.
   */
  static normalize<T extends JSONObject | Array<any>>(value: T): Prototyped {
    return this.cloneInternal(value, { stripPrototypes: true });
  }

  /**
   * Shallow copy of a JSON object.
   * @param {T extends JSONObject} value - The JSON object to copy.
   * @returns {T} The copied JSON object.
   */
  static copy<T extends JSONObject>(value: T): T {
    return { ...value };
  }

  /**
   * Deep clone a JSON value.
   * @param {T} value - The JSON value to clone.
   * @returns {T} The cloned JSON value.
   */
  static clone<T>(value: T): T {
    if (typeof structuredClone === 'function') {
      return structuredClone(value);
    }
    return this.cloneInternal(value);
  }

  /**
   * Deep clone a JSON value, replacing strings that match a pattern.
   * @param {T} value - The JSON value to clone.
   * @param {RegExp} pattern - The regex pattern to match strings.
   * @param {string} replacement - The replacement string.
   * @returns {T} The cloned JSON value with replacements.
   */
  static cloneReplace<T>(value: T, pattern: RegExp, replacement: string): T {
    return this.cloneInternal(value, {
      transform : (candidate) => typeof candidate === 'string'
        ? candidate.replace(pattern, replacement)
        : candidate
    });
  }

  /**
   * Deep equality check between two values.
   * @param {unknown} a - The first value to compare.
   * @param {unknown} b - The second value to compare.
   * @param {WeakMap<object, object>} seen - A WeakMap to track seen object pairs for circular reference detection.
   * @returns {boolean} True if the values are deeply equal.
   */
  static deepEqual(
    a: unknown,
    b: unknown,
    seen: WeakMap<object, object> = new WeakMap<object, object>(),
    depth: number = 0
  ): boolean {
    if (depth > 1024) {
      throw new Error('Maximum comparison depth exceeded');
    }
    if (Object.is(a, b)) return true;

    if (typeof a !== typeof b) return false;
    if (a === null || b === null) return false;
    if (typeof a !== 'object') return false;

    if (seen.get(a as object) === b) return true;
    seen.set(a as object, b as object);

    if (ArrayBuffer.isView(a) && ArrayBuffer.isView(b)) {
      const viewA = new Uint8Array((a as ArrayBufferView).buffer, (a as ArrayBufferView).byteOffset, (a as ArrayBufferView).byteLength);
      const viewB = new Uint8Array((b as ArrayBufferView).buffer, (b as ArrayBufferView).byteOffset, (b as ArrayBufferView).byteLength);
      if (viewA.byteLength !== viewB.byteLength) return false;
      for (let i = 0; i < viewA.byteLength; i++) {
        if (viewA[i] !== viewB[i]) return false;
      }
      return true;
    }

    if (a instanceof Date && b instanceof Date) {
      return a.getTime() === b.getTime();
    }

    if (a instanceof Set && b instanceof Set) {
      if (a.size !== b.size) return false;
      for (const itemA of a) {
        let matched = false;
        for (const itemB of b) {
          if (this.deepEqual(itemA, itemB, seen, depth + 1)) {
            matched = true;
            break;
          }
        }
        if (!matched) return false;
      }
      return true;
    }

    if (a instanceof Map && b instanceof Map) {
      if (a.size !== b.size) return false;
      for (const [keyA, valueA] of a) {
        let matched = false;
        if (b.has(keyA)) {
          matched = this.deepEqual(valueA, b.get(keyA), seen, depth + 1);
        } else {
          for (const [keyB, valueB] of b) {
            if (
              this.deepEqual(keyA, keyB, seen, depth + 1)
              && this.deepEqual(valueA, valueB, seen, depth + 1)
            ) {
              matched = true;
              break;
            }
          }
        }
        if (!matched) return false;
      }
      return true;
    }

    if (Array.isArray(a) && Array.isArray(b)) {
      if (a.length !== b.length) return false;
      for (let i = 0; i < a.length; i++) {
        if (!this.deepEqual(a[i], b[i], seen, depth + 1)) return false;
      }
      return true;
    }

    const keysA = Object.keys(a as object);
    const keysB = Object.keys(b as object);
    if (keysA.length !== keysB.length) return false;

    for (const key of keysA) {
      if (!Object.prototype.hasOwnProperty.call(b, key)) return false;
      if (!this.deepEqual((a as any)[key], (b as any)[key], seen, depth + 1)) return false;
    }

    return true;
  }

  /**
   * Delete specified keys from a JSON value.
   * @param {T} value - The JSON value to process.
   * @param {Array<string | number | symbol>} keys - The keys to delete.
   * @returns {T} The JSON value with specified keys deleted.
   */
  static deleteKeys<T>(value: T, keys: Array<string | number | symbol>): T {
    const keySet = new Set(keys.map(key => typeof key === 'number' ? key.toString() : key));

    const walk = (candidate: any): any => {
      if (Array.isArray(candidate)) {
        return candidate.map(item => walk(item));
      }

      if (candidate && typeof candidate === 'object') {
        const result: any = Array.isArray(candidate) ? [] : {};
        for (const key of Object.keys(candidate)) {
          if (keySet.has(key)) continue;
          result[key] = walk(candidate[key]);
        }
        return result;
      }

      return candidate;
    };

    return walk(value);
  }

  /**
   * Sanitize a JSON value by removing undefined values from objects and arrays.
   * @param {T} value - The JSON value to sanitize.
   * @returns {T} The sanitized JSON value.
   */
  static sanitize<T>(value: T): T {
    const walk = (candidate: any): any => {
      if (Array.isArray(candidate)) {
        return candidate.map(item => walk(item));
      }

      if (candidate && typeof candidate === 'object') {
        const result: any = {};
        for (const [key, val] of Object.entries(candidate)) {
          const sanitized = walk(val);
          if (sanitized !== undefined) {
            result[key] = sanitized;
          }
        }
        return result;
      }

      return candidate;
    };

    return walk(value);
  }

  /**
   * Internal function to clone JSON values with options.
   * @param {T} value - The value to clone.
   * @param {CloneOptions} options - The cloning options.
   * @param {WeakMap<object, any>} seen - A WeakMap to track seen objects for circular reference detection.
   * @returns {any} The cloned value.
   */
  static cloneInternal<T>(
    value: T,
    options: CloneOptions = {},
    seen: WeakMap<object, any> = new WeakMap<object, any>(),
    depth: number = 0
  ): any {
    if (depth > 1024) {
      throw new Error('Maximum clone depth exceeded');
    }
    const transformed = options.transform ? options.transform(value) : value;
    if (transformed !== value) return transformed;

    if (typeof value !== 'object' || value === null) {
      return transformed;
    }

    if (seen.has(value as object)) {
      throw new Error('Cannot clone circular structure');
    }

    // Handle arrays and typed arrays
    if (Array.isArray(value)) {
      const clone: any[] = [];
      seen.set(value as object, clone);
      for (const item of value) {
        clone.push(this.cloneInternal(item, options, seen, depth + 1));
      }
      return clone;
    }

    // Handle ArrayBuffer views (typed arrays, DataView)
    if (ArrayBuffer.isView(value)) {
      if (value instanceof DataView) {
        return new DataView(
          value.buffer.slice(value.byteOffset, value.byteOffset + value.byteLength)
        );
      }

      if (typeof (value as any).slice === 'function') {
        return (value as any).slice();
      }
    }

    if (value instanceof Date) {
      return new Date(value.getTime());
    }

    const result: any = options.stripPrototypes ? {} : Object.create(Object.getPrototypeOf(value));
    seen.set(value as object, result);

    for (const key of Object.keys(value as object)) {
      result[key] = this.cloneInternal((value as any)[key], options, seen, depth + 1);
    }

    return result;
  }
}

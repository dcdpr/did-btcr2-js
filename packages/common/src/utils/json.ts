import type { Maybe, Prototyped, Unprototyped } from '../types.js';

/**
 * Checks if a value is object-like (i.e., not null and of type 'object').
 * @param {unknown} v - The value to check.
 * @returns {boolean} True if the value is object-like, false otherwise.
 */
export function isObjectLike(v: unknown): v is object {
  return v !== null && typeof v === 'object';
}

/**
 * Checks if a value is an object with a null prototype.
 * @param {unknown} v - The value to check.
 * @returns {boolean} True if the value is an object with a null prototype, false otherwise.
 */
export function isNullProtoObject(v: unknown): v is Unprototyped {
  return isObjectLike(v) && Object.getPrototypeOf(v) === null;
}

/**
 * Checks if a value is a JSON value with a null prototype.
 * @param {unknown} v - The value to check.
 * @returns {boolean} True if the value is a JSON value with a null prototype, false otherwise.
 */
export function isNullProtoJsonValue(v: unknown): boolean {
  if (!isObjectLike(v)) return true;

  if (Array.isArray(v)) {
    return v.every(isNullProtoJsonValue);
  }

  if (!isNullProtoObject(v)) return false;

  for (const key of Object.keys(v)) {
    if (!isNullProtoJsonValue(v[key])) return false;
  }
  return true;
}

/**
 * Checks if a string is parsable as JSON.
 * @param {Maybe<string>} v - The string to check.
 * @returns {boolean} True if the string is parsable as JSON, false otherwise.
 */
export function parsable(v: Maybe<string>): boolean {
  if (typeof v !== 'string') return false;
  try {
    JSON.parse(v);
    return true;
  } catch {
    return false;
  }
}

/**
 * Checks if a value is stringifiable as JSON.
 * @param {unknown} v - The value to check.
 * @returns {boolean} True if the value is stringifiable as JSON, false otherwise.
 */
export function stringifiable(v: unknown): boolean {
  try {
    JSON.stringify(v);
    return true;
  } catch {
    return false;
  }
}

/**
 * Normalizes a value by performing a JSON round-trip.
 * @param {Maybe<Unprototyped>} v - The value to normalize.
 * @returns {Prototyped} The normalized value.
 * @throws {Error} If the value cannot be normalized.
 */
export function normalize(v: Maybe<Unprototyped>): Prototyped {
  try {
    return JSON.parse(JSON.stringify(v));
  } catch {
    throw new Error('Value cannot be normalized via JSON round-trip');
  }
}

/**
 * Clones a value using structured cloning if available, otherwise falls back to JSON methods.
 * @param {T} v - The value to clone.
 * @returns {T} The cloned value.
 */
export function clone<T>(v: T): T {
  if (typeof (globalThis as any).structuredClone === 'function') {
    return (globalThis as any).structuredClone(v);
  }
  return JSON.parse(JSON.stringify(v)) as T;
}

/**
 * Clones a value and replaces occurrences of a pattern in string values.
 * @param {T} v - The value to clone.
 * @param {RegExp} e - The regular expression pattern to replace.
 * @param {string} r - The replacement string.
 * @returns {T} The cloned value with replacements made.
 */
export function cloneReplace<T>(v: T, e: RegExp, r: string): T {
  return JSON.parse(JSON.stringify(v).replaceAll(e, r)) as T;
}

/**
 * Deeply compares two values for equality.
 * @param {unknown} a - The first value to compare.
 * @param {unknown} b - The second value to compare.
 * @returns {boolean} True if the values are deeply equal, false otherwise.
 */
export function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;

  if (typeof a === 'number' && typeof b === 'number') {
    if (Number.isNaN(a) && Number.isNaN(b)) return true;
  }

  if (a === null || b === null) return false;
  if (typeof a !== 'object' || typeof b !== 'object') return false;

  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b)) return false;
    if (a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) {
      if (!deepEqual(a[i], b[i])) return false;
    }
    return true;
  }

  if (a instanceof Date || b instanceof Date) {
    if (!(a instanceof Date) || !(b instanceof Date)) return false;
    return a.getTime() === b.getTime();
  }

  if (ArrayBuffer.isView(a) || ArrayBuffer.isView(b)) {
    if (!ArrayBuffer.isView(a) || !ArrayBuffer.isView(b)) return false;
    if (a.byteLength !== b.byteLength) return false;
    const ua = new Uint8Array(a.buffer, a.byteOffset, a.byteLength);
    const ub = new Uint8Array(b.buffer, b.byteOffset, b.byteLength);
    for (let i = 0; i < ua.length; i++) if (ua[i] !== ub[i]) return false;
    return true;
  }

  const keysA = Object.keys(a);
  const keysB = Object.keys(b);
  if (keysA.length !== keysB.length) return false;

  for (const k of keysA) {
    if (!Object.prototype.hasOwnProperty.call(b, k)) return false;
    if (!deepEqual((a as any)[k], (b as any)[k])) return false;
  }
  return true;
}

export function sanitizeShallow<T extends Record<PropertyKey, any>>(o: T): T {
  for (const k of Object.keys(o)) {
    if (o[k] === undefined) delete o[k];
  }
  return o;
}

// Fix: correct deep key deletion (no key shadowing, deletes keys at all depths)
export function deleteKeysDeep<T>(value: T, keys: ReadonlyArray<PropertyKey>): T {
  if (value === null || typeof value !== 'object') return value;

  if (Array.isArray(value)) {
    for (let i = 0; i < value.length; i++) {
      value[i] = deleteKeysDeep(value[i], keys) as any;
    }
    return value;
  }

  for (const key of keys) {
    // @ts-expect-error index signature
    delete value[key];
  }

  for (const k of Object.keys(value)) {
    // @ts-expect-error index signature
    value[k] = deleteKeysDeep(value[k], keys);
  }

  return value;
}


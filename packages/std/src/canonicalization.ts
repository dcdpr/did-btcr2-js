import { sha256 } from '@noble/hashes/sha2';
import { base58, base64urlnopad, hex } from '@scure/base';
import { CanonicalizationError } from './errors.js';
import type { HashBytes } from './types.js';

export type CanonicalizationAlgorithm = 'jcs' | 'rdfc';
export type CanonicalizationEncoding = 'hex' | 'base58' | 'base64urlnopad';

export interface CanonicalizationOptions {
  algorithm?: CanonicalizationAlgorithm;
  encoding?: CanonicalizationEncoding;
}

const SUPPORTED_ALGORITHMS: ReadonlySet<CanonicalizationAlgorithm> = new Set(['jcs']);
const SUPPORTED_ENCODINGS: ReadonlySet<CanonicalizationEncoding> = new Set(['hex', 'base58', 'base64urlnopad']);

/**
 * Normalizes and validates the canonicalization algorithm.
 * @param {CanonicalizationAlgorithm} algorithm - The algorithm to normalize.
 * @returns {CanonicalizationAlgorithm} The normalized algorithm.
 * @throws {CanonicalizationError} If the algorithm is not supported.
 */
function normalizeAlgorithm(algorithm: CanonicalizationAlgorithm): CanonicalizationAlgorithm {
  const lower = algorithm.toLowerCase();
  if (!SUPPORTED_ALGORITHMS.has(lower as CanonicalizationAlgorithm)) {
    throw new CanonicalizationError(`Unsupported algorithm: ${algorithm}`, 'ALGORITHM_ERROR');
  }
  return lower as CanonicalizationAlgorithm;
}

/**
 * Normalizes and validates the canonicalization encoding.
 * @param {CanonicalizationEncoding} encoding - The encoding to normalize.
 * @returns {CanonicalizationEncoding} The normalized encoding.
 * @throws {CanonicalizationError} If the encoding is not supported.
 */
function normalizeEncoding(encoding: CanonicalizationEncoding): CanonicalizationEncoding {
  const lower = encoding.toLowerCase();
  if (!SUPPORTED_ENCODINGS.has(lower as CanonicalizationEncoding)) {
    throw new CanonicalizationError(`Unsupported encoding: ${encoding}`, 'ENCODING_ERROR');
  }
  return lower as CanonicalizationEncoding;
}

/** Matches a lone surrogate. With the `u` flag, a surrogate pair is one code point and does not match. */
const LONE_SURROGATE = /\p{Cs}/u;

/**
 * Gives the RFC 6901 reference token of a member name.
 * @param {string} name - The member name.
 * @returns {string} The name with each `~` as `~0` and each `/` as `~1`.
 */
function pointerToken(name: string): string {
  return name.replace(/~/g, '~0').replace(/\//g, '~1');
}

/**
 * Gives a JSON Pointer that is safe to print and to serialize again. Each lone surrogate becomes
 * its `\uXXXX` escape text, so an error that reports a lone surrogate does not hold one.
 * @param {string} path - The JSON Pointer of a value.
 * @returns {string} The pointer with no lone surrogate.
 */
function printablePath(path: string): string {
  return path.replace(/\p{Cs}/gu, (unit) => `\\u${unit.charCodeAt(0).toString(16).padStart(4, '0')}`);
}

/**
 * Names the location of a value in an error message.
 * @param {string} path - The printable JSON Pointer of the value.
 * @returns {string} The pointer, or 'the top level' for the empty pointer.
 */
function location(path: string): string {
  return path === '' ? 'the top level' : path;
}

/**
 * Tells if a value has a [[NumberData]] internal slot (a Number object). `Number.prototype.valueOf`
 * reads that slot and not `Symbol.toStringTag`, so a Number object from another realm also passes.
 * @param {object} value - The object to check.
 * @returns {boolean} True if the value is a Number object.
 */
function isNumberObject(value: object): boolean {
  try {
    Number.prototype.valueOf.call(value);
    return true;
  } catch {
    return false;
  }
}

/**
 * Tells if a value has a [[BigIntData]] internal slot (a BigInt object).
 * @param {object} value - The object to check.
 * @returns {boolean} True if the value is a BigInt object.
 */
function isBigIntObject(value: object): boolean {
  try {
    BigInt.prototype.valueOf.call(value);
    return true;
  } catch {
    return false;
  }
}

/**
 * Makes the error for a NaN, an Infinity, or a -Infinity (RFC 8785 section 3.2.2.3).
 * @param {number} value - The number.
 * @param {string} path - The JSON Pointer of the number.
 * @returns {CanonicalizationError} The error, type `NON_FINITE_NUMBER`.
 */
function nonFiniteNumberError(value: number, path: string): CanonicalizationError {
  const shown = printablePath(path);
  return new CanonicalizationError(
    `Cannot canonicalize: the number ${value} at ${location(shown)} is not a JSON number (RFC 8785 section 3.2.2.3).`,
    'NON_FINITE_NUMBER',
    { path: shown }
  );
}

/**
 * Makes the error for a BigInt or a BigInt object.
 * @param {string} path - The JSON Pointer of the value.
 * @returns {CanonicalizationError} The error, type `NOT_JSON_DATA`.
 */
function bigIntError(path: string): CanonicalizationError {
  const shown = printablePath(path);
  return new CanonicalizationError(
    `Cannot canonicalize: the value at ${location(shown)} is a BigInt, not a JSON number.`,
    'NOT_JSON_DATA',
    { path: shown }
  );
}

/**
 * Makes the JSON form of a value: the result of `JSON.parse(JSON.stringify(value))`. The
 * round trip calls each `toJSON` method, so a class instance gives the same form as a plain
 * object. A replacer checks each value after its `toJSON` method, because `JSON.stringify`
 * writes NaN and Infinity as null. The replacer checks the values in input order.
 * @param {unknown} value - The value.
 * @returns {unknown} The JSON form: null, a boolean, a number, a string, an array, or a plain object.
 * @throws {CanonicalizationError} `NON_FINITE_NUMBER` for NaN, Infinity, or -Infinity (also a Number
 * object); `NOT_JSON_DATA` for a BigInt (also a BigInt object), a cycle, or a top-level value with no
 * JSON form. An error from a `toJSON` method, a getter, a Proxy trap, or a `valueOf` method passes
 * through unchanged.
 */
function jsonForm(value: unknown): unknown {
  // The JSON Pointer of each object that the replacer returns. The root holder is not in the map.
  // JSON.stringify writes each position of the tree one time, so the pointer of an object that
  // holds the current value is a prefix of the pointer of the current holder.
  const paths = new WeakMap<object, string>();
  const text = JSON.stringify(value, function (this: object, key: string, member: unknown): unknown {
    const parent = paths.get(this);
    const path = parent === undefined ? '' : `${parent}/${pointerToken(key)}`;
    let result = member;
    if (typeof member === 'object' && member !== null) {
      if (isBigIntObject(member)) throw bigIntError(path);
      if (isNumberObject(member)) {
        // JSON.stringify calls ToNumber on a Number object. The replacer calls ToNumber one time
        // and gives the number, so the check and the output use the same number.
        result = +(member as unknown as number);
      } else {
        const seen = paths.get(member);
        if (parent !== undefined && seen !== undefined && (parent === seen || parent.startsWith(`${seen}/`))) {
          const shown = printablePath(path);
          throw new CanonicalizationError(
            `Cannot canonicalize: the value at ${location(shown)} is the object at ${location(printablePath(seen))}, which contains it (a cycle).`,
            'NOT_JSON_DATA',
            { path: shown }
          );
        }
        paths.set(member, path);
        return member;
      }
    }
    if (typeof result === 'number' && !Number.isFinite(result)) throw nonFiniteNumberError(result, path);
    if (typeof result === 'bigint') throw bigIntError(path);
    return result;
  });
  if (text === undefined) {
    throw new CanonicalizationError(
      'Cannot canonicalize: the value at the top level has no JSON form.',
      'NOT_JSON_DATA',
      { path: '' }
    );
  }
  return JSON.parse(text);
}

/**
 * Writes the JSON form of a value with the rules of RFC 8785 section 3.2. The function does
 * not read `toJSON`, so a data member with that name sorts like every other member.
 * @param {unknown} value - A JSON form from {@link jsonForm}.
 * @param {string} path - The JSON Pointer of the value.
 * @returns {string} The canonical JSON text.
 * @throws {CanonicalizationError} `LONE_SURROGATE` for a string or a member name with a lone
 * surrogate; `NON_FINITE_NUMBER` for a number that JSON.parse read as Infinity.
 */
function serializeJcs(value: unknown, path: string): string {
  if (value === null || typeof value === 'boolean') return JSON.stringify(value);
  if (typeof value === 'number') {
    // Raw JSON text such as 1e400 (JSON.rawJSON) passes the replacer and parses to Infinity.
    if (!Number.isFinite(value)) throw nonFiniteNumberError(value, path);
    // JSON.stringify writes a number with the ECMAScript rules of RFC 8785 section 3.2.2.3.
    return JSON.stringify(value);
  }
  if (typeof value === 'string') {
    if (LONE_SURROGATE.test(value)) {
      const shown = printablePath(path);
      throw new CanonicalizationError(
        `Cannot canonicalize: the string at ${location(shown)} has a lone surrogate (RFC 8785 section 3.2.2.2).`,
        'LONE_SURROGATE',
        { path: shown }
      );
    }
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((item, index) => serializeJcs(item, `${path}/${index}`)).join(',')}]`;
  }
  const object = value as Record<string, unknown>;
  // The default sort compares UTF-16 code units (RFC 8785 section 3.2.3).
  const members = Object.keys(object).sort().map((name) => {
    if (LONE_SURROGATE.test(name)) {
      // The message does not print the name, so the message has no lone surrogate.
      const shown = printablePath(path);
      throw new CanonicalizationError(
        `Cannot canonicalize: a member name in the object at ${location(shown)} has a lone surrogate (RFC 8785 section 3.2.2.2).`,
        'LONE_SURROGATE',
        { path: shown }
      );
    }
    return `${JSON.stringify(name)}:${serializeJcs(object[name], `${path}/${pointerToken(name)}`)}`;
  });
  return `{${members.join(',')}}`;
}

/**
 * Canonicalizes a JSON object using the specified algorithm.
 *
 * The `jcs` algorithm first makes the JSON form of the value (`JSON.stringify` calls each
 * `toJSON` method), then writes that form with the rules of RFC 8785. Every object sorts by
 * the UTF-16 code units of its member names, also an object with a data member named `toJSON`.
 *
 * The checks run in two passes. The first pass checks the numbers, the BigInt values, and the
 * cycles in input order. The second pass checks the strings, the member names, and the numbers
 * from raw JSON text in sorted order. The first error stops the canonicalization.
 *
 * @param {Record<any, any>} object - The object to canonicalize.
 * @param {CanonicalizationAlgorithm} [algorithm='jcs'] - The algorithm to use.
 * @returns {string} The canonicalized string.
 * @throws {CanonicalizationError} If the algorithm is not supported (`ALGORITHM_ERROR`), or if the
 * value has no JCS form: `NON_FINITE_NUMBER` (NaN, Infinity, or -Infinity), `LONE_SURROGATE`
 * (a string or a member name), or `NOT_JSON_DATA` (a BigInt, a cycle, or a top-level value with
 * no JSON form). For each of these three types, `data.path` gives the location of the value:
 * - The location is an RFC 6901 JSON Pointer into the JSON form, that is, after each `toJSON` method.
 * - For a member name with a lone surrogate, the location is the object that holds the name.
 * - Each lone surrogate in the location shows as `\uXXXX` text. Thus a location with a lone
 *   surrogate is not an exact JSON Pointer.
 *
 * An error from a `toJSON` method, a getter, a Proxy trap, or a `valueOf` method passes through
 * unchanged. A value with too many nested levels for the call stack also gives the error of the
 * JavaScript engine (a `RangeError` in V8).
 */
export function canonicalize(object: Record<any, any>, algorithm: CanonicalizationAlgorithm = 'jcs'): string {
  const normalized = normalizeAlgorithm(algorithm);
  switch (normalized) {
    case 'jcs':
      return serializeJcs(jsonForm(object), '');
    default:
      throw new CanonicalizationError(`Unsupported algorithm: ${algorithm}`, 'ALGORITHM_ERROR');
  }
}

/**
 * SHA-256 hashes a canonicalized string.
 *
 * @param {string} canonicalized - The canonicalized string to hash.
 * @returns {HashBytes} The SHA-256 hash bytes (Uint8Array).
 */
export function hash(canonicalized: string): HashBytes {
  return sha256(canonicalized);
}

/**
 * Encodes hash bytes using the specified encoding.
 *
 * @param {HashBytes} hashBytes - The hash bytes to encode.
 * @param {CanonicalizationEncoding} [encoding='base64urlnopad'] - The encoding format.
 * @returns {string} The encoded string.
 * @throws {CanonicalizationError} If the encoding is not supported.
 */
export function encode(hashBytes: HashBytes, encoding: CanonicalizationEncoding = 'base64urlnopad'): string {
  const normalized = normalizeEncoding(encoding);
  switch (normalized) {
    case 'hex':       return hex.encode(hashBytes);
    case 'base58':    return base58.encode(hashBytes);
    case 'base64urlnopad': return base64urlnopad.encode(hashBytes);
  }
}

/**
 * Decodes an encoded hash string back to bytes.
 *
 * @param {string} encoded - The encoded hash string.
 * @param {CanonicalizationEncoding} [encoding='base64urlnopad'] - The encoding format.
 * @returns {HashBytes} The decoded hash bytes.
 * @throws {CanonicalizationError} If the encoding is not supported.
 */
export function decode(encoded: string, encoding: CanonicalizationEncoding = 'base64urlnopad'): HashBytes {
  const normalized = normalizeEncoding(encoding);
  switch (normalized) {
    case 'hex':       return hex.decode(encoded);
    case 'base58':    return base58.decode(encoded);
    case 'base64urlnopad': return base64urlnopad.decode(encoded);
  }
}

/**
 * Implements {@link https://dcdpr.github.io/did-btcr2/algorithms.html#json-document-hashing | JSON Document Hashing}.
 *
 * Pipeline: Canonicalize (JCS) -> Hash (SHA-256) -> raw bytes.
 *
 * @param {Record<any, any>} object - The object to process.
 * @param {CanonicalizationAlgorithm} [algorithm='jcs'] - The canonicalization algorithm.
 * @returns {HashBytes} The raw SHA-256 hash bytes (Uint8Array).
 * @throws {CanonicalizationError} If the algorithm is not supported, or if the value has no
 * JCS form (see {@link canonicalize}).
 */
export function canonicalHashBytes(object: Record<any, any>, algorithm: CanonicalizationAlgorithm = 'jcs'): HashBytes {
  return hash(canonicalize(object, normalizeAlgorithm(algorithm)));
}

/**
 * Implements {@link https://dcdpr.github.io/did-btcr2/algorithms.html#json-document-hashing | JSON Document Hashing}.
 *
 * Full pipeline: Canonicalize (JCS) -> Hash (SHA-256) -> Encode.
 *
 * @param {Record<any, any>} object - The object to process.
 * @param {CanonicalizationOptions} [options] - Options for algorithm and encoding.
 * @returns {string} The encoded hash string.
 * @throws {CanonicalizationError} If the algorithm or the encoding is not supported, or if the
 * value has no JCS form (see {@link canonicalize}).
 */
export function canonicalHash(object: Record<any, any>, options?: CanonicalizationOptions): string {
  const algorithm = normalizeAlgorithm(options?.algorithm ?? 'jcs');
  const encoding = normalizeEncoding(options?.encoding ?? 'base64urlnopad');
  return encode(hash(canonicalize(object, algorithm)), encoding);
}

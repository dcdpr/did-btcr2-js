import {
  DidMethodError,
  FEATURE_NOT_SUPPORTED,
  INTERNAL_ERROR,
  INVALID_DID,
  INVALID_DID_DOCUMENT,
  INVALID_DID_UPDATE,
  INVALID_DID_URL,
  INVALID_OPTIONS,
  INVALID_SIGNAL_DATA,
  LATE_PUBLISHING,
  METHOD_NOT_SUPPORTED,
  MISSING_UPDATE_DATA,
  NOT_FOUND
} from '@did-btcr2/std';
import type { Logger, ResolutionError } from './types.js';

const noopFn = () => {};

/** @internal */
export const NOOP_LOGGER: Logger = {
  debug : noopFn,
  info  : noopFn,
  warn  : noopFn,
  error : noopFn,
};

/** @internal */
export function assertString(value: unknown, name: string): asserts value is string {
  if (typeof value !== 'string' || value.length === 0) {
    throw new Error(`${name} must be a non-empty string.`);
  }
}

/** @internal */
export function assertBytes(value: unknown, name: string): asserts value is Uint8Array {
  if (!(value instanceof Uint8Array) || value.length === 0) {
    throw new Error(`${name} must be a non-empty Uint8Array.`);
  }
}

/** @internal */
export function assertCompressedPubkey(value: unknown, name: string): asserts value is Uint8Array {
  assertBytes(value, name);
  if (value.length !== 33) {
    throw new Error(
      `${name} must be a 33-byte compressed public key, got ${value.length} bytes.`
    );
  }
}

/**
 * The message of the deepest meaningful error in a cause chain.
 *
 * Walks `err.cause` links (capped at 16 hops, cycle-safe) and returns the
 * message of the deepest link that has one. Rules, in order, at each link:
 *
 * - A string link is its own message.
 * - An object link with a non-empty string `message` contributes that message.
 * - An object link with an empty message but an `errors` array (an
 *   `AggregateError`, e.g. a Node fetch failure against a host with several
 *   addresses) contributes the first sub-error's message.
 * - A link with no usable message is skipped, so the nearest non-empty
 *   message above it in the chain wins.
 *
 * Never throws: throwing getters, null-prototype objects, and non-Error
 * values all degrade to `String(value)` or `'Unknown error'`.
 *
 * @param err The caught value whose root cause message to extract.
 * @returns A non-empty, human-readable message.
 */
export function rootCauseMessage(err: unknown): string {
  let current: unknown = err;
  let deepest = '';
  for (let hops = 0; hops < 16; hops++) {
    const message = messageOf(current);
    if (message !== '') deepest = message;
    let next: unknown;
    try {
      next = (current as { cause?: unknown } | null)?.cause;
    } catch {
      break;
    }
    if (next === undefined || next === null) break;
    current = next;
  }
  if (deepest !== '') return deepest;
  const fallback = fallbackString(current);
  return fallback === '' ? 'Unknown error' : fallback;
}

/**
 * The message a single chain link contributes, or '' if it has none.
 * Total: property access is guarded, so hostile getters yield ''.
 */
function messageOf(value: unknown): string {
  try {
    if (typeof value === 'string') return value;
    if (value === null || value === undefined) return '';
    if (typeof value !== 'object') return String(value);
    const message = (value as { message?: unknown }).message;
    if (typeof message === 'string' && message !== '') return message;
    // AggregateError keeps its detail in .errors, often with an empty
    // top-level message (Node dual-stack ECONNREFUSED is the common case).
    // Read one level only: no recursion, so self-referential errors are safe.
    const errors = (value as { errors?: unknown }).errors;
    if (Array.isArray(errors) && errors.length > 0) {
      const first: unknown = errors[0];
      if (typeof first === 'string' && first !== '') return first;
      const firstMessage = (first as { message?: unknown } | null)?.message;
      if (typeof firstMessage === 'string' && firstMessage !== '') return firstMessage;
    }
    return '';
  } catch {
    return '';
  }
}

/** Last-resort stringification for a chain with no usable message anywhere. */
function fallbackString(value: unknown): string {
  if (value === undefined || value === null) return 'Unknown error';
  try {
    return String(value);
  } catch {
    return 'Unknown error';
  }
}

/**
 * The text of a caller value for an error message, or `undefined` for an object or a function.
 * An error message prints a primitive value, and the error `data` holds every value. `String()`
 * throws a TypeError for an object with no usable `toString` or `valueOf`, for example
 * `Object.create(null)` or the JSON value `{"toString":1}`. The text of another object, for
 * example `[object Object]`, gives the reader no information. The function uses `String()` and
 * not a template literal, because a template literal throws for a Symbol.
 * @param value The value that the caller gave.
 * @returns The text of a primitive value, or `undefined`.
 */
export function messageText(value: unknown): string | undefined {
  if ((typeof value === 'object' && value !== null) || typeof value === 'function') return undefined;
  return String(value);
}

/** The base URL of the error types of DID Resolution v1, section 10. */
const DID_ERROR_TYPES = 'https://www.w3.org/ns/did#';

/** The base URL of the error types of the did:btcr2 specification (the anchors of errors.html). */
const BTCR2_ERROR_TYPES = 'https://dcdpr.github.io/did-btcr2/errors.html#';

/**
 * The `type` and `title` of each error code that a DID Resolution result can carry. The 9 codes of
 * {@link https://www.w3.org/TR/did-resolution-1.0/#errors | DID Resolution v1, section 10} use the
 * URL of that section. The 4 codes of the did:btcr2 specification use the anchor of the code on
 * {@link https://dcdpr.github.io/did-btcr2/errors.html | the did:btcr2 errors page}.
 */
const RESOLUTION_ERRORS: ReadonlyMap<string, { readonly type: string; readonly title: string }> = new Map([
  [INVALID_DID, { type: `${DID_ERROR_TYPES}INVALID_DID`, title: 'Invalid DID' }],
  [INVALID_DID_DOCUMENT, { type: `${DID_ERROR_TYPES}INVALID_DID_DOCUMENT`, title: 'Invalid DID document' }],
  [NOT_FOUND, { type: `${DID_ERROR_TYPES}NOT_FOUND`, title: 'DID not found' }],
  ['REPRESENTATION_NOT_SUPPORTED', { type: `${DID_ERROR_TYPES}REPRESENTATION_NOT_SUPPORTED`, title: 'Representation not supported' }],
  [INVALID_DID_URL, { type: `${DID_ERROR_TYPES}INVALID_DID_URL`, title: 'Invalid DID URL' }],
  [METHOD_NOT_SUPPORTED, { type: `${DID_ERROR_TYPES}METHOD_NOT_SUPPORTED`, title: 'DID method not supported' }],
  [INVALID_OPTIONS, { type: `${DID_ERROR_TYPES}INVALID_OPTIONS`, title: 'Invalid resolution options' }],
  [INTERNAL_ERROR, { type: `${DID_ERROR_TYPES}INTERNAL_ERROR`, title: 'Internal error' }],
  [FEATURE_NOT_SUPPORTED, { type: `${DID_ERROR_TYPES}FEATURE_NOT_SUPPORTED`, title: 'Feature not supported' }],
  [INVALID_DID_UPDATE, { type: `${BTCR2_ERROR_TYPES}invalid_did_update`, title: 'Invalid DID update' }],
  [INVALID_SIGNAL_DATA, { type: `${BTCR2_ERROR_TYPES}invalid_signal_data`, title: 'Invalid signal data' }],
  [LATE_PUBLISHING, { type: `${BTCR2_ERROR_TYPES}late_publishing`, title: 'Late publishing' }],
  [MISSING_UPDATE_DATA, { type: `${BTCR2_ERROR_TYPES}missing_update_data`, title: 'Missing update data' }],
]);

/**
 * The DID Resolution error code of a caught value.
 *
 * Walks `err.cause` links from the top (capped at 16 hops, cycle-safe) and
 * returns the `type` of the first link that is a {@link DidMethodError} whose
 * type is one of the 13 error codes of a DID Resolution result: the 9 codes of
 * DID Resolution v1, section 10, and the 4 codes of the did:btcr2 specification.
 * The nearest typed link wins, so a wrapper that re-types a deeper failure
 * decides the code. Every other value maps to `INTERNAL_ERROR`, the code DID
 * Resolution v1 gives to an unexpected error. Never throws.
 *
 * @param err The caught value.
 * @returns One of the 13 error codes.
 */
export function resolutionErrorCode(err: unknown): string {
  let current: unknown = err;
  for (let hops = 0; hops < 16; hops++) {
    if (current instanceof DidMethodError && RESOLUTION_ERRORS.has(current.type)) {
      return current.type;
    }
    let next: unknown;
    try {
      next = (current as { cause?: unknown } | null)?.cause;
    } catch {
      break;
    }
    if (next === undefined || next === null) break;
    current = next;
  }
  return INTERNAL_ERROR;
}

/**
 * The error object of a failed DID resolution, in the form of
 * {@link https://www.rfc-editor.org/rfc/rfc9457 | RFC 9457} that
 * {@link https://www.w3.org/TR/did-resolution-1.0/#errors | DID Resolution v1, section 10} uses.
 * `type` is the URL of the error code of {@link resolutionErrorCode}, `title` is a short text for
 * the code, and `detail` is the root cause message ({@link rootCauseMessage}). The object has no
 * `status` member. Never throws.
 *
 * @param err The caught value.
 * @returns A new error object.
 */
export function resolutionError(err: unknown): ResolutionError {
  const { type, title } = RESOLUTION_ERRORS.get(resolutionErrorCode(err))!;
  return { type, title, detail: rootCauseMessage(err) };
}

/**
 * The `type` and `title` of an error code, as {@link resolutionError} gives them.
 *
 * @param code An error code, for example `INVALID_DID`.
 * @returns A new object, or `undefined` if the code is not one of the 13 error codes.
 */
export function resolutionErrorOfCode(code: string): Omit<ResolutionError, 'detail'> | undefined {
  const entry = RESOLUTION_ERRORS.get(code);
  return entry === undefined ? undefined : { type: entry.type, title: entry.title };
}

/**
 * The error code of an error type URL. The function is the inverse of the map of
 * {@link resolutionError}. Every other value maps to `INTERNAL_ERROR`.
 *
 * @param type The `type` member of an error object.
 * @returns One of the 13 error codes.
 */
export function resolutionErrorCodeOfType(type: unknown): string {
  for (const [code, entry] of RESOLUTION_ERRORS) {
    if (entry.type === type) return code;
  }
  return INTERNAL_ERROR;
}

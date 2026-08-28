import type { Logger } from './types.js';

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

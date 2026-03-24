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

// Internal wire checks of the HTTP transport. No barrel exports this module, so
// it is not part of the public package surface.
import type { SignedEnvelope } from './protocol.js';

/** Minimum nonce length (bytes). */
const MIN_NONCE_LEN_BYTES = 16;

/** Maximum nonce length (bytes). */
const MAX_NONCE_LEN_BYTES = 64;

/** Lowercase hex, an even count of characters, from the minimum to the maximum byte count. */
const NONCE_PATTERN = new RegExp(`^(?:[0-9a-f]{2}){${MIN_NONCE_LEN_BYTES},${MAX_NONCE_LEN_BYTES}}$`);

/**
 * Check the outer shape of a parsed envelope before a transport reads its fields.
 *
 * Returns `true` if `value` is a non-null, non-array object, `from` is a non-empty
 * string, and `message` is a non-null, non-array object. The check does not look at
 * the other fields: `verifyEnvelope` checks them.
 */
export function isEnvelopeShape(value: unknown): value is SignedEnvelope {
  if(!isPlainObject(value)) return false;
  const from = value.from;
  if(typeof from !== 'string' || from.length === 0) return false;
  return isPlainObject(value.message);
}

/**
 * Check an anti-replay nonce. Returns `true` if `value` is a string of 16 to 64
 * bytes of lowercase hex (an even count of characters).
 */
export function isValidNonce(value: unknown): value is string {
  return typeof value === 'string' && NONCE_PATTERN.test(value);
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

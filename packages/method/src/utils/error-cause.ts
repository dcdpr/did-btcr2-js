import { DidMethodError } from '@did-btcr2/common';

/** The type and the message of an inner error, carried as `data.cause` by a wrapping error. */
export interface ErrorCause {
  /** The `type` of a typed error, or the `name` of a plain `Error`. */
  type: string;

  /** The message of the inner error. */
  message: string;
}

/**
 * Describe an inner error for the `data.cause` of a wrapping typed error. The update paths
 * raise `INVALID_DID_UPDATE` for every failure that the specification names; the inner error
 * of the cryptosuite, the multikey, the hash decoder, or the common package rides along here.
 * @param {unknown} error The inner error.
 * @returns {ErrorCause} The type and the message of the inner error.
 */
export function errorCause(error: unknown): ErrorCause {
  if(error instanceof DidMethodError) return { type: error.type, message: error.message };
  if(error instanceof Error) return { type: error.name, message: error.message };
  return { type: 'unknown', message: String(error) };
}

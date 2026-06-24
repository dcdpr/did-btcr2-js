import { TransportAdapterError } from '../error.js';

/**
 * Errors raised by the HTTP transport adapter. Extends {@link TransportAdapterError}
 * so callers can catch HTTP-specific failures narrowly or transport failures broadly.
 */
export class HttpTransportError extends TransportAdapterError {
  constructor(message: string, type: string = 'HttpTransportError', data?: Record<string, any>) {
    super(message, type, { adapter: 'http', ...(data ?? {}) });
  }
}

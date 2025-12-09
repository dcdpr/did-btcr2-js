import { DidMethodError } from '@did-btcr2/common';

/**
 * Custom CLI Error class extending DidMethodError.
 */
export class CLIError extends DidMethodError {
  constructor(message: string, type: string = 'CLIError', data?: Record<string, any>) {
    super(message, { type, name: type, data });
  }
}
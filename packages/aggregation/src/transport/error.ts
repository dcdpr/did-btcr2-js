import { MethodError } from '@did-btcr2/common';

export class TransportError extends MethodError {
  constructor(message: string, type: string = 'TransportError', data?: Record<string, any>) {
    super(message, type, data);
  }
}

export class TransportAdapterError extends MethodError {
  constructor(message: string, type: string = 'TransportAdapterError', data?: Record<string, any>) {
    super(message, type, data);
  }
}

import { MethodError } from '@did-btcr2/common';

export class CommunicationServiceError extends MethodError {
  constructor(message: string, type: string = 'CommunicationServiceError', data?: Record<string, any>) {
    super(message, type, data);
  }
}

export class CommunicationAdapterError extends MethodError {
  constructor(message: string, type: string = 'CommunicationAdapterError', data?: Record<string, any>) {
    super(message, type, data);
  }
}
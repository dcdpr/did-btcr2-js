import { DidBtc1Error } from '@did-btc1/common';

export class CommunicationServiceError extends DidBtc1Error {
  constructor(message: string, type: string = 'CommunicationServiceError', data?: Record<string, any>) {
    super(message, { type, name: type, data });
  }
}

export class CommunicationAdapterError extends DidBtc1Error {
  constructor(message: string, type: string = 'CommunicationAdapterError', data?: Record<string, any>) {
    super(message, { type, name: type, data });
  }
}
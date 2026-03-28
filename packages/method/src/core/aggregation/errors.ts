import { MethodError } from '@did-btcr2/common';

export class AggregationServiceError extends MethodError {
  constructor(message: string, type: string = 'AggregationServiceError', data?: Record<string, any>) {
    super(message, type, data);
  }
}

export class AggregationParticipantError extends MethodError {
  constructor(message: string, type: string = 'AggregationParticipantError', data?: Record<string, any>) {
    super(message, type, data);
  }
}

export class AggregationCohortError extends MethodError {
  constructor(message: string, type: string = 'AggregationCohortError', data?: Record<string, any>) {
    super(message, type, data);
  }
}

export class SigningSessionError extends MethodError {
  constructor(message: string, type: string = 'SigningSessionError', data?: Record<string, any>) {
    super(message, type, data);
  }
}

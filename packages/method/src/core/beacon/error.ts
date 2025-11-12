import { MethodError } from '@did-btcr2/common';

export class BeaconError extends MethodError {
  constructor(message: string, type: string = 'BeaconError', data?: Record<string, any>) {
    super(message, type, data);
  }
}

export class BeaconCoordinatorError extends MethodError {
  constructor(message: string, type: string = 'BeaconCoordinatorError', data?: Record<string, any>) {
    super(message, type, data);
  }
}

export class BeaconParticipantError extends MethodError {
  constructor(message: string, type: string = 'BeaconParticipantError', data?: Record<string, any>) {
    super(message, type, data);
  }
}


export class SingletonBeaconError extends MethodError {
  constructor(message: string, type: string = 'SingletonBeaconError', data?: Record<string, any>) {
    super(message, type, data);
  }
}

export class AggregateBeaconError extends MethodError {
  constructor(message: string, type: string = 'AggregateBeaconError', data?: Record<string, any>) {
    super(message, type, data);
  }
}

export class CIDAggregateBeaconError extends MethodError {
  constructor(message: string, type: string = 'CIDAggregateBeaconError', data?: Record<string, any>) {
    super(message, type, data);
  }
}

export class SMTAggregateBeaconError extends MethodError {
  constructor(message: string, type: string = 'SMTAggregateBeaconError', data?: Record<string, any>) {
    super(message, type, data);
  }
}
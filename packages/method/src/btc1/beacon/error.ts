import { DidBtc1Error } from '@did-btc1/common';

export class BeaconError extends DidBtc1Error {
  constructor(message: string, type: string = 'BeaconError', data?: Record<string, any>) {
    super(message, { type, name: type, data });
  }
}

export class BeaconCoordinatorError extends DidBtc1Error {
  constructor(message: string, type: string = 'BeaconCoordinatorError', data?: Record<string, any>) {
    super(message, { type, name: type, data });
  }
}

export class SingletonBeaconError extends DidBtc1Error {
  constructor(message: string, type: string = 'SingletonBeaconError', data?: Record<string, any>) {
    super(message, { type, name: type, data });
  }
}

export class AggregateBeaconError extends DidBtc1Error {
  constructor(message: string, type: string = 'AggregateBeaconError', data?: Record<string, any>) {
    super(message, { type, name: type, data });
  }
}

export class CIDAggregateBeaconError extends DidBtc1Error {
  constructor(message: string, type: string = 'CIDAggregateBeaconError', data?: Record<string, any>) {
    super(message, { type, name: type, data });
  }
}

export class SMTAggregateBeaconError extends DidBtc1Error {
  constructor(message: string, type: string = 'SMTAggregateBeaconError', data?: Record<string, any>) {
    super(message, { type, name: type, data });
  }
}

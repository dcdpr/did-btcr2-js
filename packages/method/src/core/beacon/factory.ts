import { MethodError } from '@did-btcr2/common';
import { Beacon } from './beacon.js';
import { CASBeacon } from './cas-beacon.js';
import { BeaconService } from './interfaces.js';
import { SingletonBeacon } from './singleton.js';
import { SMTBeacon } from './smt-beacon.js';

/**
 * Beacon Factory pattern to create Beacon instances.
 * @class BeaconFactory
 * @type {BeaconFactory}
 */
export class BeaconFactory {
  /**
   * Establish a Beacon instance based on the provided service and optional sidecar data.
   * @param {BeaconService} service The beacon service configuration.
   * @returns {Beacon} The established Beacon instance.
   */
  static establish(service: BeaconService): Beacon {
    switch (service.type) {
      case 'SingletonBeacon':
        return new SingletonBeacon(service);
      case 'CASBeacon':
        return new CASBeacon(service);
      case 'SMTBeacon':
        return new SMTBeacon(service);
      default:
        throw new MethodError('Invalid Beacon Type', 'INVALID_BEACON_ERROR', service);
    }
  }
}

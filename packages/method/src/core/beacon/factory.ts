import { MethodError } from '@did-btcr2/common';
import { SidecarData } from '../types.js';
import { CASBeacon } from './cas-beacon.js';
import { AggregateBeacon, BeaconService, BeaconSignal } from './interfaces.js';
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
   * @param {BeaconService} service - The beacon service configuration.
   * @param {Array<BeaconSignal>} signals - The array of beacon signals.
   * @param {SidecarData} sidecar - The sidecar data associated with the beacon.
   * @returns {Beacon} The established Beacon instance.
   */
  static establish(service: BeaconService, signals: Array<BeaconSignal>, sidecar: SidecarData): AggregateBeacon {
    switch (service.type) {
      case 'SingletonBeacon':
        return new SingletonBeacon(service, signals, sidecar);
      case 'CASBeacon':
        return new CASBeacon(service, signals, sidecar);
      case 'SMTBeacon':
        return new SMTBeacon(service, signals, sidecar);
      default:
        throw new MethodError('Invalid Beacon Type', 'INVALID_BEACON_ERROR', service);
    }
  }
}

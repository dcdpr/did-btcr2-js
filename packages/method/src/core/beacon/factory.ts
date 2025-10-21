import { MethodError } from '@did-btcr2/common';
import { Beacon } from './beacon.js';
import { BeaconService } from './interface.js';
import { CIDAggregateSidecar, SidecarData, SMTAggregateSidecar } from '../crud/types.js';
import { CIDAggregateBeacon } from './cid-aggregate.js';
import { SingletonBeacon } from './singleton.js';
import { SMTAggregateBeacon } from './smt-aggregate.js';

/**
 * Beacon Factory pattern to create Beacon instances.
 * @class BeaconFactory
 * @type {BeaconFactory}
 */
export class BeaconFactory {
  /**
   * Establish a Beacon instance based on the provided service and optional sidecar data.
   * @param {BeaconService} service - The beacon service configuration.
   * @param {SidecarData} [sidecar] - The optional sidecar data.
   * @returns {Beacon} The established Beacon instance.
   */
  static establish(service: BeaconService, sidecar?: SidecarData): Beacon {
    switch (service.type) {
      case 'SingletonBeacon':
        return new SingletonBeacon(service, sidecar);
      case 'CIDAggregateBeacon':
        return new CIDAggregateBeacon(service, sidecar as CIDAggregateSidecar);
      case 'SMTAggregateBeacon':
        return new SMTAggregateBeacon(service, sidecar as SMTAggregateSidecar);
      default:
        throw new MethodError(
          'Invalid Beacon Type',
          'INVALID_BEACON_ERROR', { service, sidecar }
        );
    }
  }
}

import { Btc1Error } from '@did-btc1/common';
import { CIDAggregateBeacon } from './aggregate/cid-aggregate.js';
import { BeaconService, CIDAggregateSidecar, SingletonSidecar, SMTAggregateSidecar } from './interfaces.js';
import { SingletonBeacon } from './singleton.js';
import { SMTAggregateBeacon } from './aggregate/smt-aggregate.js';
import { SidecarData } from './types.js';
import { UpdateBeacon } from './beacon.js';

/**
 * Beacon Factory pattern to create Beacon instances.
 * @class BeaconFactory
 * @type {BeaconFactory}
 */
export class BeaconFactory {
  static establish(service: BeaconService, sidecar?: SidecarData<SingletonSidecar | CIDAggregateSidecar | SMTAggregateSidecar>): UpdateBeacon {
    switch (service.type) {
      case 'SingletonBeacon':
        return new SingletonBeacon(service, sidecar);
      case 'CIDAggregateBeacon':
        return new CIDAggregateBeacon(service, sidecar);
      case 'SMTAggregateBeacon':
        return new SMTAggregateBeacon(service, sidecar);
      default:
        throw new Btc1Error('Invalid Beacon Type', 'INVALID_BEACON_ERROR', { service, sidecar });
    }
  }
}

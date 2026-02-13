import { BitcoinNetworkConnection } from '@did-btcr2/bitcoin';
import { HexString, MethodError } from '@did-btcr2/common';
import { SignedBTCR2Update } from '@did-btcr2/cryptosuite';
import { SidecarData } from '../types.js';
import { AggregateBeacon, BeaconService, BeaconSignal, BlockMetadata } from './interfaces.js';

/**
 * TODO: Finish implementation
 * Implements {@link https://dcdpr.github.io/did-btcr2/terminology.html#smt-beacon | SMTBeacon}.
 * @class SMTBeacon
 * @type {SMTBeacon}
 * @extends {AggregateBeacon}
 */
export class SMTBeacon extends AggregateBeacon {
  /**
   * Creates an instance of SingletonBeacon.
   * @param {BeaconService} service The Beacon service.
   * @param {Array<BeaconSignal>} signals The SingletonBeacon sidecar data.
   * @param {SidecarData} sidecar The sidecar data.
   */
  constructor(
    service: BeaconService,
    signals?: Array<BeaconSignal>,
    sidecar?: SidecarData,
    bitcoin?: BitcoinNetworkConnection
  ) {
    super({ ...service, type: 'SMTBeacon' }, signals, sidecar, bitcoin);
  }

  /**
   * Static, convenience method for establishing a SMTBeacon object.
   * @param {string} service The Beacon service.
   * @param {SidecarData} sidecar The sidecar data.
   * @returns {SingletonBeacon} The Singleton Beacon.
   */
  static establish(service: BeaconService, signals: Array<BeaconSignal>, sidecar: SidecarData): SMTBeacon {
    return new SMTBeacon(service, signals, sidecar);
  }

  /**
   * TODO: Figure out if this is necessary or not.
   * @param {HexString} updateHash The hash of the BTCR2 update to generate the signal for.
   * @returns {BeaconSignal} The generated signal.
   * @throws {MethodError} if the signal is invalid.
   */
  generateSignal(updateHash: HexString): BeaconSignal {
    throw new MethodError('Method not implemented.', `METHOD_NOT_IMPLEMENTED`, {updateHash});
  }

  /**
   * Process SMTBeacon signals.
   * @returns {Promise<Array<SignedBTCR2Update>>} The processed signed update or undefined.
   * @throws {MethodError} if the signal processing fails.
   */
  async processSignals(): Promise<Array<[SignedBTCR2Update, BlockMetadata]>> {
    throw new MethodError('Method not implemented.', `METHOD_NOT_IMPLEMENTED`);
  }


  /**
   * Broadcast a SMTBeacon signal.
   * @param {HexString} updateHash The hash of the BTCR2 update to broadcast.
   * @returns {Promise<SignalsMetadata>} The result of the broadcast.
   * @throws {MethodError} if the broadcast fails.
   */
  async broadcastSignal(updateHash: HexString): Promise<HexString> {
    throw new MethodError('Method not implemented.', `METHOD_NOT_IMPLEMENTED`, {updateHash});
  }

}

import { BitcoinNetworkConnection } from '@did-btcr2/bitcoin';
import { HexString, MethodError } from '@did-btcr2/common';
import { SidecarData } from '../types.js';
import { AggregateBeacon, BeaconService, BeaconSignal, BlockMetadata } from './interfaces.js';
import { BTCR2SignedUpdate } from '@did-btcr2/cryptosuite';

/**
 * Implements {@link https://dcdpr.github.io/did-btcr2/terminology.html#cas-beacon | CAS Beacon}.
 *
 * @class CASBeacon
 * @type {CASBeacon}
 * @extends {AggregateBeacon}
 */
export class CASBeacon extends AggregateBeacon {
  /**
   * Creates an instance of CASBeacon.
   * @param {BeaconService} service The service of the Beacon.
   * @param {?BeaconSidecarData} [sidecar] The sidecar data of the Beacon.
   */
  constructor(
    service: BeaconService,
    signals: Array<BeaconSignal>,
    sidecar: SidecarData,
    bitcoin?: BitcoinNetworkConnection
  ) {
    super({ ...service, type: 'CASBeacon' }, signals, sidecar, bitcoin);
  }

  /**
   * Establish a CASBeacon instance based on the provided service and sidecar data.
   * @param {BeaconService} service - The beacon service configuration.
   * @param {SidecarData} sidecar - The sidecar data.
   * @returns {CASBeacon} The established CASBeacon instance.
   */
  static establish(service: BeaconService, signals: Array<BeaconSignal>, sidecar: SidecarData): CASBeacon {
    return new CASBeacon(service, signals, sidecar);
  }

  /**
   * TODO: Figure out if this is necessary or not.
   * @param {HexString} updateHash The hash of the update to generate the signal for.
   * @returns {BeaconSignal} The generated signal.
   * @throws {MethodError} if the signal is invalid.
   */
  generateSignal(updateHash: HexString): BeaconSignal {
    throw new Error('Method not implemented.' + updateHash);
  }

  /**
   * Implements {@link https://dcdpr.github.io/did-btcr2/operations/resolve.html#process-cas-beacon | 7.2.e.1 Process CAS Beacon}.
   * @returns {Promise<BTCR2SignedUpdate | undefined>} The processed signed update or undefined.
   * @throws {MethodError} if the signal processing fails.
   */
  processSignals(): Promise<Array<[BTCR2SignedUpdate, BlockMetadata]>> {
    throw new MethodError('Method not implemented.', `METHOD_NOT_IMPLEMENTED`);
  }

  /**
   * TODO: Finish implementation
   * @param {HexString} updateHash The hash of the update to broadcast.
   * @returns {Promise<{ spentTx: string; signedUpdate: BTCR2SignedUpdate }>} The result of the broadcast.
   * @throws {MethodError} if the broadcast fails.
   */
  async broadcastSignal(updateHash: HexString): Promise<HexString> {
    throw new MethodError('Method not implemented.', `METHOD_NOT_IMPLEMENTED`, {updateHash});
  }
}

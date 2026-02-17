import { BitcoinNetworkConnection } from '@did-btcr2/bitcoin';
import { KeyBytes, MethodError } from '@did-btcr2/common';
import { SignedBTCR2Update } from '@did-btcr2/cryptosuite';
import { SidecarData } from '../types.js';
import { AggregateBeacon, BeaconService, BeaconSignal, BlockMetadata } from './interfaces.js';

/**
 * Implements {@link https://dcdpr.github.io/did-btcr2/terminology.html#cas-beacon | CAS Beacon}.
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
    signals?: Array<BeaconSignal>,
    sidecar?: SidecarData,
    bitcoin?: BitcoinNetworkConnection
  ) {
    super({ ...service, type: 'CASBeacon' }, signals, sidecar, bitcoin);
  }

  /**
   * Static, convenience method for establishing a beacon object.
   * @param {BeaconService} service The service of the Beacon.
   * @param {Array<BeaconSignal>} signals The signals of the Beacon.
   * @param {SidecarData} sidecar The sidecar data of the Beacon.
   * @param {BitcoinNetworkConnection} bitcoin The Bitcoin network connection.
   * @returns {CASBeacon} The CAS Beacon.
   */
  static establish(
    service: BeaconService,
    signals?: Array<BeaconSignal>,
    sidecar?: SidecarData,
    bitcoin?: BitcoinNetworkConnection
  ): CASBeacon {
    return new CASBeacon(service, signals, sidecar, bitcoin);
  }

  /**
   * Generates a Beacon Signal.
   * @returns {BeaconSignal} The generated signal.
   * @throws {MethodError} if the signal is invalid.
   */
  generateSignal(): BeaconSignal {
    throw new MethodError('Method not implemented.', `METHOD_NOT_IMPLEMENTED`);

  }

  /**
   * Implements {@link https://dcdpr.github.io/did-btcr2/operations/resolve.html#process-cas-beacon | 7.2.e.1 Process CAS Beacon}.
   * @returns {Promise<Array<[SignedBTCR2Update, BlockMetadata]>>} The processed signals.
   * @throws {MethodError} if processing fails.
   */
  processSignals(): Promise<Array<[SignedBTCR2Update, BlockMetadata]>> {
    throw new MethodError('Method not implemented.', `METHOD_NOT_IMPLEMENTED`);
  }

  /**
   * Broadcast CAS Beacon signal to the Bitcoin network.
   * @param {SignedBTCR2Update} signedUpdate The signed BTCR2 update to be broadcasted.
   * @param {KeyBytes} secretKey The secret key used for signing the update.
   * @return {Promise<SignedBTCR2Update>} The signed update that was broadcasted.
   * @throws {MethodError} if broadcasting fails.
   */
  async broadcastSignal(
    signedUpdate: SignedBTCR2Update,
    secretKey: KeyBytes
  ): Promise<SignedBTCR2Update> {
    throw new MethodError('Method not implemented.', `METHOD_NOT_IMPLEMENTED`, {signedUpdate, secretKey});
  }
}

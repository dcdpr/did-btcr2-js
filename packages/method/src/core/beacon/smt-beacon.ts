import { BitcoinNetworkConnection } from '@did-btcr2/bitcoin';
import { KeyBytes, MethodError } from '@did-btcr2/common';
import { SignedBTCR2Update } from '@did-btcr2/cryptosuite';
import { SidecarData } from '../types.js';
import { AggregateBeacon, BeaconService, BeaconSignal, BlockMetadata } from './interfaces.js';

/**
 * Implements {@link https://dcdpr.github.io/did-btcr2/terminology.html#smt-beacon | SMTBeacon}.
 * @class SMTBeacon
 * @type {SMTBeacon}
 * @extends {AggregateBeacon}
 */
export class SMTBeacon extends AggregateBeacon {
  /**
   * Creates an instance of SMTBeacon.
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
   * Static, convenience method for establishing a beacon object.
   * @param {BeaconService} service The service of the Beacon.
   * @param {Array<BeaconSignal>} signals The signals of the Beacon.
   * @param {SidecarData} sidecar The sidecar data of the Beacon.
   * @param {BitcoinNetworkConnection} bitcoin The Bitcoin network connection.
   * @returns {SMTBeacon} The SMT Beacon.
   */
  static establish(
    service: BeaconService,
    signals?: Array<BeaconSignal>,
    sidecar?: SidecarData,
    bitcoin?: BitcoinNetworkConnection
  ): SMTBeacon {
    return new SMTBeacon(service, signals, sidecar, bitcoin);
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
   * Process SMTBeacon signals.
   * @returns {Promise<Array<SignedBTCR2Update>>} The processed signed update or undefined.
   * @throws {MethodError} if the signal processing fails.
   */
  async processSignals(): Promise<Array<[SignedBTCR2Update, BlockMetadata]>> {
    throw new MethodError('Method not implemented.', `METHOD_NOT_IMPLEMENTED`);
  }


  /**
   * Broadcast a SMTBeacon signal.
   * @param {SignedBTCR2Update} signedUpdate The signed update to be broadcasted.
   * @param {KeyBytes} secretKey The secret key to sign the update with.
   * @returns {Promise<SignedBTCR2Update>} The result of the broadcast.
   * @throws {MethodError} if the broadcast fails.
   */
  async broadcastSignal(signedUpdate: SignedBTCR2Update, secretKey: KeyBytes): Promise<SignedBTCR2Update> {
    throw new MethodError('Method not implemented.', `METHOD_NOT_IMPLEMENTED`, {signedUpdate, secretKey});
  }

}

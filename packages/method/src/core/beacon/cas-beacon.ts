import { BitcoinNetworkConnection } from '@did-btcr2/bitcoin';
import { KeyBytes } from '@did-btcr2/common';
import { SignedBTCR2Update } from '@did-btcr2/cryptosuite';
import { SidecarData } from '../types.js';
import { Beacon } from './beacon.js';
import { CASBeaconError } from './error.js';
import { BeaconService, BeaconSignal, BlockMetadata } from './interfaces.js';

/**
 * Implements {@link https://dcdpr.github.io/did-btcr2/terminology.html#cas-beacon | CAS Beacon}.
 * @class CASBeacon
 * @type {CASBeacon}
 * @extends {Beacon}
 */
export class CASBeacon extends Beacon {
  /**
   * Creates an instance of CASBeacon.
   * @param {BeaconService} service The service of the Beacon.
   */
  constructor(service: BeaconService) {
    super({ ...service, type: 'CASBeacon' });
  }

  /**
   * Implements {@link https://dcdpr.github.io/did-btcr2/operations/resolve.html#process-cas-beacon | 7.2.e.1 Process CAS Beacon}.
   * @param {Array<BeaconSignal>} signals The array of Beacon Signals to process.
   * @param {SidecarData} sidecar The sidecar data associated with the CAS Beacon.
   * @returns {Promise<Array<[SignedBTCR2Update, BlockMetadata]>>} The processed signals.
   * @throws {CASBeaconError} if processing fails.
   */
  processSignals(
    signals: Array<BeaconSignal>,
    sidecar: SidecarData
  ): Promise<Array<[SignedBTCR2Update, BlockMetadata]>> {
    throw new CASBeaconError('Method not implemented.', `METHOD_NOT_IMPLEMENTED`, { signals, sidecar });
  }

  /**
   * Broadcast CAS Beacon signal to the Bitcoin network.
   * @param {SignedBTCR2Update} signedUpdate The signed BTCR2 update to broadcast.
   * @param {KeyBytes} secretKey The secret key for signing the Bitcoin transaction.
   * @param {BitcoinNetworkConnection} bitcoin The Bitcoin network connection.
   * @return {Promise<SignedBTCR2Update>} The signed update that was broadcasted.
   * @throws {CASBeaconError} if broadcasting fails.
   */
  async broadcastSignal(
    signedUpdate: SignedBTCR2Update,
    secretKey: KeyBytes,
    bitcoin: BitcoinNetworkConnection
  ): Promise<SignedBTCR2Update> {
    throw new CASBeaconError('Method not implemented.', `METHOD_NOT_IMPLEMENTED`, {signedUpdate, secretKey, bitcoin});
  }
}

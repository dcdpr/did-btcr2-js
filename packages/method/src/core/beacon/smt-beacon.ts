import { BitcoinNetworkConnection } from '@did-btcr2/bitcoin';
import { KeyBytes } from '@did-btcr2/common';
import { SignedBTCR2Update } from '@did-btcr2/cryptosuite';
import { SidecarData } from '../types.js';
import { Beacon } from './beacon.js';
import { SMTBeaconError } from './error.js';
import { BeaconService, BeaconSignal, BlockMetadata } from './interfaces.js';

/**
 * Implements {@link https://dcdpr.github.io/did-btcr2/terminology.html#smt-beacon | SMTBeacon}.
 * @class SMTBeacon
 * @type {SMTBeacon}
 * @extends {Beacon}
 */
export class SMTBeacon extends Beacon {
  /**
   * Creates an instance of SMTBeacon.
   * @param {BeaconService} service The Beacon service.
   */
  constructor(service: BeaconService) {
    super({ ...service, type: 'SMTBeacon' });
  }

  /**
   * Implements {@link https://dcdpr.github.io/did-btcr2/operations/resolve.html#process-smt-beacon | 7.2.e.1 Process SMT Beacon}.
   * @param {Array<BeaconSignal>} signals The array of Beacon Signals to process.
   * @param {SidecarData} sidecar The sidecar data associated with the SMT Beacon.
   * @returns {Promise<Array<[SignedBTCR2Update, BlockMetadata]>>} The processed signals.
   * @throws {SMTBeaconError} if processing fails.
   */
  processSignals(
    signals: Array<BeaconSignal>,
    sidecar: SidecarData
  ): Promise<Array<[SignedBTCR2Update, BlockMetadata]>> {
    throw new SMTBeaconError('Method not implemented.', `METHOD_NOT_IMPLEMENTED`, {signals, sidecar});
  }

  /**
   * Broadcast CAS Beacon signal to the Bitcoin network.
   * @param {SignedBTCR2Update} signedUpdate The signed BTCR2 update to broadcast.
   * @param {KeyBytes} secretKey The secret key for signing the Bitcoin transaction.
   * @param {BitcoinNetworkConnection} bitcoin The Bitcoin network connection.
   * @return {Promise<SignedBTCR2Update>} The signed update that was broadcasted.
   * @throws {SMTBeaconError} if broadcasting fails.
   */
  async broadcastSignal(
    signedUpdate: SignedBTCR2Update,
    secretKey: KeyBytes,
    bitcoin: BitcoinNetworkConnection
  ): Promise<SignedBTCR2Update> {
    throw new SMTBeaconError('Method not implemented.', `METHOD_NOT_IMPLEMENTED`, {signedUpdate, secretKey, bitcoin});
  }
}

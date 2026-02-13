import { KeyBytes } from '@did-btcr2/common';
import { BitcoinNetworkConnection } from '../../../../bitcoin/dist/types/bitcoin.js';
import { SignedBTCR2Update } from '../../../../cryptosuite/dist/types/data-integrity-proof/interface.js';
import { SidecarData } from '../types.js';
import { BeaconService, BeaconSignal, BlockMetadata } from './interfaces.js';

/**
 * Abstract base class for all BTCR2 Beacon types.
 * A Beacon is a service listed in a BTCR2 DID document that informs resolvers
 * how to find authentic updates to the DID.
 *
 * Beacons are lightweight typed wrappers around a {@link BeaconService} configuration.
 * Dependencies (signals, sidecar data, bitcoin connection) are passed as method
 * parameters rather than held as instance state.
 *
 * Use {@link BeaconFactory.establish} to create typed instances from service config.
 *
 * @abstract
 * @class Beacon
 * @type {Beacon}
 */
export abstract class Beacon {
  /**
   * The Beacon service configuration parsed from the DID Document.
   */
  readonly service: BeaconService;

  constructor(service: BeaconService) {
    this.service = service;
  }

  /**
   * Processes an array of Beacon Signals to extract BTCR2 Signed Updates.
   * Used during the resolve path.
   * @param {Array<BeaconSignal>} signals The beacon signals discovered on-chain.
   * @param {SidecarData} sidecar The processed sidecar data containing update/CAS/SMT maps.
   * @returns {Promise<Array<[SignedBTCR2Update, BlockMetadata]>>} The updates announced by the signals.
   */
  abstract processSignals(
    signals: Array<BeaconSignal>,
    sidecar: SidecarData,
  ): Promise<Array<[SignedBTCR2Update, BlockMetadata]>>;


  /**
   * Broadcasts a signed update as a Beacon Signal to the Bitcoin network.
   * Used during the update path.
   * @param {SignedBTCR2Update} signedUpdate The signed BTCR2 update to broadcast.
   * @param {KeyBytes} secretKey The secret key for signing the Bitcoin transaction.
   * @param {BitcoinNetworkConnection} bitcoin The Bitcoin network connection.
   * @returns {Promise<SignedBTCR2Update>} The signed update that was broadcast.
   */
  abstract broadcastSignal(
    signedUpdate: SignedBTCR2Update,
    secretKey: KeyBytes,
    bitcoin: BitcoinNetworkConnection
  ): Promise<SignedBTCR2Update>;
}
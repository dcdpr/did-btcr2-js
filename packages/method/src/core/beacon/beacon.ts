import type { KeyBytes } from '@did-btcr2/common';
import type { BitcoinConnection } from '@did-btcr2/bitcoin';
import type { SignedBTCR2Update } from '@did-btcr2/cryptosuite';
import type { BeaconProcessResult } from '../resolver.js';
import type { SidecarData } from '../types.js';
import type { BeaconService, BeaconSignal } from './interfaces.js';

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
   *
   * Returns successfully resolved updates and any data needs that must be
   * satisfied before remaining signals can be processed.
   *
   * @param {Array<BeaconSignal>} signals The beacon signals discovered on-chain.
   * @param {SidecarData} sidecar The processed sidecar data containing update/CAS/SMT maps.
   * @returns {BeaconProcessResult} The updates and any data needs.
   */
  abstract processSignals(
    signals: Array<BeaconSignal>,
    sidecar: SidecarData,
  ): BeaconProcessResult;

  /**
   * Broadcasts a signed update as a Beacon Signal to the Bitcoin network.
   * Used during the update path.
   * @param {SignedBTCR2Update} signedUpdate The signed BTCR2 update to broadcast.
   * @param {KeyBytes} secretKey The secret key for signing the Bitcoin transaction.
   * @param {BitcoinConnection} bitcoin The Bitcoin network connection.
   * @returns {Promise<SignedBTCR2Update>} The signed update that was broadcast.
   */
  abstract broadcastSignal(
    signedUpdate: SignedBTCR2Update,
    secretKey: KeyBytes,
    bitcoin: BitcoinConnection
  ): Promise<SignedBTCR2Update>;
}
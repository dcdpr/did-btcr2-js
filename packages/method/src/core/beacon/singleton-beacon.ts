import type { BitcoinConnection } from '@did-btcr2/bitcoin';
import type { KeyBytes } from '@did-btcr2/common';
import { canonicalize, hash } from '@did-btcr2/common';
import type { SignedBTCR2Update } from '@did-btcr2/cryptosuite';
import type { BeaconProcessResult, DataNeed } from '../resolver.js';
import type { SidecarData } from '../types.js';
import type { BroadcastOptions } from './beacon.js';
import { Beacon } from './beacon.js';
import type { BeaconService, BeaconSignal, BlockMetadata } from './interfaces.js';

/**
 * Implements {@link https://dcdpr.github.io/did-btcr2/terminology.html#singleton-beacon | Singleton Beacon}.
 * @class SingletonBeacon
 * @type {SingletonBeacon}
 * @extends {Beacon}
 */
export class SingletonBeacon extends Beacon {

  /**
   * Creates an instance of SingletonBeacon.
   * @param {BeaconService} service The BeaconService object representing the funded beacon to announce the update to.
   */
  constructor(service: BeaconService) {
    super({ ...service, type: 'SingletonBeacon' });
  }

  /**
   * Processes an array of Beacon Signals associated with a Singleton Beacon Service.
   * @param {Array<BeaconSignal>} signals The beacon signals discovered on-chain.
   * @param {SidecarData} sidecar The processed sidecar data.
   * @returns {BeaconProcessResult} Successfully resolved updates and any data needs.
   */
  processSignals(
    signals: Array<BeaconSignal>,
    sidecar: SidecarData
  ): BeaconProcessResult {
    const updates = new Array<[SignedBTCR2Update, BlockMetadata]>();
    const needs = new Array<DataNeed>();

    for(const signal of signals) {
      // Signal bytes are hex — matches hex-keyed sidecar maps directly
      const updateHash = signal.signalBytes;

      // Look up the signed update in sidecar updateMap
      const signedUpdate = sidecar.updateMap.get(updateHash);

      if(!signedUpdate) {
        // Data not available — emit a need instead of throwing
        needs.push({
          kind             : 'NeedSignedUpdate',
          updateHash,
          beaconServiceId  : this.service.id
        });
        continue;
      }

      updates.push([signedUpdate, signal.blockMetadata]);
    }

    return { updates, needs };
  }
  /**
   * Broadcasts a SingletonBeacon signal to the Bitcoin network.
   *
   * The signal bytes embedded in OP_RETURN are the SHA-256 canonical hash of the signed update.
   * UTXO selection, PSBT construction, fee estimation, signing, and broadcast are delegated to
   * {@link Beacon.buildSignAndBroadcast}.
   *
   * @param {SignedBTCR2Update} signedUpdate The signed BTCR2 update to broadcast.
   * @param {KeyBytes} secretKey The secret key for signing the Bitcoin transaction.
   * @param {BitcoinConnection} bitcoin The Bitcoin network connection.
   * @param {BroadcastOptions} [options] Optional broadcast configuration (e.g. fee estimator).
   * @returns {Promise<SignedBTCR2Update>} The signed update that was broadcast.
   * @throws {BeaconError} if the bitcoin address is invalid, unfunded, or UTXO cannot cover the fee.
   */
  async broadcastSignal(
    signedUpdate: SignedBTCR2Update,
    secretKey: KeyBytes,
    bitcoin: BitcoinConnection,
    options?: BroadcastOptions
  ): Promise<SignedBTCR2Update> {
    const signalBytes = hash(canonicalize(signedUpdate));
    await this.buildSignAndBroadcast(signalBytes, secretKey, bitcoin, options);
    return signedUpdate;
  }
}

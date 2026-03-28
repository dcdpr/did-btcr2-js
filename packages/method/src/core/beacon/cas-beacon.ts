import type { BitcoinConnection } from '@did-btcr2/bitcoin';
import type { KeyBytes } from '@did-btcr2/common';
import { canonicalHash, canonicalize, decode, encode, hash } from '@did-btcr2/common';
import type { SignedBTCR2Update } from '@did-btcr2/cryptosuite';
import type { BeaconProcessResult, DataNeed } from '../resolver.js';
import type { SidecarData } from '../types.js';
import type { BroadcastOptions } from './beacon.js';
import { Beacon } from './beacon.js';
import type { BeaconService, BeaconSignal, BlockMetadata, CasPublishFn } from './interfaces.js';

/**
 * CAS-specific broadcast options — extends {@link BroadcastOptions} with an optional
 * `casPublish` callback used to publish the CAS Announcement off-chain after the
 * OP_RETURN signal is broadcast.
 */
export interface CASBroadcastOptions extends BroadcastOptions {
  casPublish?: CasPublishFn;
}

/**
 * Implements {@link https://dcdpr.github.io/did-btcr2/terminology.html#cas-beacon | CAS Beacon}.
 *
 * A CAS (Content-Addressed Store) Beacon aggregates updates for multiple DIDs
 * into a single CAS Announcement — a mapping of DIDs to their update hashes.
 * The hash of the CAS Announcement is broadcast on-chain via OP_RETURN.
 * During resolution, the CAS Announcement is retrieved from the sidecar (or CAS)
 * and used to look up the individual signed update for the DID being resolved.
 *
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
   *
   * For each signal, the signalBytes contain the hex-encoded hash of a CAS Announcement.
   * The CAS Announcement maps DIDs to their base64url-encoded update hashes.
   * This method looks up the CAS Announcement from the sidecar, extracts the update
   * hash for the DID being resolved, and retrieves the corresponding signed update from sidecar.
   *
   * @param {Array<BeaconSignal>} signals The array of Beacon Signals to process.
   * @param {SidecarData} sidecar The sidecar data associated with the CAS Beacon.
   * @returns {BeaconProcessResult} Successfully resolved updates and any data needs.
   * @throws {CASBeaconError} if hash verification fails (validation errors only).
   */
  processSignals(
    signals: Array<BeaconSignal>,
    sidecar: SidecarData
  ): BeaconProcessResult {
    const updates = new Array<[SignedBTCR2Update, BlockMetadata]>();
    const needs = new Array<DataNeed>();

    // Extract the DID from the beacon service id (strip the #fragment)
    const did = this.service.id.split('#')[0];

    for(const signal of signals) {
      // Signal bytes are hex — matches hex-keyed sidecar maps directly
      const announcementHash = signal.signalBytes;

      // Look up the CAS Announcement in sidecar casMap
      const casAnnouncement = sidecar.casMap.get(announcementHash);

      if(!casAnnouncement) {
        // CAS Announcement not available — emit a need
        needs.push({
          kind              : 'NeedCASAnnouncement',
          announcementHash,
          beaconServiceId   : this.service.id
        });
        continue;
      }

      // Look up this DID's update hash in the CAS Announcement
      // Announcement values are base64urlnopad per spec — convert to hex for map lookup
      const updateHashEncoded = casAnnouncement[did];

      // If no entry for this DID, this announcement doesn't contain an update for us — skip
      if(!updateHashEncoded) {
        continue;
      }

      const updateHash = encode(decode(updateHashEncoded, 'base64urlnopad'), 'hex');

      // Look up the signed update in sidecar updateMap
      const signedUpdate = sidecar.updateMap.get(updateHash);

      if(!signedUpdate) {
        // Signed update not available — emit a need
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
   * Broadcasts a CAS Beacon signal to the Bitcoin network.
   *
   * Creates a CAS Announcement mapping the DID to the update hash, broadcasts the hash of the
   * announcement via OP_RETURN, and optionally publishes the announcement off-chain via the
   * supplied `casPublish` callback. UTXO selection, PSBT construction, fee estimation, signing,
   * and broadcast are delegated to {@link Beacon.buildSignAndBroadcast}.
   *
   * @param {SignedBTCR2Update} signedUpdate The signed BTCR2 update to broadcast.
   * @param {KeyBytes} secretKey The secret key for signing the Bitcoin transaction.
   * @param {BitcoinConnection} bitcoin The Bitcoin network connection.
   * @param {CASBroadcastOptions} [options] Optional broadcast configuration, including a
   *   `casPublish` callback to publish the announcement off-chain and a `feeEstimator`.
   * @returns {Promise<SignedBTCR2Update>} The signed update that was broadcast.
   * @throws {BeaconError} if the bitcoin address is invalid, unfunded, or UTXO cannot cover the fee.
   */
  async broadcastSignal(
    signedUpdate: SignedBTCR2Update,
    secretKey: KeyBytes,
    bitcoin: BitcoinConnection,
    options?: CASBroadcastOptions
  ): Promise<SignedBTCR2Update> {
    // Extract the DID from the beacon service id (strip the #fragment)
    const did = this.service.id.split('#')[0];

    // Hash the signed update (base64urlnopad for the CAS Announcement entry per spec)
    const updateHash = canonicalHash(signedUpdate);

    // Create the CAS Announcement mapping this DID to its update hash
    const casAnnouncement = { [did]: updateHash };

    // Canonicalize and hash the CAS Announcement for the OP_RETURN output
    const announcementHash = hash(canonicalize(casAnnouncement));

    // Delegate UTXO selection, PSBT construction, fee estimation, signing, and broadcast
    await this.buildSignAndBroadcast(announcementHash, secretKey, bitcoin, options);

    // Publish CAS Announcement to content-addressed store if callback provided
    if(options?.casPublish) {
      await options.casPublish(casAnnouncement);
    }

    return signedUpdate;
  }
}

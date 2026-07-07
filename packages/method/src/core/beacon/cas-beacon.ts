import type { BitcoinConnection } from '@did-btcr2/bitcoin';
import { canonicalHash, canonicalize, decode, encode, hash } from '@did-btcr2/common';
import type { SignedBTCR2Update } from '../btcr2-update.js';
import type { Signer } from '@did-btcr2/keypair';
import type { BeaconProcessResult, DataNeed } from '../resolver.js';
import type { SidecarData } from '../types.js';
import type { BroadcastOptions, BroadcastResult } from './beacon.js';
import { SinglePartyBeacon } from './beacon.js';
import type { BeaconService, BeaconSignal, BlockMetadata, CasPublishFn } from './interfaces.js';

/**
 * CAS-specific broadcast options: extends {@link BroadcastOptions} with an optional
 * `casPublish` callback used to publish the CAS Announcement off-chain before the
 * OP_RETURN signal transaction is broadcast. A publish failure aborts the broadcast
 * while the beacon UTXO is still unspent.
 */
export interface CASBroadcastOptions extends BroadcastOptions {
  casPublish?: CasPublishFn;
}

/**
 * Implements {@link https://dcdpr.github.io/did-btcr2/terminology.html#cas-beacon | CAS Beacon}.
 *
 * A CAS (Content-Addressed Store) Beacon aggregates updates for multiple DIDs
 * into a single CAS Announcement: a mapping of DIDs to their update hashes.
 * The hash of the CAS Announcement is broadcast on-chain via OP_RETURN.
 * During resolution, the CAS Announcement is retrieved from the sidecar (or CAS)
 * and used to look up the individual signed update for the DID being resolved.
 *
 * ## CAS announcement hash chain
 *
 * Resolution links an on-chain signal to a signed update through two hashes, with
 * an encoding transition at each hop. The write path ({@link broadcastSignal})
 * produces both hashes; the read path ({@link processSignals}) re-derives them:
 *
 * 1. **Signal hop.** The OP_RETURN payload is `canonicalHash(announcement)` in
 *    **hex**: this is `signal.signalBytes` and the lookup key into `sidecar.casMap`.
 *    Broadcast emits `hash(canonicalize(announcement))`; the resolver keys `casMap`
 *    by `canonicalHash(announcement, { encoding: 'hex' })`. These are the same bytes,
 *    so `signalBytes === canonicalHash(announcement, hex)`.
 * 2. **Update hop.** Each `announcement[did]` is `canonicalHash(signedUpdate)` in
 *    **base64urlnopad** (per spec). It is decoded back to **hex** to key
 *    `sidecar.updateMap`, so `hex(decode(announcement[did])) === canonicalHash(signedUpdate, hex)`.
 *
 * Both links are enforced when sidecar data is supplied via `Resolver.provide()`
 * (which validates the provided announcement and update against the need's hash),
 * and structurally when sidecar maps are pre-loaded (they are keyed by
 * `canonicalHash`, so a mismatched entry simply misses the lookup). The two
 * encoding transitions (hex for on-chain and map keys, base64urlnopad for
 * announcement values) are the subtle part: a regression test pins them.
 *
 * @class CASBeacon
 * @type {CASBeacon}
 * @extends {SinglePartyBeacon}
 */
export class CASBeacon extends SinglePartyBeacon {
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
      // Signal bytes are hex, matches hex-keyed sidecar maps directly
      const announcementHash = signal.signalBytes;

      // Look up the CAS Announcement in sidecar casMap
      const casAnnouncement = sidecar.casMap.get(announcementHash);

      if(!casAnnouncement) {
        // CAS Announcement not available, emit a need
        needs.push({
          kind              : 'NeedCASAnnouncement',
          announcementHash,
          beaconServiceId   : this.service.id
        });
        continue;
      }

      // Look up this DID's update hash in the CAS Announcement
      // Announcement values are base64urlnopad per spec, convert to hex for map lookup
      const updateHashEncoded = casAnnouncement[did];

      // If no entry for this DID, this announcement doesn't contain an update for us, skip
      if(!updateHashEncoded) {
        continue;
      }

      const updateHash = encode(decode(updateHashEncoded, 'base64urlnopad'), 'hex');

      // Look up the signed update in sidecar updateMap
      const signedUpdate = sidecar.updateMap.get(updateHash);

      if(!signedUpdate) {
        // Signed update not available, emit a need
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
   * Creates a CAS Announcement mapping the DID to the update hash, optionally publishes the
   * announcement off-chain via the supplied `casPublish` callback, then broadcasts the hash of
   * the announcement via OP_RETURN. UTXO selection, PSBT construction, fee estimation, signing,
   * and broadcast are delegated to {@link SinglePartyBeacon.buildSignAndBroadcast}.
   *
   * The CAS publish happens **before** the transaction broadcast: a publish failure aborts the
   * operation while the beacon UTXO is still unspent, so no on-chain signal ever points at an
   * announcement that failed to publish. The announcement is content-addressed, so a retry
   * after a failed broadcast re-publishes the same bytes to the same address (idempotent).
   *
   * @param {SignedBTCR2Update} signedUpdate The signed BTCR2 update to broadcast.
   * @param {Signer} signer Signer that produces the ECDSA signature for the Bitcoin transaction.
   * @param {BitcoinConnection} bitcoin The Bitcoin network connection.
   * @param {CASBroadcastOptions} [options] Optional broadcast configuration, including a
   *   `casPublish` callback to publish the announcement off-chain and a `feeEstimator`.
   * @returns {Promise<BroadcastResult>} The signed update, the signal txid, and the CAS
   *   Announcement (capture it for sidecar distribution when no `casPublish` is supplied).
   * @throws {BeaconError} if the bitcoin address is invalid, unfunded, or UTXO cannot cover the fee.
   */
  async broadcastSignal(
    signedUpdate: SignedBTCR2Update,
    signer: Signer,
    bitcoin: BitcoinConnection,
    options?: CASBroadcastOptions
  ): Promise<BroadcastResult> {
    // Extract the DID from the beacon service id (strip the #fragment)
    const did = this.service.id.split('#')[0];

    // Hash the signed update (base64urlnopad for the CAS Announcement entry per spec)
    const updateHash = canonicalHash(signedUpdate);

    // Create the CAS Announcement mapping this DID to its update hash
    const casAnnouncement = { [did]: updateHash };

    // Canonicalize and hash the CAS Announcement for the OP_RETURN output
    const announcementHash = hash(canonicalize(casAnnouncement));

    // Publish the announcement to the content-addressed store before spending the
    // beacon UTXO, so a publish failure aborts pre-spend.
    if(options?.casPublish) {
      await options.casPublish(casAnnouncement);
    }

    // Delegate UTXO selection, PSBT construction, fee estimation, signing, and broadcast
    const txid = await this.buildSignAndBroadcast(announcementHash, signer, bitcoin, options);

    return { signedUpdate, txid, announcement: casAnnouncement };
  }
}

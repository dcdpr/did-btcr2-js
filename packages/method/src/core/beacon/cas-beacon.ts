import type { BitcoinConnection } from '@did-btcr2/bitcoin';
import { canonicalHash, canonicalize, hash, MISSING_UPDATE_DATA } from '@did-btcr2/common';
import type { SignedBTCR2Update } from '../btcr2-update.js';
import type { Signer } from '@did-btcr2/keypair';
import { base64UrlHashHex } from '../../utils/base64url-hash.js';
import type { BeaconProcessResult, DataNeed } from '../resolver.js';
import type { SidecarData } from '../types.js';
import type { BroadcastOptions, BroadcastResult } from './beacon.js';
import { SinglePartyBeacon } from './beacon.js';
import { CASBeaconError } from './error.js';
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
   * @param {string} did The absolute did:btcr2 identifier this beacon serves.
   */
  constructor(service: BeaconService, did: string) {
    super({ ...service, type: 'CASBeacon' }, did);
  }

  /**
   * Implements {@link https://dcdpr.github.io/did-btcr2/operations/resolve.html#process-cas-beacon | 7.2.e.1 Process CAS Beacon}.
   *
   * For each signal, the signalBytes contain the hex-encoded hash of a CAS Announcement.
   * The CAS Announcement maps DIDs to their base64url-encoded update hashes.
   * This method looks up the CAS Announcement in the sidecar. It reads the decoded
   * value of the entry for the DID under resolution as `update_hash`. Then it gets
   * the signed update with that hash from the sidecar. Only an announcement with no
   * entry for the DID announces no update for it.
   *
   * @param {Array<BeaconSignal>} signals The array of Beacon Signals to process.
   * @param {SidecarData} sidecar The sidecar data associated with the CAS Beacon.
   * @returns {BeaconProcessResult} Successfully resolved updates and any data needs.
   * @throws {CASBeaconError} `MISSING_UPDATE_DATA` if the announcement has an entry for
   *   the DID whose value is not a base64url SHA-256 hash (32 bytes, no padding, zero
   *   pad bits).
   */
  processSignals(
    signals: Array<BeaconSignal>,
    sidecar: SidecarData
  ): BeaconProcessResult {
    const updates = new Array<[SignedBTCR2Update, BlockMetadata]>();
    const needs = new Array<DataNeed>();

    // The DID under resolution keys this beacon's announcement entry.
    const did = this.did;

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

      // "Process CAS Beacon": only an announcement with no entry for this DID
      // announces no update for it, so skip the signal.
      if(!Object.hasOwn(casAnnouncement, did)) {
        continue;
      }

      // The decoded value of the entry is update_hash. Announcement values are
      // base64url with no padding. The code converts the decoded value to hex for
      // the map lookup. A value that does not decode to 32 bytes cannot match a
      // signed update, so the data that the signal announces is not available:
      // MISSING_UPDATE_DATA.
      const updateHashEncoded = casAnnouncement[did];
      const updateHash = base64UrlHashHex(updateHashEncoded);
      if(updateHash === undefined) {
        throw new CASBeaconError(
          `The value of the CAS announcement entry for ${did} is not a base64url SHA-256 hash.`,
          MISSING_UPDATE_DATA,
          { did, value: updateHashEncoded, announcementHash, beaconServiceId: this.service.id }
        );
      }

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
    // The DID this beacon serves keys its announcement entry.
    const did = this.did;

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

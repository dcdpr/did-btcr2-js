import { canonicalHash, canonicalize, hash } from '@did-btcr2/common';
import type { SignedBTCR2Update } from '@did-btcr2/cryptosuite';
import type { SerializedSMTProof, TreeEntry } from '@did-btcr2/smt';
import { BTCR2MerkleTree } from '@did-btcr2/smt';
import { hexToBytes, randomBytes } from '@noble/hashes/utils';
import { keyAggExport, keyAggregate, sortKeys } from '@scure/btc-signer/musig2';
import { crypto as btcCrypto, payments } from 'bitcoinjs-lib';
import type { CASAnnouncement } from '../types.js';
import { AggregationCohortError } from './errors.js';

export type AggregationCohortParams = {
  id?: string;
  serviceDid?: string;
  minParticipants?: number;
  network: string;
  beaconType?: string;
};

/**
 * Represents an Aggregation Cohort — a set of Aggregation Participants who
 * submitted cryptographic material to an Aggregation Service to coordinate
 * signing of a shared n-of-n MuSig2 Bitcoin transaction.
 *
 * This is a pure data class — it holds cohort state and provides computation
 * helpers (key aggregation, CAS Announcement building, SMT tree building).
 * It performs no I/O and emits no messages. Both AggregationService and
 * AggregationParticipant create their own AggregationCohort instances to
 * track their respective views of the cohort state.
 *
 * @class AggregationCohort
 */
export class AggregationCohort {
  /** Unique identifier for the cohort. */
  id: string;

  /** DID of the Aggregation Service managing this cohort. */
  serviceDid: string;

  /** Minimum number of participants required to finalize the cohort. */
  minParticipants: number;

  /** Network on which the cohort operates (mainnet, mutinynet, etc.). */
  network: string;

  /** Type of beacon used in the cohort: 'CASBeacon' or 'SMTBeacon'. */
  beaconType: string;

  /** List of participant DIDs that have been accepted into the cohort. */
  participants: Array<string> = [];

  /** Sorted list of cohort participants' compressed public keys. */
  #cohortKeys: Array<Uint8Array> = [];

  /** Taproot tweak (BIP-341 key-path-only). */
  trMerkleRoot: Uint8Array = new Uint8Array();

  /** The n-of-n MuSig2 Taproot beacon address. */
  beaconAddress: string = '';

  /** Pending DID updates submitted by participants, keyed by DID. */
  pendingUpdates: Map<string, SignedBTCR2Update> = new Map();

  /** CAS Beacon Announcement Map (DID → updateHash), set by buildCASAnnouncement(). */
  casAnnouncement?: CASAnnouncement;

  /** Per-participant SMT proofs, set by buildSMTTree(). */
  smtProofs?: Map<string, SerializedSMTProof>;

  /** Signal bytes (32 bytes) for OP_RETURN: SHA-256 of CAS announcement OR SMT root. */
  signalBytes?: Uint8Array;

  /** Set of participant DIDs that have approved the aggregated data. */
  validationAcks: Set<string> = new Set();

  /** Set of participant DIDs that have rejected the aggregated data. */
  validationRejections: Set<string> = new Set();

  constructor({ id, minParticipants, serviceDid, network, beaconType }: AggregationCohortParams) {
    this.id = id || crypto.randomUUID();
    this.minParticipants = minParticipants || 2;
    this.serviceDid = serviceDid || '';
    this.network = network;
    this.beaconType = beaconType || 'CASBeacon';
  }

  /** Sorted cohort keys (sorted on assignment per BIP-327). */
  get cohortKeys(): Array<Uint8Array> {
    return this.#cohortKeys;
  }

  set cohortKeys(keys: Array<Uint8Array>) {
    this.#cohortKeys = sortKeys(keys);
  }

  /**
   * Computes the n-of-n MuSig2 Taproot beacon address from cohort keys.
   * Sets `trMerkleRoot` to the BIP-341 key-path-only tweak.
   */
  public computeBeaconAddress(): string {
    if(this.#cohortKeys.length === 0) {
      throw new AggregationCohortError(
        'Cannot compute beacon address: no cohort keys.',
        'NO_COHORT_KEYS', { cohortId: this.id }
      );
    }
    const keyAggContext = keyAggregate(this.#cohortKeys);
    const aggPubkey = keyAggExport(keyAggContext);
    const payment = payments.p2tr({ internalPubkey: aggPubkey });

    // BIP-341: key-path-only P2TR has no script tree, so payment.hash is null.
    // Compute the tweak: taggedHash("TapTweak", internalPubkey).
    this.trMerkleRoot = payment.hash ?? btcCrypto.taggedHash('TapTweak', aggPubkey);

    if(!payment.address) {
      throw new AggregationCohortError(
        'Failed to compute Taproot address',
        'BEACON_ADDRESS_ERROR', { cohortId: this.id }
      );
    }
    this.beaconAddress = payment.address;
    return payment.address;
  }

  /**
   * Validates that the participant's key is in the cohort and the beacon address
   * matches the locally-computed one. Used by participants to verify cohort ready
   * messages from the service.
   */
  public validateMembership(
    participantPkHex: string,
    cohortKeysHex: Array<string>,
    expectedBeaconAddress: string
  ): void {
    if(!cohortKeysHex.includes(participantPkHex)) {
      throw new AggregationCohortError(
        `Participant key not found in cohort ${this.id}.`,
        'COHORT_VALIDATION_ERROR', { cohortId: this.id, participantPkHex }
      );
    }
    this.cohortKeys = cohortKeysHex.map(k => hexToBytes(k));
    const computed = this.computeBeaconAddress();
    if(computed !== expectedBeaconAddress) {
      throw new AggregationCohortError(
        `Computed beacon address ${computed} does not match expected ${expectedBeaconAddress}.`,
        'BEACON_ADDRESS_MISMATCH', { cohortId: this.id, computed, expected: expectedBeaconAddress }
      );
    }
  }

  public addUpdate(participantDid: string, signedUpdate: SignedBTCR2Update): void {
    if(!this.participants.includes(participantDid)) {
      throw new AggregationCohortError(
        `Participant ${participantDid} is not in cohort ${this.id}.`,
        'UNKNOWN_PARTICIPANT', { cohortId: this.id, participantDid }
      );
    }
    this.pendingUpdates.set(participantDid, signedUpdate);
  }

  public hasAllUpdates(): boolean {
    return this.pendingUpdates.size === this.participants.length;
  }

  /**
   * Builds a CAS Announcement Map from collected updates.
   * Maps each participant DID → base64url canonical hash of their signed update.
   * Computes signal bytes as SHA-256 of canonicalized announcement.
   */
  public buildCASAnnouncement(): CASAnnouncement {
    if(!this.hasAllUpdates()) {
      throw new AggregationCohortError(
        'Cannot build CAS Announcement: not all updates collected.',
        'INCOMPLETE_UPDATES', { cohortId: this.id, collected: this.pendingUpdates.size, total: this.participants.length }
      );
    }
    const announcement: CASAnnouncement = {};
    for(const [did, signedUpdate] of this.pendingUpdates) {
      announcement[did] = canonicalHash(signedUpdate);
    }
    this.casAnnouncement = announcement;
    this.signalBytes = hash(canonicalize(announcement));
    return announcement;
  }

  /**
   * Builds an SMT tree from collected updates.
   * Each entry uses a random 32-byte nonce + canonicalized signed update bytes.
   * Stores per-participant proofs and the SMT root as signalBytes.
   */
  public buildSMTTree(): Map<string, SerializedSMTProof> {
    if(!this.hasAllUpdates()) {
      throw new AggregationCohortError(
        'Cannot build SMT tree: not all updates collected.',
        'INCOMPLETE_UPDATES', { cohortId: this.id }
      );
    }
    const tree = new BTCR2MerkleTree();
    const entries: TreeEntry[] = [];
    const encoder = new TextEncoder();

    for(const [did, signedUpdate] of this.pendingUpdates) {
      const canonicalBytes = encoder.encode(canonicalize(signedUpdate));
      const nonce = randomBytes(32);
      entries.push({ did, nonce, signedUpdate: canonicalBytes });
    }

    tree.addEntries(entries);
    tree.finalize();

    this.signalBytes = tree.rootHash;
    this.smtProofs = new Map();
    for(const [did] of this.pendingUpdates) {
      this.smtProofs.set(did, tree.proof(did));
    }
    return this.smtProofs;
  }

  public addValidation(participantDid: string, approved: boolean): void {
    if(!this.participants.includes(participantDid)) {
      throw new AggregationCohortError(
        `Unknown participant ${participantDid} in cohort ${this.id}.`,
        'UNKNOWN_PARTICIPANT', { cohortId: this.id, participantDid }
      );
    }
    if(approved) {
      this.validationAcks.add(participantDid);
    } else {
      this.validationRejections.add(participantDid);
    }
  }

  /**
   * True when every participant has either approved or rejected the aggregated data.
   */
  public hasAllValidationResponses(): boolean {
    return this.validationAcks.size + this.validationRejections.size === this.participants.length;
  }

  /**
   * True when all participants approved. Note: differs from {@link hasAllValidationResponses} —
   * this returns false if any participant rejected, even if all responses are in.
   */
  public isFullyValidated(): boolean {
    return this.validationRejections.size === 0
      && this.validationAcks.size === this.participants.length;
  }
}

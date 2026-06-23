import { getNetwork } from '@did-btcr2/bitcoin';
import { canonicalHash, canonicalize, hash } from '@did-btcr2/common';
import type { SignedBTCR2Update } from '@did-btcr2/cryptosuite';
import type { SerializedSMTProof, TreeEntry } from '@did-btcr2/smt';
import { BTCR2MerkleTree } from '@did-btcr2/smt';
import { schnorr } from '@noble/curves/secp256k1.js';
import { concatBytes, hexToBytes, randomBytes } from '@noble/hashes/utils';
import { p2tr } from '@scure/btc-signer';
import { keyAggExport, keyAggregate, sortKeys } from '@scure/btc-signer/musig2';
import type { CASAnnouncement } from '../types.js';
import { AggregationCohortError } from './errors.js';
import type { FundingModel } from './recovery-policy.js';
import { DEFAULT_FUNDING_MODEL, buildRecoveryLeaves, resolveFallbackThreshold } from './recovery-policy.js';

export type AggregationCohortParams = {
  id?: string;
  serviceDid?: string;
  minParticipants?: number;
  network: string;
  beaconType?: string;
  /** Operator recovery key, x-only (32 bytes). Required to compute the beacon address. */
  recoveryKey?: Uint8Array;
  /** Relative-timelock (BIP-68 nSequence) before recovery is spendable. Required to compute the beacon address. */
  recoverySequence?: number;
  /** Funding model governing the recovery leaves. Defaults to 'operator-funded'. */
  fundingModel?: FundingModel;
  /** Advertised k of the k-of-n fallback leaf. Absent defaults to n-1 at address computation. */
  fallbackThreshold?: number;
};

/**
 * Represents an Aggregation Cohort: a set of Aggregation Participants who
 * submitted cryptographic material to an Aggregation Service to coordinate
 * signing of a shared n-of-n MuSig2 Bitcoin transaction.
 *
 * This is a pure data class: it holds cohort state and provides computation
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

  /**
   * Mapping from participant DID to their compressed secp256k1 public key.
   * Distinct from {@link cohortKeys} (which is sorted per BIP-327): this lets
   * callers look up a participant's key without knowing their position in the
   * sorted array. Populated by the service at `acceptParticipant` time.
   */
  participantKeys: Map<string, Uint8Array> = new Map();

  /** Sorted list of cohort participants' compressed public keys. */
  #cohortKeys: Array<Uint8Array> = [];

  /**
   * BIP-341 TapTweak scalar: `taggedHash("TapTweak", internalPubkey || tapMerkleRoot)`.
   * The beacon output is an internal key (the MuSig2 aggregate) plus a script
   * tree (the recovery leaves), so the tweak commits to the tree's Merkle root.
   * The MuSig2 signing session applies this as an x-only tweak; a value that does
   * not match the root the funded address was derived from silently yields an
   * invalid key-path signature.
   */
  tapTweak: Uint8Array = new Uint8Array();

  /** The n-of-n MuSig2 aggregate internal key, x-only (32 bytes), set by computeBeaconAddress(). */
  internalKey: Uint8Array = new Uint8Array();

  /** BIP-341 Taproot Merkle root of the recovery script tree, set by computeBeaconAddress(). */
  tapMerkleRoot: Uint8Array = new Uint8Array();

  /** Operator recovery key, x-only (32 bytes). Used to build the CSV recovery leaf. */
  recoveryKey?: Uint8Array;

  /** Relative-timelock (BIP-68 nSequence) before the recovery leaf is spendable. */
  recoverySequence?: number;

  /** Funding model governing the recovery leaves (default 'operator-funded'). */
  fundingModel: FundingModel;

  /**
   * Advertised k of the k-of-n fallback leaf, or undefined to default to n-1 at
   * address computation. Read the resolved value via {@link effectiveFallbackThreshold}.
   */
  fallbackThreshold?: number;

  /** The Taproot beacon address: key path is the MuSig2 aggregate, script path is fallback + recovery. */
  beaconAddress: string = '';

  /** Pending DID updates submitted by participants, keyed by DID. */
  pendingUpdates: Map<string, SignedBTCR2Update> = new Map();

  /**
   * Participant DIDs that explicitly declined to submit an update this round
   * (cooperative non-inclusion). A decliner is absent from the CAS Announcement
   * Map and carries a non-inclusion leaf in the SMT, yet still signs. Kept
   * disjoint from {@link pendingUpdates} so CAS correctness holds by construction.
   */
  nonIncluded: Set<string> = new Set();

  /** CAS Beacon Announcement Map (DID to updateHash), set by buildCASAnnouncement(). */
  casAnnouncement?: CASAnnouncement;

  /** Per-participant SMT proofs, set by buildSMTTree(). */
  smtProofs?: Map<string, SerializedSMTProof>;

  /** Signal bytes (32 bytes) for OP_RETURN: SHA-256 of CAS announcement OR SMT root. */
  signalBytes?: Uint8Array;

  /** Set of participant DIDs that have approved the aggregated data. */
  validationAcks: Set<string> = new Set();

  /** Set of participant DIDs that have rejected the aggregated data. */
  validationRejections: Set<string> = new Set();

  constructor({ id, minParticipants, serviceDid, network, beaconType, recoveryKey, recoverySequence, fundingModel, fallbackThreshold }: AggregationCohortParams) {
    this.id = id || crypto.randomUUID();
    // `?? 2` (not `|| 2`) so a deliberately-passed 0 is preserved rather than
    // silently coerced; the service rejects an invalid count at createCohort.
    this.minParticipants = minParticipants ?? 2;
    this.serviceDid = serviceDid || '';
    this.network = network;
    this.beaconType = beaconType || 'CASBeacon';
    this.recoveryKey = recoveryKey;
    this.recoverySequence = recoverySequence;
    this.fundingModel = fundingModel ?? DEFAULT_FUNDING_MODEL;
    this.fallbackThreshold = fallbackThreshold;
  }

  /** Sorted cohort keys (sorted on assignment per BIP-327). */
  get cohortKeys(): Array<Uint8Array> {
    return this.#cohortKeys;
  }

  set cohortKeys(keys: Array<Uint8Array>) {
    this.#cohortKeys = sortKeys(keys);
  }

  /**
   * The resolved k of the k-of-n fallback leaf: the advertised
   * {@link fallbackThreshold}, or n-1 (floored at 1) when unadvertised, where n is
   * the current cohort size. This is the value the beacon address commits to and
   * the spend builders must reproduce. Returns 0 before any cohort keys are set.
   */
  public get effectiveFallbackThreshold(): number {
    if(this.#cohortKeys.length === 0) return 0;
    return resolveFallbackThreshold(this.fallbackThreshold, this.#cohortKeys.length);
  }

  /**
   * Computes the Taproot beacon address from the cohort keys and recovery params.
   *
   * The output's key path is the n-of-n MuSig2 aggregate of the cohort keys; its
   * script path is the recovery tree (a CSV recovery leaf so a missing signer
   * cannot permanently lock the UTXO). Sets `internalKey`, `tapMerkleRoot`, and
   * the `tapTweak` the MuSig2 session must apply for the key-path spend.
   *
   * The tweak is derived from the Merkle root the address was built with (read
   * back from the payment), never recomputed by hand, so the MuSig2 key-path
   * signature is guaranteed to validate against the funded address.
   */
  public computeBeaconAddress(): string {
    if(this.#cohortKeys.length === 0) {
      throw new AggregationCohortError(
        'Cannot compute beacon address: no cohort keys.',
        'NO_COHORT_KEYS', { cohortId: this.id }
      );
    }
    if(!this.recoveryKey || this.recoveryKey.length === 0 || this.recoverySequence === undefined) {
      throw new AggregationCohortError(
        'Cannot compute beacon address: missing recovery key or sequence.',
        'NO_RECOVERY_PARAMS', { cohortId: this.id }
      );
    }
    const keyAggContext = keyAggregate(this.#cohortKeys);
    const aggPubkey = keyAggExport(keyAggContext);

    // The beacon output commits to the script tree (k-of-n fallback leaf + CSV
    // recovery leaf) alongside the MuSig2 internal key. Derive the address for
    // the cohort's network. Without the network arg p2tr defaults to mainnet, so
    // a mutinynet/signet/regtest cohort would otherwise advertise a `bc1p...`
    // address that no participant can fund.
    const leaves = buildRecoveryLeaves(this.fundingModel, {
      recoveryKey       : this.recoveryKey,
      recoverySequence  : this.recoverySequence,
      cohortKeys        : this.#cohortKeys,
      fallbackThreshold : resolveFallbackThreshold(this.fallbackThreshold, this.#cohortKeys.length),
    });
    // allowUnknownOutputs: the CSV recovery leaf is a custom script, not one of
    // p2tr's recognized templates (tr_ns/tr_ms), so the template check must be
    // waived. The leaf hash (and thus the address) is computed from the raw
    // script bytes regardless.
    const payment = p2tr(aggPubkey, leaves, getNetwork(this.network), true);

    // BIP-341: the key-path tweak commits to the script tree's Merkle root.
    // taggedHash("TapTweak", internalPubkey || tapMerkleRoot). Use the root the
    // library committed to (payment.tapMerkleRoot) so the tweak matches the
    // funded address byte-for-byte.
    this.internalKey = aggPubkey;
    this.tapMerkleRoot = payment.tapMerkleRoot;
    this.tapTweak = schnorr.utils.taggedHash('TapTweak', concatBytes(aggPubkey, payment.tapMerkleRoot));

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

  /**
   * Returns the position of a participant's public key in the sorted
   * {@link cohortKeys} array, or -1 if the participant is not in the cohort.
   * Required by MuSig2 partial-sig verification which indexes by signer position.
   */
  public indexOfParticipant(did: string): number {
    const pk = this.participantKeys.get(did);
    if(!pk) return -1;
    return this.#cohortKeys.findIndex(k =>
      k.length === pk.length && k.every((b, i) => b === pk[i])
    );
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

  /**
   * Record that a participant declined to submit an update this round
   * (cooperative non-inclusion). The member stays in the cohort and still signs.
   */
  public addNonInclusion(participantDid: string): void {
    if(!this.participants.includes(participantDid)) {
      throw new AggregationCohortError(
        `Participant ${participantDid} is not in cohort ${this.id}.`,
        'UNKNOWN_PARTICIPANT', { cohortId: this.id, participantDid }
      );
    }
    // A DID cannot both submit and decline. The service guards re-submission, but
    // keep the invariant local so the response gate and builders stay consistent.
    if(this.pendingUpdates.has(participantDid)) {
      throw new AggregationCohortError(
        `Participant ${participantDid} already submitted an update; cannot also decline.`,
        'CONFLICTING_RESPONSE', { cohortId: this.id, participantDid }
      );
    }
    this.nonIncluded.add(participantDid);
  }

  public hasAllUpdates(): boolean {
    return this.pendingUpdates.size === this.participants.length;
  }

  /**
   * True when every participant has responded for this round, either with an
   * update or with an explicit non-inclusion. This is the aggregation gate when
   * non-inclusion is in play; it generalizes {@link hasAllUpdates} the same way
   * {@link hasAllValidationResponses} generalizes a unanimous ack.
   */
  public hasAllResponses(): boolean {
    return this.pendingUpdates.size + this.nonIncluded.size === this.participants.length;
  }

  /**
   * Builds a CAS Announcement Map from collected updates.
   * Maps each participant DID to base64url canonical hash of their signed update.
   * Computes signal bytes as SHA-256 of canonicalized announcement.
   *
   * Members who declined (cooperative non-inclusion) are naturally absent from
   * the map: the body iterates {@link pendingUpdates}, which never holds a
   * decliner. Absence from the map is exactly the CAS non-inclusion signal.
   */
  public buildCASAnnouncement(): CASAnnouncement {
    if(!this.hasAllResponses()) {
      throw new AggregationCohortError(
        'Cannot build CAS Announcement: not all participants have responded.',
        'INCOMPLETE_RESPONSES', { cohortId: this.id, updates: this.pendingUpdates.size, declined: this.nonIncluded.size, total: this.participants.length }
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
   * Builds an SMT tree with one leaf per participant.
   *
   * A member who submitted an update gets an inclusion leaf
   * (SHA-256(SHA-256(nonce) || SHA-256(update))); a member who declined gets a
   * non-inclusion leaf (SHA-256(SHA-256(nonce)), the `signedUpdate` entry field
   * omitted). The cohort mints each member's nonce and returns it inside that
   * member's serialized proof, so a decliner can self-validate its own
   * non-inclusion slot and the resolver can recompute the leaf. Stores
   * per-participant proofs and the SMT root as signalBytes.
   */
  public buildSMTTree(): Map<string, SerializedSMTProof> {
    if(!this.hasAllResponses()) {
      throw new AggregationCohortError(
        'Cannot build SMT tree: not all participants have responded.',
        'INCOMPLETE_RESPONSES', { cohortId: this.id, updates: this.pendingUpdates.size, declined: this.nonIncluded.size, total: this.participants.length }
      );
    }
    const tree = new BTCR2MerkleTree();
    const entries: TreeEntry[] = [];
    const encoder = new TextEncoder();

    // Slot every participant: an inclusion leaf for submitters, a non-inclusion
    // leaf (signedUpdate omitted) for decliners.
    for(const did of this.participants) {
      const nonce = randomBytes(32);
      const signedUpdate = this.pendingUpdates.get(did);
      if(signedUpdate) {
        entries.push({ did, nonce, signedUpdate: encoder.encode(canonicalize(signedUpdate)) });
      } else {
        entries.push({ did, nonce });
      }
    }

    tree.addEntries(entries);
    tree.finalize();

    this.signalBytes = tree.rootHash;
    this.smtProofs = new Map();
    for(const did of this.participants) {
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
   * True when all participants approved. Note: differs from {@link hasAllValidationResponses},
   * this returns false if any participant rejected, even if all responses are in.
   */
  public isFullyValidated(): boolean {
    return this.validationRejections.size === 0
      && this.validationAcks.size === this.participants.length;
  }
}

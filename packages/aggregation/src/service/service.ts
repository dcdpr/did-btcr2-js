import { canonicalize } from '@did-btcr2/common';
import type { SecuredDocument } from '@did-btcr2/cryptosuite';
import type { CompressedSecp256k1PublicKey } from '@did-btcr2/keypair';
import { schnorr } from '@noble/curves/secp256k1.js';
import { bytesToHex, hexToBytes } from '@noble/hashes/utils';
import type { Transaction } from '@scure/btc-signer';
import { getBeaconStrategy } from '../core/beacon-strategy.js';
import { AggregationCohort } from '../core/cohort.js';
import { validateCohortConditions, type CohortConditions } from '../core/conditions.js';
import { AggregationServiceError } from '../core/errors.js';
import { buildFallbackSpend, fallbackSighash } from '../core/fallback-spend.js';
import type { FallbackSignature } from '../core/fallback-spend.js';
import { buildFallbackLeaf } from '../core/recovery-policy.js';
import type { BaseMessage } from '../core/messages/base.js';
import { AGGREGATION_WIRE_VERSION } from '../core/messages/base.js';
import {
  COHORT_OPT_IN,
  FALLBACK_SIGNATURE,
  NONCE_CONTRIBUTION,
  SIGNATURE_AUTHORIZATION,
  SUBMIT_NONINCLUDED,
  SUBMIT_UPDATE,
  VALIDATION_ACK,
} from '../core/messages/constants.js';
import {
  createAggregatedNonceMessage,
  createAuthorizationRequestMessage,
  createCohortAdvertMessage,
  createCohortOptInAcceptMessage,
  createCohortReadyMessage,
  createDistributeAggregatedDataMessage,
  createFallbackAuthorizationRequestMessage,
} from '../core/messages/factories.js';
import type { ServiceCohortPhaseType } from '../core/phases.js';
import { ServiceCohortPhase, SigningSessionPhase } from '../core/phases.js';
import { BeaconSigningSession } from '../core/signing-session.js';

/**
 * Cohort configuration set by the service operator: the advertised cohort
 * {@link CohortConditions} plus the Bitcoin network. The config must have
 * `beaconType`, `minParticipants`, `recoveryKey`, and `recoverySequence`
 * (ADR 042). The other conditions are optional (absent = unconstrained). See
 * ADR 039.
 */
export interface CohortConfig extends CohortConditions {
  network: string;
}

/** Pending opt-in awaiting service operator approval. */
export interface PendingOptIn {
  cohortId: string;
  participantDid: string;
  participantPk: Uint8Array;
  communicationPk: Uint8Array;
}

/** Validation tracking progress. */
export interface ValidationProgress {
  approved: ReadonlySet<string>;
  rejected: ReadonlySet<string>;
  pending: ReadonlySet<string>;
  total: number;
}

/** Final aggregation result for a cohort. */
export interface AggregationResult {
  cohortId: string;
  /**
   * The 64-byte aggregated MuSig2 signature for the optimistic key path. Empty
   * for a `script-path` result: the k-of-n fallback embeds k separate signatures
   * directly in the witness of {@link signedTx}, with no single aggregate sig.
   */
  signature: Uint8Array;
  signedTx: Transaction;
  /**
   * Which Taproot spend path produced {@link signedTx}: `key-path` is the
   * optimistic n-of-n MuSig2 spend, `script-path` is the k-of-n fallback (ADR
   * 042). Absent is treated as `key-path` for backward compatibility.
   */
  path?: 'key-path' | 'script-path';
}

/** Transaction data needed to start a signing session. */
export interface SigningTxData {
  tx: Transaction;
  prevOutScripts: Uint8Array[];
  prevOutValues: bigint[];
}

/**
 * Reason the service dropped an inbound message or an operator approval. The
 * state machine records the reason of a dropped message. The service runner
 * emits MEMBERSHIP_FINAL and COHORT_FULL for an approval that it cannot apply.
 */
export type RejectionReason =
  | 'WRONG_VERSION'
  | 'UPDATE_TOO_LARGE'
  /**
   * The submitted update is not well formed. One of these conditions is true:
   * - the SUBMIT_UPDATE body has no signedUpdate;
   * - JCS cannot canonicalize the update;
   * - the update has no proof object;
   * - the proof has no verificationMethod string or no non-empty proofValue string.
   */
  | 'UPDATE_MALFORMED'
  /** The proof verificationMethod of the update is not a DID URL of the sender DID. */
  | 'UPDATE_SENDER_MISMATCH'
  /** The sender is not a member of the cohort the message names. */
  | 'NOT_A_MEMBER'
  /** The sender already answered this round or signing step; the first answer stands. */
  | 'DUPLICATE_RESPONSE'
  /** The nonce contribution is not a well-formed MuSig2 public nonce. */
  | 'INVALID_NONCE'
  /** The partial signature does not verify against the sender's key. */
  | 'INVALID_PARTIAL_SIG'
  /** A fallback signature is not from the cohort key of the sender, or it does not verify. */
  | 'INVALID_FALLBACK_SIG'
  /** An opt-in key is not a 33-byte compressed secp256k1 public key. */
  | 'INVALID_PARTICIPANT_KEY'
  /** The operator approved an opt-in after finalizeKeygen made the membership final. */
  | 'MEMBERSHIP_FINAL'
  /** The operator approved an opt-in when the cohort already had maxParticipants members. */
  | 'COHORT_FULL';

/**
 * Record of an inbound message or an operator approval that the service
 * dropped. The state machine records a dropped message, and the runner drains
 * the records to emit events. The service runner emits MEMBERSHIP_FINAL and
 * COHORT_FULL for a dropped approval.
 */
export interface Rejection {
  /** DID of the sender whose message was rejected. */
  from: string;
  /** Machine-readable code. */
  code: RejectionReason;
  /** Human-readable reason. */
  reason: string;
}

/** Per-cohort service state - internal. */
interface ServiceCohortState {
  phase: ServiceCohortPhaseType;
  cohort: AggregationCohort;
  config: CohortConfig;
  pendingOptIns: Map<string, PendingOptIn>;
  acceptedParticipants: Set<string>;
  signingSession?: BeaconSigningSession;
  result?: AggregationResult;
  /**
   * Collected fallback (k-of-n script-path) signatures, keyed by signer DID.
   * Populated only after {@link AggregationService.startFallbackSigning}. Each is
   * a verified standalone BIP-340 signature over the fallback script-path sighash.
   */
  fallbackSignatures?: Map<string, FallbackSignature>;
  /** Rejections accumulated since last drain. Runner polls via drainRejections(). */
  rejections: Array<Rejection>;
}

/** Default maximum canonicalized byte-length of a submitted BTCR2 update. */
export const DEFAULT_MAX_UPDATE_SIZE_BYTES = 256 * 1024;

/**
 * Maximum rejections retained per cohort between drains; the oldest is dropped
 * once the log is full.
 *
 * The receive path records a rejection for every message it drops, including
 * messages from senders who are not cohort members, so the log is written by
 * anyone who can reach the service. A runner drains after each `receive()` and
 * never accumulates; this bound is for callers driving the state machine
 * directly, so an undrained log cannot grow without limit. It never refuses
 * protocol traffic: only diagnostics are dropped.
 */
export const MAX_RETAINED_REJECTIONS = 256;

export interface AggregationServiceParams {
  did: string;
  /**
   * The service's compressed communication public key (placed in cohort adverts).
   * The coordinator never signs - it aggregates public nonces and partial
   * signatures - so it is given a public key only, never a secret-bearing
   * keypair (see ADR 038).
   */
  publicKey: CompressedSecp256k1PublicKey;
  /**
   * Maximum canonicalized byte-length of a signed update body accepted by the
   * service. Submissions above this cap are silently dropped and surfaced as
   * `UPDATE_TOO_LARGE` rejections. Defaults to {@link DEFAULT_MAX_UPDATE_SIZE_BYTES}.
   */
  maxUpdateSizeBytes?: number;
}

/**
 * Sans-I/O state machine for an Aggregation Service.
 *
 * Manages multiple cohorts simultaneously. The service operator drives the
 * state machine via `receive()` (for incoming messages) and explicit action
 * methods (advertising, accepting opt-ins, finalizing keygen, building
 * aggregated data, starting signing). All outgoing messages are returned for
 * the caller to send via whatever transport.
 *
 * @class AggregationService
 */
export class AggregationService {
  readonly did: string;
  readonly publicKey: CompressedSecp256k1PublicKey;
  readonly maxUpdateSizeBytes: number;

  /** Per-cohort state, keyed by cohortId. */
  #cohortStates: Map<string, ServiceCohortState> = new Map();

  constructor({ did, publicKey, maxUpdateSizeBytes }: AggregationServiceParams) {
    this.did = did;
    this.publicKey = publicKey;
    this.maxUpdateSizeBytes = maxUpdateSizeBytes ?? DEFAULT_MAX_UPDATE_SIZE_BYTES;
  }


  /**
   * Sans-I/O entry point for every inbound message.
   *
   * Contract: a message from an untrusted sender never throws out of here. Each
   * handler validates what the message claims before touching cohort or signing
   * state, and records a {@link Rejection} instead of letting the underlying
   * `AggregationCohort` / {@link BeaconSigningSession} invariant throw. A runner
   * turns any escaping error into a cohort failure, so a single throw on the
   * receive path is a cohort-kill anyone able to reach the service could
   * trigger. The action methods (`acceptParticipant`, `startSigning`, ...) still
   * throw: those are operator calls, not attacker input.
   */
  receive(message: BaseMessage): void {
    // Reject messages whose wire version doesn't match what this build speaks.
    // Missing version, treat as legacy and drop: bumping the protocol must be
    // coordinated across all participants.
    const version = message.version;
    if(version === undefined || version !== AGGREGATION_WIRE_VERSION) {
      const cohortId = message.body?.cohortId;
      const state = cohortId ? this.#cohortStates.get(cohortId) : undefined;
      if(state) {
        this.#reject(state, message.from, 'WRONG_VERSION',
          `Expected wire version ${AGGREGATION_WIRE_VERSION}, got ${String(version)}`);
      }
      return;
    }

    const type = message.type;
    switch(type) {
      case COHORT_OPT_IN:
        this.#handleOptIn(message);
        break;
      case SUBMIT_UPDATE:
        this.#handleSubmitUpdate(message);
        break;
      case SUBMIT_NONINCLUDED:
        this.#handleSubmitNonInclusion(message);
        break;
      case VALIDATION_ACK:
        this.#handleValidationAck(message);
        break;
      case NONCE_CONTRIBUTION:
        this.#handleNonceContribution(message);
        break;
      case SIGNATURE_AUTHORIZATION:
        this.#handleSignatureAuthorization(message);
        break;
      case FALLBACK_SIGNATURE:
        this.#handleFallbackSignature(message);
        break;
      default:
        // Unknown message type - silently ignore
        break;
    }
  }

  /**
   * Record a dropped message. The log is bounded by
   * {@link MAX_RETAINED_REJECTIONS}; the oldest entry is discarded once it is
   * full.
   */
  #reject(state: ServiceCohortState, from: string, code: RejectionReason, reason: string): void {
    state.rejections.push({ from, code, reason });
    if(state.rejections.length > MAX_RETAINED_REJECTIONS) {
      state.rejections.shift();
    }
  }

  /**
   * Drain the rejection log for a cohort. A runner uses it to report each
   * message that the state machine dropped (for example a malformed proof, an
   * oversized update, or a wrong wire version) as an event. The state machine
   * stays sans-I/O. The log has no MEMBERSHIP_FINAL or COHORT_FULL record: the
   * service runner emits these codes for an approval that it cannot apply.
   */
  drainRejections(cohortId: string): Array<Rejection> {
    const state = this.#cohortStates.get(cohortId);
    if(!state) return [];
    const out = state.rejections;
    state.rejections = [];
    return out;
  }


  /**
   * Create a new cohort with the given config. Returns the cohort ID.
   * Cohort starts in `Created` phase - call `advertise()` to broadcast.
   */
  createCohort(config: CohortConfig): string {
    // Fail fast on invalid conditions rather than discovering them at finalize.
    const problems = validateCohortConditions(config);
    if(problems.length > 0) {
      throw new AggregationServiceError(
        `Invalid cohort conditions: ${problems.join('; ')}`,
        'INVALID_COHORT_CONDITIONS', { problems }
      );
    }
    const cohort = new AggregationCohort({
      serviceDid        : this.did,
      minParticipants   : config.minParticipants,
      network           : config.network,
      beaconType        : config.beaconType,
      recoveryKey       : hexToBytes(config.recoveryKey),
      recoverySequence  : config.recoverySequence,
      fundingModel      : config.fundingModel,
      fallbackThreshold : config.fallbackThreshold,
    });
    this.#cohortStates.set(cohort.id, {
      phase                : ServiceCohortPhase.Created,
      cohort,
      config,
      pendingOptIns        : new Map(),
      acceptedParticipants : new Set(),
      rejections           : [],
    });
    return cohort.id;
  }

  /**
   * Advertise a cohort to discover participants.
   * Returns the advert message to broadcast.
   */
  advertise(cohortId: string): BaseMessage[] {
    const state = this.#cohortStates.get(cohortId);
    if(!state) {
      throw new AggregationServiceError(`Cohort ${cohortId} not found.`, 'COHORT_NOT_FOUND', { cohortId });
    }
    if(state.phase !== ServiceCohortPhase.Created) {
      throw new AggregationServiceError(
        `Cannot advertise cohort ${cohortId}: phase is ${state.phase}.`,
        'INVALID_PHASE', { cohortId, phase: state.phase }
      );
    }

    // Advertise the full condition set (flat fields, per ADR 039). network is
    // a separate cohort parameter; everything else in config is a condition.
    const { network, ...conditions } = state.config;
    const message = createCohortAdvertMessage({
      from            : this.did,
      cohortId,
      network,
      communicationPk : this.publicKey.compressed,
      ...conditions,
    });

    state.phase = ServiceCohortPhase.Advertised;
    return [message];
  }

  /**
   * Pending opt-ins awaiting operator approval. Empty outside the Advertised
   * phase: after finalizeKeygen the membership is final, and acceptParticipant
   * refuses each opt-in that is still pending.
   */
  pendingOptIns(cohortId: string): ReadonlyMap<string, PendingOptIn> {
    const state = this.#cohortStates.get(cohortId);
    if(!state || state.phase !== ServiceCohortPhase.Advertised) return new Map();
    // Return only those not yet accepted
    const map = new Map<string, PendingOptIn>();
    for(const [did, optIn] of state.pendingOptIns) {
      if(!state.acceptedParticipants.has(did)) {
        map.set(did, optIn);
      }
    }
    return map;
  }

  #handleOptIn(message: BaseMessage): void {
    const cohortId = message.body?.cohortId;
    if(!cohortId) return;
    const state = this.#cohortStates.get(cohortId);
    if(!state) return;
    if(state.phase !== ServiceCohortPhase.Advertised) return;

    const participantDid = message.from;
    const participantPk = message.body?.participantPk;
    const communicationPk = message.body?.communicationPk;
    if(!participantPk || !communicationPk) return;

    // Validate both keys on arrival. The wire guard only asks for bytes, so a
    // three-byte or off-curve key reaches this handler intact, and a stored one
    // is not refused until the operator accepts the sender, inside an operator
    // action the runner is driving. The failure would then belong to the cohort
    // rather than to the sender, and a runner turns it into removeCohort: one
    // opt-in from any stranger destroys an in-flight cohort, and opting in is
    // open to everyone while a cohort is advertised. Rejected here, nothing is
    // stored and the sender can send a well-formed opt-in instead.
    if(!AggregationCohort.isValidCohortKey(participantPk)) {
      this.#reject(state, participantDid, 'INVALID_PARTICIPANT_KEY',
        'Opt-in participantPk is not a 33-byte compressed secp256k1 public key');
      return;
    }
    // communicationPk never joins the MuSig2 key set, but a runner hands it
    // straight to transport.registerPeer, which refuses a key it cannot decode.
    if(!AggregationCohort.isValidCohortKey(communicationPk)) {
      this.#reject(state, participantDid, 'INVALID_PARTICIPANT_KEY',
        'Opt-in communicationPk is not a 33-byte compressed secp256k1 public key');
      return;
    }

    // Reject re-opt-in from already-accepted participants. Without this guard a
    // participant could send a second opt-in with a different key and overwrite
    // pendingOptIns[did]. Then the opt-in record would no longer hold the key
    // that cohortKeys holds for the participant.
    if(state.acceptedParticipants.has(participantDid)) return;

    state.pendingOptIns.set(participantDid, {
      cohortId,
      participantDid,
      participantPk,
      communicationPk,
    });
  }

  /**
   * Service operator accepts a participant's opt-in.
   * Returns the accept message to send.
   * @throws {AggregationServiceError} INVALID_PHASE outside the Advertised phase.
   * finalizeKeygen computes the beacon address from the cohort keys, so the
   * membership is final after it. A key that the service adds later is not in the
   * beacon address that the members got.
   */
  acceptParticipant(cohortId: string, participantDid: string): BaseMessage[] {
    const state = this.#cohortStates.get(cohortId);
    if(!state) {
      throw new AggregationServiceError(`Cohort ${cohortId} not found.`, 'COHORT_NOT_FOUND', { cohortId });
    }
    if(state.phase !== ServiceCohortPhase.Advertised) {
      throw new AggregationServiceError(
        `Cannot accept participant ${participantDid} into cohort ${cohortId}: phase is ${state.phase}.`,
        'INVALID_PHASE', { cohortId, participantDid, phase: state.phase }
      );
    }
    const optIn = state.pendingOptIns.get(participantDid);
    if(!optIn) {
      throw new AggregationServiceError(
        `No pending opt-in from ${participantDid} for cohort ${cohortId}.`,
        'NO_OPT_IN', { cohortId, participantDid }
      );
    }
    if(state.acceptedParticipants.has(participantDid)) {
      throw new AggregationServiceError(
        `Participant ${participantDid} already accepted into cohort ${cohortId}.`,
        'ALREADY_ACCEPTED', { cohortId, participantDid }
      );
    }
    // Enforce the maxParticipants condition: a cohort cannot grow past its
    // advertised ceiling (closes the unbounded-growth path; see ADR 039).
    const maxParticipants = state.config.maxParticipants;
    if(maxParticipants !== undefined && state.acceptedParticipants.size >= maxParticipants) {
      throw new AggregationServiceError(
        `Cohort ${cohortId} is full: ${maxParticipants} participants already accepted.`,
        'COHORT_FULL', { cohortId, maxParticipants }
      );
    }

    // Refuse a key the cohort cannot carry before touching any state. The
    // receive path already refuses one at opt-in; a caller driving the state
    // machine with its own opt-in record (a resumed or externally persisted
    // cohort) still reaches here.
    if(!AggregationCohort.isValidCohortKey(optIn.participantPk)) {
      throw new AggregationServiceError(
        `Cannot accept ${participantDid} into cohort ${cohortId}: participant key is not a 33-byte compressed secp256k1 public key.`,
        'INVALID_PARTICIPANT_KEY', { cohortId, participantDid }
      );
    }

    // Assign the cohort keys first: it is the only step that can refuse, and
    // the membership bookkeeping below cannot. Growing `participants` ahead of
    // it would leave a refused DID a member with no key in the aggregate, and a
    // cohort with more members than keys can never finish a round - every round
    // waits for one contribution per participant.
    state.cohort.cohortKeys = [...state.cohort.cohortKeys, optIn.participantPk];
    state.acceptedParticipants.add(participantDid);
    state.cohort.participants.push(participantDid);
    state.cohort.participantKeys.set(participantDid, optIn.participantPk);

    return [createCohortOptInAcceptMessage({
      from : this.did,
      to   : participantDid,
      cohortId,
    })];
  }

  /**
   * Finalize cohort keygen: compute MuSig2 Taproot beacon address and send
   * COHORT_READY messages to all accepted participants.
   */
  finalizeKeygen(cohortId: string): BaseMessage[] {
    const state = this.#cohortStates.get(cohortId);
    if(!state) {
      throw new AggregationServiceError(`Cohort ${cohortId} not found.`, 'COHORT_NOT_FOUND', { cohortId });
    }
    if(state.phase !== ServiceCohortPhase.Advertised) {
      throw new AggregationServiceError(
        `Cannot finalize keygen for cohort ${cohortId}: phase is ${state.phase}.`,
        'INVALID_PHASE', { cohortId, phase: state.phase }
      );
    }
    if(state.acceptedParticipants.size < state.config.minParticipants) {
      throw new AggregationServiceError(
        `Cohort ${cohortId} has only ${state.acceptedParticipants.size} accepted participants, need ${state.config.minParticipants}.`,
        'NOT_ENOUGH_PARTICIPANTS', { cohortId }
      );
    }
    // Ceiling defense: acceptParticipant already rejects past max, so reaching
    // here over max means state was mutated out-of-band.
    const maxParticipants = state.config.maxParticipants;
    if(maxParticipants !== undefined && state.acceptedParticipants.size > maxParticipants) {
      throw new AggregationServiceError(
        `Cohort ${cohortId} has ${state.acceptedParticipants.size} accepted participants, exceeds max ${maxParticipants}.`,
        'TOO_MANY_PARTICIPANTS', { cohortId, maxParticipants }
      );
    }

    const beaconAddress = state.cohort.computeBeaconAddress();
    state.phase = ServiceCohortPhase.CohortSet;

    const messages: BaseMessage[] = [];
    for(const participantDid of state.cohort.participants) {
      messages.push(createCohortReadyMessage({
        from          : this.did,
        to            : participantDid,
        cohortId,
        beaconAddress,
        cohortKeys    : state.cohort.cohortKeys,
      }));
    }
    return messages;
  }


  /** Updates collected so far for a cohort. */
  collectedUpdates(cohortId: string): ReadonlyMap<string, SecuredDocument> {
    const state = this.#cohortStates.get(cohortId);
    if(!state) return new Map();
    return state.cohort.pendingUpdates;
  }

  /**
   * Handle an incoming SUBMIT_UPDATE message from a participant containing their signed update to
   * submit for aggregation.
   * @param {BaseMessage} message - incoming SUBMIT_UPDATE message containing a participant's signed
   * update to submit for aggregation
   * @returns {void} - no return value; updates the service state with the submitted update if valid
   */
  #handleSubmitUpdate(message: BaseMessage): void {
    const cohortId = message.body?.cohortId;
    if(!cohortId) return;
    const state = this.#cohortStates.get(cohortId);
    if(!state) return;
    if(state.phase !== ServiceCohortPhase.CohortSet && state.phase !== ServiceCohortPhase.CollectingUpdates) return;

    const signedUpdate = message.body?.signedUpdate as SecuredDocument | undefined;
    if(!signedUpdate) {
      this.#reject(state, message.from, 'UPDATE_MALFORMED', 'SUBMIT_UPDATE missing signedUpdate body');
      return;
    }

    // Membership first, before any canonicalization or proof check. An update
    // from a sender that is not a member would reach addUpdate. addUpdate throws
    // UNKNOWN_PARTICIPANT out of receive() and fails the whole cohort.
    // Mirrors the guard in #handleSubmitNonInclusion.
    if(!state.cohort.participants.includes(message.from)) {
      this.#reject(state, message.from, 'NOT_A_MEMBER', 'Sender is not a member of this cohort');
      return;
    }

    // Cap the canonicalized update size before any other work on the body.
    // Without this guard, a participant could submit multi-MB payloads
    // that the service would canonicalize, hash, and aggregate - cheap DoS.
    let canonicalSize: number;
    try {
      canonicalSize = canonicalize(signedUpdate as unknown as Record<string, unknown>).length;
    } catch {
      // Canonicalization is the first thing that touches the body, so anything
      // JCS cannot serialize is dropped here rather than thrown at the caller.
      this.#reject(state, message.from, 'UPDATE_MALFORMED', 'Update could not be canonicalized');
      return;
    }
    if(canonicalSize > this.maxUpdateSizeBytes) {
      this.#reject(state, message.from, 'UPDATE_TOO_LARGE',
        `Canonicalized update is ${canonicalSize} bytes; max allowed is ${this.maxUpdateSizeBytes}`);
      return;
    }

    // Check the proof structure and the sender binding. The service does not
    // verify the signature (ADR 152). It does not hold the current DID document
    // of the sender, so it cannot know which methods of that document can sign.
    const problem = this.#submittedUpdateProblem(message.from, signedUpdate);
    if(problem) {
      this.#reject(state, message.from, problem.code, problem.reason);
      return;
    }

    // One response per round. A member that already declined cannot also submit,
    // and a member that already submitted cannot resubmit (a silent overwrite
    // would corrupt the aggregated data the member already validated against).
    // Both are dropped as rejections, symmetric with #handleSubmitNonInclusion.
    if(state.cohort.nonIncluded.has(message.from)) {
      this.#reject(state, message.from, 'DUPLICATE_RESPONSE',
        'Participant already declined this round; cannot also submit an update');
      return;
    }
    if(state.cohort.pendingUpdates.has(message.from)) {
      this.#reject(state, message.from, 'DUPLICATE_RESPONSE',
        'Participant already submitted an update this round; cannot resubmit');
      return;
    }

    state.cohort.addUpdate(message.from, signedUpdate);

    if(state.phase === ServiceCohortPhase.CohortSet) {
      state.phase = ServiceCohortPhase.CollectingUpdates;
    }
    if(state.cohort.hasAllResponses()) {
      state.phase = ServiceCohortPhase.UpdatesCollected;
    }
  }

  /**
   * Handle an incoming SUBMIT_NONINCLUDED message: a member declares it has no
   * update this round (cooperative non-inclusion). Membership is proven by the
   * signed transport envelope, so the body carries only the cohortId. The member
   * stays in the cohort and still signs; it is absent from the CAS map and
   * carries a non-inclusion leaf in the SMT.
   */
  #handleSubmitNonInclusion(message: BaseMessage): void {
    const cohortId = message.body?.cohortId;
    if(!cohortId) return;
    const state = this.#cohortStates.get(cohortId);
    if(!state) return;
    if(state.phase !== ServiceCohortPhase.CohortSet && state.phase !== ServiceCohortPhase.CollectingUpdates) return;

    // Membership is proven by the signed envelope sender. A non-member decline is
    // dropped as a rejection, never thrown: addNonInclusion would otherwise throw
    // UNKNOWN_PARTICIPANT out of receive() and fail the whole cohort, a DoS any
    // non-member could trigger. Mirrors the membership check of SUBMIT_UPDATE.
    if(!state.cohort.participants.includes(message.from)) {
      this.#reject(state, message.from, 'NOT_A_MEMBER', 'Sender is not a member of this cohort');
      return;
    }

    // One response per round: already submitted or already declined. Surface the
    // conflict as a rejection, symmetric with the double-submit guard above.
    if(state.cohort.pendingUpdates.has(message.from) || state.cohort.nonIncluded.has(message.from)) {
      this.#reject(state, message.from, 'DUPLICATE_RESPONSE', 'Participant already responded this round');
      return;
    }

    state.cohort.addNonInclusion(message.from);

    if(state.phase === ServiceCohortPhase.CohortSet) {
      state.phase = ServiceCohortPhase.CollectingUpdates;
    }
    if(state.cohort.hasAllResponses()) {
      state.phase = ServiceCohortPhase.UpdatesCollected;
    }
  }

  /**
   * Check the structure of the proof of a submitted update, and check that
   * proof.verificationMethod is a DID URL of the sender DID. The service does
   * not verify the signature. It does not hold the current DID document of the
   * sender, so it cannot know which methods can sign an update. A method can
   * sign an update if all of these conditions are true (update.md, resolve.md):
   * - the method is a capabilityInvocation method of that document;
   * - the method has the type Multikey and the DID as the controller;
   * - the publicKeyMultibase of the method encodes a secp256k1 public key, as
   *   the BIP340 Cryptosuite specifies.
   *
   * A resolver verifies the proof. An update with a bad proof harms only the
   * DID of the sender. The CAS map key is that DID, and the SMT leaf index is
   * the SHA-256 hash of that DID.
   * @param {string} sender - the DID of the participant who submitted the update
   * @param {SecuredDocument} signedUpdate - the submitted update
   * @returns {{ code: RejectionReason; reason: string } | undefined} The problem,
   * or undefined if the update passes the checks.
   */
  #submittedUpdateProblem(
    sender: string,
    signedUpdate: SecuredDocument,
  ): { code: RejectionReason; reason: string } | undefined {
    // The sender controls the body, so each member can have any type. Read each
    // member through `unknown`, so a wrong type gives a rejection and not a raw
    // TypeError out of receive().
    const proof: unknown = (signedUpdate as { proof?: unknown }).proof;
    if(typeof proof !== 'object' || proof === null || Array.isArray(proof)) {
      return { code: 'UPDATE_MALFORMED', reason: 'SUBMIT_UPDATE signedUpdate has no proof object' };
    }
    const { verificationMethod, proofValue } = proof as Record<string, unknown>;
    if(typeof verificationMethod !== 'string' || typeof proofValue !== 'string' || proofValue === '') {
      return { code: 'UPDATE_MALFORMED', reason: 'Update proof has no verificationMethod or proofValue string' };
    }

    // An absolute method id is the DID followed by a fragment, a query, or a
    // path ('<did>#key-1', '<did>?key=1', '<did>/keys/1'). This is the rule of
    // Updater.sign on the write path (ADR 147 decision 6). The read path does
    // not check this rule: a resolver accepts each absolute proof id that the
    // capabilityInvocation of the document names. A DID contains no '#', '?',
    // or '/'. Thus the sender DID must be the text before the first of these
    // characters, and at least one character must follow it. This refuses a
    // relative id ('#initialKey'), the bare DID, and a longer DID with the
    // sender DID as its prefix.
    const separator = verificationMethod.charAt(sender.length);
    if(!verificationMethod.startsWith(sender)
      || (separator !== '#' && separator !== '?' && separator !== '/')
      || verificationMethod.length === sender.length + 1) {
      return {
        code   : 'UPDATE_SENDER_MISMATCH',
        reason : 'Update proof verificationMethod is not a DID URL of the sender DID',
      };
    }
    return undefined;
  }


  /**
   * Build the aggregated data structure (CAS Announcement or SMT tree) and
   * return distribute messages to send to all participants for validation.
   */
  buildAndDistribute(cohortId: string): BaseMessage[] {
    const state = this.#cohortStates.get(cohortId);
    if(!state) {
      throw new AggregationServiceError(`Cohort ${cohortId} not found.`, 'COHORT_NOT_FOUND', { cohortId });
    }
    if(state.phase !== ServiceCohortPhase.UpdatesCollected) {
      throw new AggregationServiceError(
        `Cannot build aggregated data for cohort ${cohortId}: phase is ${state.phase}.`,
        'INVALID_PHASE', { cohortId, phase: state.phase }
      );
    }

    const strategy = getBeaconStrategy(state.config.beaconType);
    if(!strategy) {
      throw new AggregationServiceError(
        `Unsupported beacon type: ${state.config.beaconType}`,
        'UNSUPPORTED_BEACON_TYPE', { cohortId, beaconType: state.config.beaconType }
      );
    }
    strategy.buildAggregatedData(state.cohort);

    const signalBytesHex = bytesToHex(state.cohort.signalBytes!);
    state.phase = ServiceCohortPhase.DataDistributed;

    const messages: BaseMessage[] = [];
    for(const participantDid of state.cohort.participants) {
      const payload = strategy.getDistributePayload(state.cohort, participantDid);
      messages.push(createDistributeAggregatedDataMessage({
        from            : this.did,
        to              : participantDid,
        cohortId,
        beaconType      : state.config.beaconType,
        signalBytesHex,
        casAnnouncement : payload.casAnnouncement,
        smtProof        : payload.smtProof,
      }));
    }
    return messages;
  }

  validationProgress(cohortId: string): ValidationProgress {
    const state = this.#cohortStates.get(cohortId);
    if(!state) {
      return { approved: new Set(), rejected: new Set(), pending: new Set(), total: 0 };
    }
    const approved = state.cohort.validationAcks;
    const rejected = state.cohort.validationRejections;
    const allParticipants = new Set(state.cohort.participants);
    const responded = new Set([...approved, ...rejected]);
    const pending = new Set([...allParticipants].filter(p => !responded.has(p)));
    return {
      approved,
      rejected,
      pending,
      total : allParticipants.size,
    };
  }

  #handleValidationAck(message: BaseMessage): void {
    const cohortId = message.body?.cohortId;
    if(!cohortId) return;
    const state = this.#cohortStates.get(cohortId);
    if(!state) return;
    if(state.phase !== ServiceCohortPhase.DataDistributed) return;

    const approved = message.body?.approved;
    if(approved === undefined) return;

    // A non-member ack would throw UNKNOWN_PARTICIPANT out of addValidation and
    // fail the cohort: one message, from anyone who can reach the service.
    if(!state.cohort.participants.includes(message.from)) {
      this.#reject(state, message.from, 'NOT_A_MEMBER', 'Sender is not a member of this cohort');
      return;
    }

    // One vote per member. A repeat (an innocent transport retry, or a member
    // flipping its answer) would be counted twice by hasAllValidationResponses,
    // which can settle the round while another member is still pending.
    if(state.cohort.validationAcks.has(message.from) || state.cohort.validationRejections.has(message.from)) {
      this.#reject(state, message.from, 'DUPLICATE_RESPONSE', 'Participant already validated this round');
      return;
    }

    state.cohort.addValidation(message.from, approved);

    // Transition to Validated only when all participants approved.
    // Transition to Failed when all responses are in but at least one rejected.
    if(state.cohort.isFullyValidated()) {
      state.phase = ServiceCohortPhase.Validated;
    } else if(state.cohort.hasAllValidationResponses()) {
      state.phase = ServiceCohortPhase.Failed;
    }
  }


  /**
   * Start a signing session by creating auth requests for all participants.
   * The caller provides the transaction data. Usually the caller builds it with
   * `buildAggregationBeaconTx({ beaconAddress, internalPubkey, signalBytes, bitcoin, network })`
   * of `@did-btcr2/method` and a Bitcoin connection.
   *
   * Each check runs before the session starts, so a refusal leaves the cohort
   * in the Validated phase.
   *
   * @throws {AggregationServiceError} `COHORT_NOT_FOUND`; `INVALID_PHASE` outside
   *   the Validated phase; `MISSING_PREV_OUT_SCRIPT` if `txData.prevOutScripts[0]`
   *   is missing; `PREVOUT_SCRIPT_MISMATCH` if it is not the
   *   {@link AggregationCohort.beaconScript} of the cohort. Each member refuses
   *   to sign such a transaction, so the round cannot complete.
   */
  startSigning(cohortId: string, txData: SigningTxData): BaseMessage[] {
    const state = this.#cohortStates.get(cohortId);
    if(!state) {
      throw new AggregationServiceError(`Cohort ${cohortId} not found.`, 'COHORT_NOT_FOUND', { cohortId });
    }
    if(state.phase !== ServiceCohortPhase.Validated) {
      throw new AggregationServiceError(
        `Cannot start signing for cohort ${cohortId}: phase is ${state.phase}.`,
        'INVALID_PHASE', { cohortId, phase: state.phase }
      );
    }

    const prevOutScript = txData.prevOutScripts[0];
    if(!prevOutScript) {
      throw new AggregationServiceError(
        `Cannot start signing for cohort ${cohortId}: txData.prevOutScripts[0] is missing.`,
        'MISSING_PREV_OUT_SCRIPT', { cohortId }
      );
    }
    const beaconScript = state.cohort.beaconScript;
    const spendsBeacon = beaconScript.length > 0
      && prevOutScript.length === beaconScript.length
      && prevOutScript.every((b, i) => b === beaconScript[i]);
    if(!spendsBeacon) {
      const beaconAddress = state.cohort.beaconAddress;
      throw new AggregationServiceError(
        `Cannot start signing for cohort ${cohortId}: txData.prevOutScripts[0] is not the output script of the beacon address ${beaconAddress}.`,
        'PREVOUT_SCRIPT_MISMATCH', { cohortId, beaconAddress, prevOutScriptHex: bytesToHex(prevOutScript) }
      );
    }

    const session = new BeaconSigningSession({
      cohort         : state.cohort,
      pendingTx      : txData.tx,
      prevOutScripts : txData.prevOutScripts,
      prevOutValues  : txData.prevOutValues,
    });
    state.signingSession = session;
    state.phase = ServiceCohortPhase.SigningStarted;

    const messages: BaseMessage[] = [];
    for(const participantDid of state.cohort.participants) {
      messages.push(createAuthorizationRequestMessage({
        from             : this.did,
        to               : participantDid,
        cohortId,
        sessionId        : session.id,
        pendingTx        : txData.tx.hex,
        prevOutScriptHex : bytesToHex(prevOutScript),
        prevOutValue     : txData.prevOutValues[0]?.toString() ?? '0',
      }));
    }
    return messages;
  }

  #handleNonceContribution(message: BaseMessage): void {
    const cohortId = message.body?.cohortId;
    if(!cohortId) return;
    const state = this.#cohortStates.get(cohortId);
    if(!state || !state.signingSession) return;
    if(state.phase !== ServiceCohortPhase.SigningStarted) return;

    const sessionId = message.body?.sessionId;
    if(sessionId !== state.signingSession.id) return;

    const nonceContribution = message.body?.nonceContribution;
    if(!nonceContribution) return;

    const session = state.signingSession;
    // The cohort phase gate above tracks the session phase, but the session is
    // the authority on what it will accept: read it rather than let it throw.
    if(session.phase !== SigningSessionPhase.AwaitingNonceContributions) return;
    if(!state.cohort.participants.includes(message.from)) {
      this.#reject(state, message.from, 'NOT_A_MEMBER', 'Sender is not a member of this cohort');
      return;
    }
    // One contribution per member. Dropping the repeat (rather than throwing
    // DUPLICATE_NONCE) keeps an innocent transport retry from failing the round;
    // the first contribution stands, since the members' nonces are what the
    // aggregated nonce they will sign against is built from.
    if(session.nonceContributions.has(message.from)) {
      this.#reject(state, message.from, 'DUPLICATE_RESPONSE', 'Participant already contributed a nonce to this session');
      return;
    }
    // Validate before storing. A malformed contribution is accepted by
    // addNonceContribution (it only checks the length) and detonates later
    // inside sendAggregatedNonce, where the failure is the cohort's, not the
    // sender's. Rejected here, the member can simply resend a valid one.
    if(!BeaconSigningSession.isValidNonceContribution(nonceContribution)) {
      this.#reject(state, message.from, 'INVALID_NONCE', 'Nonce contribution is not a valid MuSig2 public nonce');
      return;
    }

    session.addNonceContribution(message.from, nonceContribution);

    if(session.nonceContributions.size === state.cohort.participants.length) {
      state.phase = ServiceCohortPhase.NoncesCollected;
    }
  }

  /**
   * Generate the aggregated nonce and return messages to send to participants.
   * Call after `validationProgress(cohortId).approved.size === total`.
   */
  sendAggregatedNonce(cohortId: string): BaseMessage[] {
    const state = this.#cohortStates.get(cohortId);
    if(!state) {
      throw new AggregationServiceError(`Cohort ${cohortId} not found.`, 'COHORT_NOT_FOUND', { cohortId });
    }
    if(state.phase !== ServiceCohortPhase.NoncesCollected || !state.signingSession) {
      throw new AggregationServiceError(
        `Cannot send aggregated nonce for cohort ${cohortId}: phase is ${state.phase}.`,
        'INVALID_PHASE', { cohortId, phase: state.phase }
      );
    }

    const aggregatedNonce = state.signingSession.generateAggregatedNonce();
    state.phase = ServiceCohortPhase.AwaitingPartialSigs;

    const messages: BaseMessage[] = [];
    for(const participantDid of state.cohort.participants) {
      messages.push(createAggregatedNonceMessage({
        from      : this.did,
        to        : participantDid,
        cohortId,
        sessionId : state.signingSession.id,
        aggregatedNonce,
      }));
    }
    return messages;
  }

  #handleSignatureAuthorization(message: BaseMessage): void {
    const cohortId = message.body?.cohortId;
    if(!cohortId) return;
    const state = this.#cohortStates.get(cohortId);
    if(!state || !state.signingSession) return;
    if(state.phase !== ServiceCohortPhase.AwaitingPartialSigs) return;

    const sessionId = message.body?.sessionId;
    if(sessionId !== state.signingSession.id) return;

    const partialSignature = message.body?.partialSignature;
    if(!partialSignature) return;

    const session = state.signingSession;
    if(session.phase !== SigningSessionPhase.AwaitingPartialSignatures) return;
    if(!state.cohort.participants.includes(message.from)) {
      this.#reject(state, message.from, 'NOT_A_MEMBER', 'Sender is not a member of this cohort');
      return;
    }
    if(session.partialSignatures.has(message.from)) {
      this.#reject(state, message.from, 'DUPLICATE_RESPONSE', 'Participant already contributed a partial signature to this session');
      return;
    }
    // Verify on arrival, not at aggregation. A stored bad signature surfaces as
    // BAD_PARTIAL_SIG inside generateFinalSignature, where the whole round dies
    // for one member's contribution; rejecting it here blames the sender and
    // leaves the round open for it to send a correct one (BIP-327 §2.3.5).
    if(!session.verifyPartialSignature(message.from, partialSignature)) {
      this.#reject(state, message.from, 'INVALID_PARTIAL_SIG', 'Partial signature failed verification');
      return;
    }

    session.addPartialSignature(message.from, partialSignature);

    if(session.partialSignatures.size === state.cohort.participants.length) {
      // All partial sigs received - generate final signature. Every stored
      // contribution was verified on arrival, so this cannot fail on one
      // member's input; an error here is the service's own state and belongs to
      // the caller.
      const signature = session.generateFinalSignature();

      // Set Taproot key-path witness (finalScriptWitness injects the aggregated MuSig2 sig)
      session.pendingTx.updateInput(0, { finalScriptWitness: [signature] });

      state.result = {
        cohortId,
        signature,
        signedTx : session.pendingTx,
        path     : 'key-path',
      };
      state.phase = ServiceCohortPhase.Complete;
    }
  }


  /**
   * Abandon the optimistic n-of-n key path and ask members to authorize the
   * k-of-n fallback (script-path) spend of the SAME beacon transaction (graceful
   * liveness, ADR 042). Reuses the in-flight signing session's transaction and
   * spent output, so the announcement and its outputs are unchanged: only the
   * witness path differs. Returns one FALLBACK_AUTHORIZATION_REQUEST per
   * participant.
   *
   * Callable once optimistic signing has started (the session and its tx exist)
   * and before it completes. A cohort can take exactly one of the two paths: the
   * caller (runner) must commit to fallback and stop driving the optimistic path.
   */
  startFallbackSigning(cohortId: string): BaseMessage[] {
    const state = this.#cohortStates.get(cohortId);
    if(!state) {
      throw new AggregationServiceError(`Cohort ${cohortId} not found.`, 'COHORT_NOT_FOUND', { cohortId });
    }
    if(!state.signingSession) {
      throw new AggregationServiceError(
        `Cannot start fallback for cohort ${cohortId}: no signing session.`,
        'NO_SIGNING_SESSION', { cohortId }
      );
    }
    const signingPhases: ServiceCohortPhaseType[] = [
      ServiceCohortPhase.SigningStarted,
      ServiceCohortPhase.NoncesCollected,
      ServiceCohortPhase.AwaitingPartialSigs,
    ];
    if(!signingPhases.includes(state.phase)) {
      throw new AggregationServiceError(
        `Cannot start fallback for cohort ${cohortId}: phase is ${state.phase}.`,
        'INVALID_PHASE', { cohortId, phase: state.phase }
      );
    }

    const session = state.signingSession;
    const prevOutScript = session.prevOutScripts[0];
    const prevOutValue = session.prevOutValues[0];
    if(!prevOutScript || prevOutValue === undefined) {
      throw new AggregationServiceError(
        `Cannot start fallback for cohort ${cohortId}: signing session missing prevout data.`,
        'MISSING_PREV_OUT', { cohortId }
      );
    }

    const fallbackLeaf = buildFallbackLeaf({
      cohortKeys        : state.cohort.cohortKeys,
      fallbackThreshold : state.cohort.effectiveFallbackThreshold,
    });

    state.fallbackSignatures = new Map();
    state.phase = ServiceCohortPhase.FallbackRequested;

    const messages: BaseMessage[] = [];
    for(const participantDid of state.cohort.participants) {
      messages.push(createFallbackAuthorizationRequestMessage({
        from                  : this.did,
        to                    : participantDid,
        cohortId,
        sessionId             : session.id,
        pendingTx             : session.pendingTx.hex,
        prevOutScriptHex      : bytesToHex(prevOutScript),
        prevOutValue          : prevOutValue.toString(),
        fallbackLeafScriptHex : bytesToHex(fallbackLeaf),
      }));
    }
    return messages;
  }

  /**
   * Handle an incoming FALLBACK_SIGNATURE: a member's standalone BIP-340
   * signature over the fallback script-path sighash. The signature is
   * authenticated to the sender (its `signerPk` must be the sender's own cohort
   * key and the signature must verify against the sighash) and collected. Once k
   * valid signatures are in, the k-of-n fallback spend is assembled and the
   * cohort completes via the script path.
   */
  #handleFallbackSignature(message: BaseMessage): void {
    const cohortId = message.body?.cohortId;
    if(!cohortId) return;
    const state = this.#cohortStates.get(cohortId);
    if(!state || !state.signingSession || !state.fallbackSignatures) return;
    if(state.phase !== ServiceCohortPhase.FallbackRequested) return;

    const sessionId = message.body?.sessionId;
    if(sessionId !== state.signingSession.id) return;

    const signerPk = message.body?.signerPk as Uint8Array | undefined;
    const fallbackSignature = message.body?.fallbackSignature as Uint8Array | undefined;
    if(!signerPk || !fallbackSignature) return;

    const prevOutScript = state.signingSession.prevOutScripts[0];
    const prevOutValue = state.signingSession.prevOutValues[0];
    if(!prevOutScript || prevOutValue === undefined) return;

    // Authenticate the signature to the sender: signerPk must be the sender's own
    // cohort key (x-only). A non-member or a mismatched key is dropped as a
    // rejection, never thrown, so one bad contribution cannot stall the fallback.
    const memberKey = state.cohort.participantKeys.get(message.from);
    if(!memberKey) {
      this.#reject(state, message.from, 'NOT_A_MEMBER', 'Fallback signature from a non-member');
      return;
    }
    const memberXOnly = memberKey.slice(1);
    if(signerPk.length !== 32 || !memberXOnly.every((b, i) => b === signerPk[i])) {
      this.#reject(state, message.from, 'INVALID_FALLBACK_SIG', 'Fallback signerPk does not match the sender cohort key');
      return;
    }

    const fallbackLeaf = buildFallbackLeaf({
      cohortKeys        : state.cohort.cohortKeys,
      fallbackThreshold : state.cohort.effectiveFallbackThreshold,
    });
    const sighash = fallbackSighash(state.signingSession.pendingTx, 0, prevOutScript, prevOutValue, fallbackLeaf);
    let valid = false;
    try { valid = fallbackSignature.length === 64 && schnorr.verify(fallbackSignature, sighash, signerPk); } catch { valid = false; }
    if(!valid) {
      this.#reject(state, message.from, 'INVALID_FALLBACK_SIG', 'Fallback signature failed verification');
      return;
    }

    state.fallbackSignatures.set(message.from, { pubKey: signerPk, signature: fallbackSignature });

    if(state.fallbackSignatures.size >= state.cohort.effectiveFallbackThreshold) {
      const signedTx = buildFallbackSpend({
        pendingTx         : state.signingSession.pendingTx,
        cohortKeys        : state.cohort.cohortKeys,
        fallbackThreshold : state.cohort.effectiveFallbackThreshold,
        recoveryKey       : state.cohort.recoveryKey!,
        recoverySequence  : state.cohort.recoverySequence!,
        fundingModel      : state.cohort.fundingModel,
        network           : state.cohort.network,
        prevOutScript,
        prevOutValue,
        signatures        : [ ...state.fallbackSignatures.values() ],
      });
      state.result = { cohortId, signature: new Uint8Array(), signedTx, path: 'script-path' };
      state.phase = ServiceCohortPhase.Complete;
    }
  }


  getResult(cohortId: string): AggregationResult | undefined {
    return this.#cohortStates.get(cohortId)?.result;
  }

  getCohortPhase(cohortId: string): ServiceCohortPhaseType | undefined {
    return this.#cohortStates.get(cohortId)?.phase;
  }

  getCohort(cohortId: string): AggregationCohort | undefined {
    return this.#cohortStates.get(cohortId)?.cohort;
  }

  /**
   * Get the signing session ID for a cohort, if a signing session has been started.
   * @param {string} cohortId - The cohort ID.
   * @returns {string | undefined} The session ID, or undefined if no session is active.
   */
  getSigningSessionId(cohortId: string): string | undefined {
    return this.#cohortStates.get(cohortId)?.signingSession?.id;
  }

  get cohorts(): ReadonlyArray<AggregationCohort> {
    return [...this.#cohortStates.values()].map(s => s.cohort);
  }

  /**
   * Remove a cohort from the state map. Used by runners to GC state on cohort
   * completion, failure, or expiry. No-op if the cohort doesn't exist.
   */
  removeCohort(cohortId: string): void {
    this.#cohortStates.delete(cohortId);
  }
}

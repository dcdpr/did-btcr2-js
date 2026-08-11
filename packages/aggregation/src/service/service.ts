import { canonicalize } from '@did-btcr2/common';
import type { SecuredDocument } from '@did-btcr2/cryptosuite';
import { BIP340Cryptosuite, SchnorrMultikey } from '@did-btcr2/cryptosuite';
import { CompressedSecp256k1PublicKey } from '@did-btcr2/keypair';
import { schnorr } from '@noble/curves/secp256k1.js';
import { bytesToHex, hexToBytes } from '@noble/hashes/utils';
import type { Transaction } from '@scure/btc-signer';
import { getBeaconStrategy } from '../core/beacon-strategy.js';
import { AggregationCohort } from '../core/cohort.js';
import type { CohortConditions } from '../core/conditions.js';
import { DEFAULT_MAX_PARTICIPANTS, validateCohortConditions } from '../core/conditions.js';
import { AggregationCohortError, AggregationServiceError, SigningSessionError } from '../core/errors.js';
import { buildFallbackSpend, fallbackSighash } from '../core/fallback-spend.js';
import type { FallbackSignature } from '../core/fallback-spend.js';
import { buildFallbackLeaf } from '../core/recovery-policy.js';
import type { BaseMessage } from '../core/messages/base.js';
import { AGGREGATION_WIRE_VERSION } from '../core/messages/base.js';
import { isCohortOptInMessage, isSubmitUpdateMessage } from '../core/messages/bodies.js';
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
import { ServiceCohortPhase } from '../core/phases.js';
import { BeaconSigningSession } from '../core/signing-session.js';

/**
 * Extract the funded outpoint (display-order txid + vout) a signing tx spends
 * at input 0. Carried on the (fallback) authorization request so participants
 * can verify the tx they sign spends exactly this beacon UTXO.
 */
function fundingOutpointOf(tx: Transaction, cohortId: string): { fundingTxid: string; fundingVout: number } {
  const input = tx.getInput(0);
  if(!input?.txid || input.index === undefined) {
    throw new AggregationServiceError(
      `Cannot start signing for cohort ${cohortId}: the pending tx has no outpoint at input 0.`,
      'MISSING_FUNDING_OUTPOINT', { cohortId }
    );
  }
  const txid = typeof input.txid === 'string' ? input.txid : bytesToHex(input.txid);
  return { fundingTxid: txid.toLowerCase(), fundingVout: input.index };
}

/**
 * Cohort configuration set by the service operator: the advertised cohort
 * {@link CohortConditions} plus the Bitcoin network. `beaconType` and
 * `minParticipants` are required; the other conditions are optional (absent =
 * unconstrained). See ADR 039.
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

/** Reason an incoming message was silently dropped by the state machine. */
export type RejectionReason =
  | 'WRONG_VERSION'
  | 'UPDATE_TOO_LARGE'
  | 'UPDATE_VERIFICATION_FAILED'
  | 'UPDATE_MALFORMED'
  | 'UNKNOWN_PARTICIPANT'
  | 'OPT_IN_MALFORMED'
  | 'OPT_IN_OVERFLOW'
  | 'INVALID_NONCE'
  | 'DUPLICATE_NONCE'
  | 'INVALID_PARTIAL_SIG'
  | 'DUPLICATE_PARTIAL_SIG'
  | 'BAD_PARTIAL_SIG'
  | 'SIGNAL_MISMATCH'
  | 'SESSION_ERROR';

/** Record of a silently-dropped inbound message. Drained by the runner to emit events. */
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
  /**
   * Genuinely-pending opt-ins awaiting an operator decision. Entries are
   * removed on accept ({@link AggregationService.acceptParticipant}) and on
   * operator reject ({@link AggregationService.rejectParticipant}), so the
   * `maxPendingOptIns` cap counts only undecided opt-ins; accepted members'
   * keys live in `cohort.participantKeys`.
   */
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
  /**
    * Per-participant count of blamed signing contributions this round: past
    * {@link PARTIAL_SIG_BLAME_BUDGET} the participant is treated as
   * a defector and the cohort is flagged for the k-of-n fallback. Reset when a
   * new signing session starts.
   */
  partialSigBlame: Map<string, number>;
  /**
   * Set when the signing round can no longer complete optimistically (a
   * defector exhausted the blame budget, or an unattributable session error
   * occurred). Read by the runner via {@link AggregationService.isFallbackRequired}
   * to drive the k-of-n fallback deliberately instead of wedging the cohort.
   */
  fallbackRequired: boolean;
  /** Rejections accumulated since last drain. Runner polls via drainRejections(). */
  rejections: Array<Rejection>;
}

/** Default maximum canonicalized byte-length of a submitted BTCR2 update. */
export const DEFAULT_MAX_UPDATE_SIZE_BYTES = 256 * 1024;

/** Prefix of the ZCAP root capability a did:btcr2 update proof invokes (`urn:zcap:root:<url-encoded did>`). */
const ROOT_CAPABILITY_PREFIX = 'urn:zcap:root:';

/**
 * Default cap on pending (not-yet-accepted) opt-ins retained per cohort. Opt-ins
 * arrive over the transport from unauthenticated-then-authenticated senders and
 * sit in memory until the operator accepts them, so without a bound a flood of
 * opt-ins from distinct DIDs grows the map indefinitely. Opt-ins past
 * the cap are dropped with an OPT_IN_OVERFLOW rejection.
 */
export const DEFAULT_MAX_PENDING_OPT_INS = 1024;

/**
 * Per-participant budget of blamed signing contributions before the service
 * stops rewinding the round for that member and flags the cohort for the
 * k-of-n fallback: without a budget a persistent defector
 * resubmits bad partial signatures forever and the blame-and-retry loop never
 * terminates. The default n-1 fallback threshold tolerates exactly one
 * defector.
 */
export const PARTIAL_SIG_BLAME_BUDGET = 2;

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
  /**
   * Maximum pending opt-ins retained per cohort awaiting operator approval.
   * Defaults to {@link DEFAULT_MAX_PENDING_OPT_INS}.
   */
  maxPendingOptIns?: number;
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
  readonly maxPendingOptIns: number;

  /** Per-cohort state, keyed by cohortId. */
  #cohortStates: Map<string, ServiceCohortState> = new Map();

  constructor({ did, publicKey, maxUpdateSizeBytes, maxPendingOptIns }: AggregationServiceParams) {
    this.did = did;
    this.publicKey = publicKey;
    this.maxUpdateSizeBytes = maxUpdateSizeBytes ?? DEFAULT_MAX_UPDATE_SIZE_BYTES;
    this.maxPendingOptIns = maxPendingOptIns ?? DEFAULT_MAX_PENDING_OPT_INS;
  }

  /**
   * Record a silently-dropped inbound message. The runner drains these via
   * {@link drainRejections} and emits them as `message-rejected` events, so a
   * malformed or malicious contribution is observable without ever throwing out
   * of {@link receive} (an untrusted-input throw would let any sender fail the
    * whole cohort).
   */
  #reject(state: ServiceCohortState, from: string, code: RejectionReason, reason: string): void {
    state.rejections.push({ from, code, reason });
  }

  /**
   * Boundary shape validation for inbound messages whose handlers would
   * otherwise trust attacker-controlled field types. On failure
   * the message is dropped with a recorded rejection (when its cohortId
   * resolves) and the cohort is never touched.
   */
  #guardShape(
    message: BaseMessage,
    guard: (m: BaseMessage) => boolean,
    code: RejectionReason,
    reason: string
  ): boolean {
    if(guard(message)) return true;
    const cohortId = message.body?.cohortId;
    const state = cohortId ? this.#cohortStates.get(cohortId) : undefined;
    if(state) this.#reject(state, message.from, code, reason);
    return false;
  }

  /** True if `key` is a valid 33-byte compressed secp256k1 point. */
  #isValidCohortKey(key: Uint8Array): boolean {
    try {
      new CompressedSecp256k1PublicKey(key);
      return true;
    } catch {
      return false;
    }
  }


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
        // Shape-validate at the boundary: a malformed body must degrade to a
        // recorded rejection, never a throw out of receive().
        if(!this.#guardShape(message, isCohortOptInMessage, 'OPT_IN_MALFORMED', 'Malformed COHORT_OPT_IN body')) return;
        this.#handleOptIn(message);
        break;
      case SUBMIT_UPDATE:
        if(!this.#guardShape(message, isSubmitUpdateMessage, 'UPDATE_MALFORMED', 'Malformed SUBMIT_UPDATE body')) return;
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
   * Drain the rejection log for a cohort. Used by runners to surface silent
   * drops (bad proof, oversized update, wrong version, etc.) as structured
   * events without breaking the sans-I/O state machine contract.
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
      partialSigBlame      : new Map(),
      fallbackRequired     : false,
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

  /** Pending opt-ins awaiting operator approval. */
  pendingOptIns(cohortId: string): ReadonlyMap<string, PendingOptIn> {
    const state = this.#cohortStates.get(cohortId);
    if(!state) return new Map();
    return new Map(state.pendingOptIns);
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

    // Cryptographically validate both keys BEFORE the opt-in is stored: the
    // runner auto-accepts opt-ins by default, and acceptParticipant feeds
    // participantPk into cohortKeys, whose setter throws on non-33-byte /
    // off-curve values - a single malformed opt-in would otherwise kill the
    // cohort via the runner's catch-all.
    if(!this.#isValidCohortKey(participantPk) || !this.#isValidCohortKey(communicationPk)) {
      this.#reject(state, participantDid, 'OPT_IN_MALFORMED',
        'Opt-in keys must be valid 33-byte compressed secp256k1 points');
      return;
    }

    // Reject re-opt-in from already-accepted participants. Without this guard a
    // participant could send a second opt-in with a different key, overwriting
    // pendingOptIns[did] while cohortKeys still holds the original key - opening
    // a desync window where #verifySubmittedUpdate accepts updates signed with
    // a key that is NOT in the MuSig2 cohort.
    if(state.acceptedParticipants.has(participantDid)) return;

    // Bound pending opt-ins: each entry sits in memory until the operator
    // accepts it, and opt-ins arrive from the open network while the cohort is
    // advertised. Past the cap, drop and surface an OPT_IN_OVERFLOW rejection
    if(state.pendingOptIns.size >= this.maxPendingOptIns) {
      this.#reject(state, participantDid, 'OPT_IN_OVERFLOW',
        `Cohort ${cohortId} already holds ${this.maxPendingOptIns} pending opt-ins`);
      return;
    }

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
   */
  acceptParticipant(cohortId: string, participantDid: string): BaseMessage[] {
    const state = this.#cohortStates.get(cohortId);
    if(!state) {
      throw new AggregationServiceError(`Cohort ${cohortId} not found.`, 'COHORT_NOT_FOUND', { cohortId });
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
    // advertised ceiling (closes the unbounded-growth path; see ADR 039). An
    // unadvertised ceiling defaults to DEFAULT_MAX_PARTICIPANTS.
    const maxParticipants = state.config.maxParticipants ?? DEFAULT_MAX_PARTICIPANTS;
    if(state.acceptedParticipants.size >= maxParticipants) {
      throw new AggregationServiceError(
        `Cohort ${cohortId} is full: ${maxParticipants} participants already accepted.`,
        'COHORT_FULL', { cohortId, maxParticipants }
      );
    }

    state.acceptedParticipants.add(participantDid);
    state.cohort.participants.push(participantDid);
    state.cohort.participantKeys.set(participantDid, optIn.participantPk);
    state.cohort.cohortKeys = [...state.cohort.cohortKeys, optIn.participantPk];
    // Accepted members' keys live on cohort.participantKeys; drop the pending
    // entry so the pending cap counts only genuinely-undecided opt-ins.
    state.pendingOptIns.delete(participantDid);

    return [createCohortOptInAcceptMessage({
      from : this.did,
      to   : participantDid,
      cohortId,
    })];
  }

  /**
   * Service operator rejects a pending opt-in. Drops the entry so the
   * pending-opt-in cap counts only genuinely-pending opt-ins;
   * the sender may opt in again later. No-op when nothing is pending.
   */
  rejectParticipant(cohortId: string, participantDid: string): void {
    this.#cohortStates.get(cohortId)?.pendingOptIns.delete(participantDid);
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
    const maxParticipants = state.config.maxParticipants ?? DEFAULT_MAX_PARTICIPANTS;
    if(state.acceptedParticipants.size > maxParticipants) {
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

    // Cap the canonicalized update size before doing any heavier verification
    // work. Without this guard, a participant could submit multi-MB payloads
    // that the service would canonicalize, hash, and aggregate - cheap DoS.
    const canonicalSize = canonicalize(signedUpdate as unknown as Record<string, unknown>).length;
    if(canonicalSize > this.maxUpdateSizeBytes) {
      this.#reject(state, message.from, 'UPDATE_TOO_LARGE',
        `Canonicalized update is ${canonicalSize} bytes; max allowed is ${this.maxUpdateSizeBytes}`);
      return;
    }

    // Membership gate before any verification work: only accepted members may
    // submit. A non-member's update is dropped as a rejection, never thrown:
    // addUpdate would otherwise throw UNKNOWN_PARTICIPANT out of receive() and
    // fail the whole cohort, a DoS any non-member could trigger.
    // Mirrors #handleSubmitNonInclusion.
    if(!state.cohort.participants.includes(message.from)) {
      this.#reject(state, message.from, 'UNKNOWN_PARTICIPANT', 'Sender is not a member of this cohort');
      return;
    }

    // Verify the BIP-340 Data Integrity proof before aggregating. Without this check,
    // a malicious cohort member could submit updates with garbage proofs, which the
    // service would aggregate into the CAS announcement / SMT root and ultimately
    // anchor on-chain with the cohort's MuSig2 signature.
    if(!this.#verifySubmittedUpdate(state, message.from, signedUpdate)) {
      this.#reject(state, message.from, 'UPDATE_VERIFICATION_FAILED',
        'BIP-340 Data Integrity proof verification failed');
      return;
    }

    // One response per round. A member that already declined cannot also submit,
    // and a member that already submitted cannot resubmit (a silent overwrite
    // would corrupt the aggregated data the member already validated against).
    // Both are dropped as rejections, symmetric with #handleSubmitNonInclusion.
    if(state.cohort.nonIncluded.has(message.from)) {
      this.#reject(state, message.from, 'UPDATE_MALFORMED',
        'Participant already declined this round; cannot also submit an update');
      return;
    }
    if(state.cohort.pendingUpdates.has(message.from)) {
      this.#reject(state, message.from, 'UPDATE_MALFORMED',
        'Participant already submitted an update this round; cannot resubmit');
      return;
    }

    // addUpdate throws UNKNOWN_PARTICIPANT for a non-member. That must never
    // escape receive(): an opted-in-but-not-accepted sender's update passes the
    // proof check above (their opt-in key verifies), so without this guard any
    // rejected joiner could throw the cohort into failure via the runner's
    // catch-all.
    try {
      state.cohort.addUpdate(message.from, signedUpdate);
    } catch(err) {
      if(err instanceof AggregationCohortError && err.type === 'UNKNOWN_PARTICIPANT') {
        this.#reject(state, message.from, 'UNKNOWN_PARTICIPANT', 'Sender is not a member of this cohort');
        return;
      }
      throw err;
    }

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
    // non-member could trigger. Mirrors the SUBMIT_UPDATE verification path.
    if(!state.cohort.participants.includes(message.from)) {
      this.#reject(state, message.from, 'UNKNOWN_PARTICIPANT', 'Sender is not a member of this cohort');
      return;
    }

    // One response per round: already submitted or already declined. Surface the
    // conflict as a rejection, symmetric with the double-submit guard above.
    if(state.cohort.pendingUpdates.has(message.from) || state.cohort.nonIncluded.has(message.from)) {
      this.#reject(state, message.from, 'UPDATE_MALFORMED', 'Participant already responded this round');
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
   * Verify the BIP-340 Schnorr Data Integrity proof on a submitted update using the
   * participant's accepted cohort key. Returns `false` (and the update is silently
   * dropped) if the proof is missing or malformed, the verificationMethod does
   * not name the sender's DID, the proof's root capability names a DID other
   * than the sender's, the sender has no accepted key on record,
   * or the signature fails verification.
   * @param {ServiceCohortState} state - the current state of the cohort to which the update was submitted
   * @param {string} sender - the DID of the participant who submitted the update
   * @param {SecuredDocument} signedUpdate - the signed update containing the proof to verify
   * @returns {boolean} - `true` if the proof is valid and the update can be accepted; `false` otherwise
   */
  #verifySubmittedUpdate(
    state: ServiceCohortState,
    sender: string,
    signedUpdate: SecuredDocument,
  ): boolean {
    const proof = signedUpdate.proof;
    if(!proof?.verificationMethod || !proof.proofValue) return false;
    // Defense in depth: the receive()-boundary guard already
    // rejects non-string proof fields, but this method must never throw on
    // attacker-controlled JSON regardless of how it is reached.
    if(typeof proof.verificationMethod !== 'string' || typeof proof.proofValue !== 'string') return false;

    // The proof must be signed by the sender's own key. Reject if the
    // verificationMethod references a different DID.
    const vmDid = proof.verificationMethod.split('#')[0];
    if(vmDid !== sender) return false;

    // The proof's root capability names the DID being updated
    // (`urn:zcap:root:<url-encoded did>`); it must be the sender's own DID.
    // Without this check a member could submit a validly-proved update naming
    // a DIFFERENT DID and have it aggregated under its own slot.
    const capability = proof.capability;
    if(typeof capability !== 'string' || !capability.startsWith(ROOT_CAPABILITY_PREFIX)) return false;
    let capabilityDid: string;
    try {
      capabilityDid = decodeURIComponent(capability.slice(ROOT_CAPABILITY_PREFIX.length));
    } catch {
      return false;
    }
    if(capabilityDid !== sender) return false;

    // The sender's key is the one accepted into the cohort:
    // pending-but-unaccepted opt-ins no longer authenticate submissions.
    const participantPk = state.cohort.participantKeys.get(sender);
    if(!participantPk) return false;

    try {
      const multikey = SchnorrMultikey.fromPublicKey({
        id             : proof.verificationMethod,
        controller     : sender,
        publicKeyBytes : participantPk,
      }) as SchnorrMultikey;
      const suite = new BIP340Cryptosuite(multikey);
      return suite.verifyProof(signedUpdate).verified === true;
    } catch {
      return false;
    }
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

    // The ack must commit to the exact signal this service distributed: an ack
    // naming a different (or no) signal hash is not consent to the current
    // distribution and is dropped, so a forged or replayed ack cannot drive the
    // cohort into signing.
    const signalBytesHex = message.body?.signalBytesHex;
    const expectedHex = state.cohort.signalBytes ? bytesToHex(state.cohort.signalBytes) : undefined;
    if(!signalBytesHex || signalBytesHex !== expectedHex) {
      this.#reject(state, message.from, 'SIGNAL_MISMATCH',
        'Validation ack does not commit to the distributed signal');
      return;
    }

    // addValidation throws UNKNOWN_PARTICIPANT for a non-member ack. Convert to a
    // recorded rejection: an opted-in-but-not-accepted (or former) sender who
    // learned the signal must not be able to throw the cohort into failure
    // through the runner's catch-all.
    try {
      state.cohort.addValidation(message.from, approved);
    } catch(err) {
      if(err instanceof AggregationCohortError && err.type === 'UNKNOWN_PARTICIPANT') {
        this.#reject(state, message.from, 'UNKNOWN_PARTICIPANT', 'Validation ack from a non-member');
        return;
      }
      throw err;
    }

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
   * The caller provides the transaction data - typically built via
   * `buildBeaconTransaction()` against a Bitcoin connection.
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

    const session = new BeaconSigningSession({
      cohort         : state.cohort,
      pendingTx      : txData.tx,
      prevOutScripts : txData.prevOutScripts,
      prevOutValues  : txData.prevOutValues,
    });
    state.signingSession = session;
    // A new signing round resets the defector bookkeeping.
    state.partialSigBlame.clear();
    state.fallbackRequired = false;
    state.phase = ServiceCohortPhase.SigningStarted;

    const prevOutScript = txData.prevOutScripts[0];
    if(!prevOutScript) {
      throw new AggregationServiceError(
        `Cannot start signing for cohort ${cohortId}: txData.prevOutScripts[0] is missing.`,
        'MISSING_PREV_OUT_SCRIPT', { cohortId }
      );
    }

    // Declare the funded outpoint the tx spends so each participant can bind
    // its signature to the exact beacon UTXO, not just the beacon script and
    // amount committed by the sighash.
    const { fundingTxid, fundingVout } = fundingOutpointOf(txData.tx, cohortId);

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
        fundingTxid,
        fundingVout,
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
    if(nonceContribution === undefined || nonceContribution === null) return;
    if(!(nonceContribution instanceof Uint8Array)) {
      this.#reject(state, message.from, 'INVALID_NONCE', 'nonceContribution must be a Uint8Array');
      return;
    }

    // addNonceContribution throws on an unknown signer, a malformed nonce, or a
    // duplicate. All are reachable from a single (possibly buggy or malicious)
    // member and must degrade to a recorded rejection, never an exception out of
    // receive() that the runner would turn into a cohort failure.
    try {
      state.signingSession.addNonceContribution(message.from, nonceContribution);
    } catch(err) {
      if(err instanceof SigningSessionError) {
        const code: RejectionReason =
          err.type === 'UNKNOWN_PARTICIPANT' ? 'UNKNOWN_PARTICIPANT'
            : err.type === 'DUPLICATE_NONCE' ? 'DUPLICATE_NONCE'
              : 'INVALID_NONCE';
        this.#reject(state, message.from, code, err.message);
        return;
      }
      throw err;
    }

    if(state.signingSession.nonceContributions.size === state.cohort.participants.length) {
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
    if(partialSignature === undefined || partialSignature === null) return;
    if(!(partialSignature instanceof Uint8Array)) {
      this.#reject(state, message.from, 'INVALID_PARTIAL_SIG', 'partialSignature must be a Uint8Array');
      return;
    }

    // As with nonce contributions, a malformed/duplicate/unknown-signer partial
    // must degrade to a rejection, not a thrown cohort kill.
    try {
      state.signingSession.addPartialSignature(message.from, partialSignature);
    } catch(err) {
      if(err instanceof SigningSessionError) {
        const code: RejectionReason =
          err.type === 'UNKNOWN_PARTICIPANT' ? 'UNKNOWN_PARTICIPANT'
            : err.type === 'DUPLICATE_PARTIAL_SIG' ? 'DUPLICATE_PARTIAL_SIG'
              : 'INVALID_PARTIAL_SIG';
        this.#reject(state, message.from, code, err.message);
        return;
      }
      throw err;
    }

    if(state.signingSession.partialSignatures.size === state.cohort.participants.length) {
      // All partial sigs received - generate final signature. A contribution that
      // fails BIP-327 partialSigVerify names its signer (BAD_PARTIAL_SIG carries
      // participantDid): blame-and-exclude instead of failing the cohort. The
      // bad signature is discarded and the session returns to
      // AwaitingPartialSignatures so the blamed member can resubmit a corrected
      // signature - but only up to PARTIAL_SIG_BLAME_BUDGET times per member per
      // round, after which the member is treated as a defector and the cohort is
      // flagged for the k-of-n fallback (whose default n-1 threshold tolerates
      // exactly one defector) so a persistent defector cannot hold the round
      // open indefinitely.
      let signature: Uint8Array;
      try {
        signature = state.signingSession.generateFinalSignature();
      } catch(err) {
        if(err instanceof SigningSessionError && err.type === 'BAD_PARTIAL_SIG') {
          const blamed = (err.data?.participantDid as string | undefined) ?? 'unknown';
          this.#blameSigningContribution(state, blamed, 'BAD_PARTIAL_SIG',
            `Partial signature from ${blamed} failed BIP-327 verification`);
          return;
        }
        if(err instanceof SigningSessionError) {
          // A session error that is not a blamed partial signature must not
          // wedge the round in PartialSignaturesReceived: when a
          // culprit is identifiable, discard their contribution and count it
          // against the same budget so the round can complete on resubmission;
          // otherwise flag the cohort for the fallback path deliberately.
          const culprit = err.data?.participantDid as string | undefined;
          if(culprit && state.signingSession.partialSignatures.has(culprit)) {
            this.#blameSigningContribution(state, culprit, 'SESSION_ERROR', err.message);
          } else {
            this.#reject(state, message.from, 'SESSION_ERROR', err.message);
            state.fallbackRequired = true;
          }
          return;
        }
        throw err;
      }

      // Set Taproot key-path witness (finalScriptWitness injects the aggregated MuSig2 sig)
      state.signingSession.pendingTx.updateInput(0, { finalScriptWitness: [signature] });

      state.result = {
        cohortId,
        signature,
        signedTx : state.signingSession.pendingTx,
        path     : 'key-path',
      };
      state.phase = ServiceCohortPhase.Complete;
    }
  }


  /**
    * Blame a named participant for a failed signing-round contribution:
    * discard their partial signature and rewind the session to
   * AwaitingPartialSignatures so they can resubmit, up to
   * {@link PARTIAL_SIG_BLAME_BUDGET} blamed contributions per member per round.
   * Past the budget no further rewinds are granted: the member is treated as a
   * defector and the cohort is flagged for the k-of-n fallback.
   */
  #blameSigningContribution(
    state: ServiceCohortState,
    blamed: string,
    code: 'BAD_PARTIAL_SIG' | 'SESSION_ERROR',
    detail: string
  ): void {
    state.signingSession?.discardPartialSignature(blamed);
    const count = (state.partialSigBlame.get(blamed) ?? 0) + 1;
    state.partialSigBlame.set(blamed, count);
    if(count > PARTIAL_SIG_BLAME_BUDGET) {
      this.#reject(state, blamed, code,
        `${detail}; retry budget of ${PARTIAL_SIG_BLAME_BUDGET} exhausted - treating ${blamed} as a defector; the k-of-n fallback is required`);
      state.fallbackRequired = true;
      return;
    }
    this.#reject(state, blamed, code,
      `${detail}; contribution discarded, awaiting a corrected resubmission (${count}/${PARTIAL_SIG_BLAME_BUDGET})`);
  }

  /**
   * True when the signing round for a cohort can no longer complete
   * optimistically and the runner should drive the k-of-n fallback (via
   * `triggerFallback`) instead of letting the cohort stall.
   * Polled by runners after `receive()`, mirroring {@link drainRejections}.
   */
  isFallbackRequired(cohortId: string): boolean {
    return this.#cohortStates.get(cohortId)?.fallbackRequired === true;
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
    state.fallbackRequired = false;
    state.phase = ServiceCohortPhase.FallbackRequested;

    const { fundingTxid, fundingVout } = fundingOutpointOf(session.pendingTx, cohortId);

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
        fundingTxid,
        fundingVout,
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
      state.rejections.push({ from: message.from, code: 'UPDATE_MALFORMED', reason: 'Fallback signature from a non-member' });
      return;
    }
    const memberXOnly = memberKey.slice(1);
    if(signerPk.length !== 32 || !memberXOnly.every((b, i) => b === signerPk[i])) {
      state.rejections.push({ from: message.from, code: 'UPDATE_MALFORMED', reason: 'Fallback signerPk does not match the sender cohort key' });
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
      state.rejections.push({ from: message.from, code: 'UPDATE_VERIFICATION_FAILED', reason: 'Fallback signature failed verification' });
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

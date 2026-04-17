import { canonicalize } from '@did-btcr2/common';
import type { SignedBTCR2Update } from '@did-btcr2/cryptosuite';
import { BIP340Cryptosuite, SchnorrMultikey } from '@did-btcr2/cryptosuite';
import type { SchnorrKeyPair } from '@did-btcr2/keypair';
import { bytesToHex } from '@noble/hashes/utils';
import type { Transaction } from '@scure/btc-signer';
import { getBeaconStrategy } from './beacon-strategy.js';
import { AggregationCohort } from './cohort.js';
import { AggregationServiceError } from './errors.js';
import type { BaseMessage } from './messages/base.js';
import { AGGREGATION_WIRE_VERSION } from './messages/base.js';
import {
  COHORT_OPT_IN,
  NONCE_CONTRIBUTION,
  SIGNATURE_AUTHORIZATION,
  SUBMIT_UPDATE,
  VALIDATION_ACK,
} from './messages/constants.js';
import {
  createAggregatedNonceMessage,
  createAuthorizationRequestMessage,
  createCohortAdvertMessage,
  createCohortOptInAcceptMessage,
  createCohortReadyMessage,
  createDistributeAggregatedDataMessage,
} from './messages/factories.js';
import type { ServiceCohortPhaseType } from './phases.js';
import { ServiceCohortPhase } from './phases.js';
import { BeaconSigningSession } from './signing-session.js';

/** Cohort configuration set by the service operator. */
export interface CohortConfig {
  minParticipants: number;
  network: string;
  beaconType: string;
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
  signature: Uint8Array;
  signedTx: Transaction;
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
  | 'UPDATE_MALFORMED';

/** Record of a silently-dropped inbound message. Drained by the runner to emit events. */
export interface Rejection {
  /** DID of the sender whose message was rejected. */
  from: string;
  /** Machine-readable code. */
  code: RejectionReason;
  /** Human-readable reason. */
  reason: string;
}

/** Per-cohort service state — internal. */
interface ServiceCohortState {
  phase: ServiceCohortPhaseType;
  cohort: AggregationCohort;
  config: CohortConfig;
  pendingOptIns: Map<string, PendingOptIn>;
  acceptedParticipants: Set<string>;
  signingSession?: BeaconSigningSession;
  result?: AggregationResult;
  /** Rejections accumulated since last drain. Runner polls via drainRejections(). */
  rejections: Array<Rejection>;
}

/** Default maximum canonicalized byte-length of a submitted BTCR2 update. */
export const DEFAULT_MAX_UPDATE_SIZE_BYTES = 256 * 1024;

export interface AggregationServiceParams {
  did: string;
  keys: SchnorrKeyPair;
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
  readonly keys: SchnorrKeyPair;
  readonly maxUpdateSizeBytes: number;

  /** Per-cohort state, keyed by cohortId. */
  #cohortStates: Map<string, ServiceCohortState> = new Map();

  constructor({ did, keys, maxUpdateSizeBytes }: AggregationServiceParams) {
    this.did = did;
    this.keys = keys;
    this.maxUpdateSizeBytes = maxUpdateSizeBytes ?? DEFAULT_MAX_UPDATE_SIZE_BYTES;
  }


  receive(message: BaseMessage): void {
    // Reject messages whose wire version doesn't match what this build speaks.
    // Missing version → treat as legacy and drop: bumping the protocol must be
    // coordinated across all participants.
    const version = message.version;
    if(version === undefined || version !== AGGREGATION_WIRE_VERSION) {
      const cohortId = message.body?.cohortId;
      const state = cohortId ? this.#cohortStates.get(cohortId) : undefined;
      if(state) {
        state.rejections.push({
          from   : message.from,
          code   : 'WRONG_VERSION',
          reason : `Expected wire version ${AGGREGATION_WIRE_VERSION}, got ${String(version)}`,
        });
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
      case VALIDATION_ACK:
        this.#handleValidationAck(message);
        break;
      case NONCE_CONTRIBUTION:
        this.#handleNonceContribution(message);
        break;
      case SIGNATURE_AUTHORIZATION:
        this.#handleSignatureAuthorization(message);
        break;
      default:
        // Unknown message type — silently ignore
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
   * Cohort starts in `Created` phase — call `advertise()` to broadcast.
   */
  createCohort(config: CohortConfig): string {
    const cohort = new AggregationCohort({
      serviceDid      : this.did,
      minParticipants : config.minParticipants,
      network         : config.network,
      beaconType      : config.beaconType,
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

    const message = createCohortAdvertMessage({
      from            : this.did,
      cohortId,
      cohortSize      : state.config.minParticipants,
      beaconType      : state.config.beaconType,
      network         : state.config.network,
      communicationPk : this.keys.publicKey.compressed,
    });

    state.phase = ServiceCohortPhase.Advertised;
    return [message];
  }

  /** Pending opt-ins awaiting operator approval. */
  pendingOptIns(cohortId: string): ReadonlyMap<string, PendingOptIn> {
    const state = this.#cohortStates.get(cohortId);
    if(!state) return new Map();
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

    // Reject re-opt-in from already-accepted participants. Without this guard a
    // participant could send a second opt-in with a different key, overwriting
    // pendingOptIns[did] while cohortKeys still holds the original key — opening
    // a desync window where #verifySubmittedUpdate accepts updates signed with
    // a key that is NOT in the MuSig2 cohort.
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

    state.acceptedParticipants.add(participantDid);
    state.cohort.participants.push(participantDid);
    state.cohort.participantKeys.set(participantDid, optIn.participantPk);
    state.cohort.cohortKeys = [...state.cohort.cohortKeys, optIn.participantPk];

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
  collectedUpdates(cohortId: string): ReadonlyMap<string, SignedBTCR2Update> {
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

    const signedUpdate = message.body?.signedUpdate as SignedBTCR2Update | undefined;
    if(!signedUpdate) {
      state.rejections.push({
        from   : message.from,
        code   : 'UPDATE_MALFORMED',
        reason : 'SUBMIT_UPDATE missing signedUpdate body',
      });
      return;
    }

    // Cap the canonicalized update size before doing any heavier verification
    // work. Without this guard, a participant could submit multi-MB payloads
    // that the service would canonicalize, hash, and aggregate — cheap DoS.
    const canonicalSize = canonicalize(signedUpdate as unknown as Record<string, unknown>).length;
    if(canonicalSize > this.maxUpdateSizeBytes) {
      state.rejections.push({
        from   : message.from,
        code   : 'UPDATE_TOO_LARGE',
        reason : `Canonicalized update is ${canonicalSize} bytes; max allowed is ${this.maxUpdateSizeBytes}`,
      });
      return;
    }

    // Verify the BIP-340 Data Integrity proof before aggregating. Without this check,
    // a malicious cohort member could submit updates with garbage proofs, which the
    // service would aggregate into the CAS announcement / SMT root and ultimately
    // anchor on-chain with the cohort's MuSig2 signature.
    if(!this.#verifySubmittedUpdate(state, message.from, signedUpdate)) {
      state.rejections.push({
        from   : message.from,
        code   : 'UPDATE_VERIFICATION_FAILED',
        reason : 'BIP-340 Data Integrity proof verification failed',
      });
      return;
    }

    state.cohort.addUpdate(message.from, signedUpdate);

    if(state.phase === ServiceCohortPhase.CohortSet) {
      state.phase = ServiceCohortPhase.CollectingUpdates;
    }
    if(state.cohort.hasAllUpdates()) {
      state.phase = ServiceCohortPhase.UpdatesCollected;
    }
  }

  /**
   * Verify the BIP-340 Schnorr Data Integrity proof on a submitted update using the
   * participant's public key from their cohort opt-in. Returns `false` (and the
   * update is silently dropped) if the proof is missing, the verificationMethod does
   * not name the sender's DID, the participant has no opt-in on record, or the
   * signature fails verification.
   * @param {ServiceCohortState} state - the current state of the cohort to which the update was submitted
   * @param {string} sender - the DID of the participant who submitted the update
   * @param {SignedBTCR2Update} signedUpdate - the signed update containing the proof to verify
   * @returns {boolean} - `true` if the proof is valid and the update can be accepted; `false` otherwise
   */
  #verifySubmittedUpdate(
    state: ServiceCohortState,
    sender: string,
    signedUpdate: SignedBTCR2Update,
  ): boolean {
    const proof = signedUpdate.proof;
    if(!proof?.verificationMethod || !proof.proofValue) return false;

    // The proof must be signed by the sender's own key. Reject if the
    // verificationMethod references a different DID.
    const vmDid = proof.verificationMethod.split('#')[0];
    if(vmDid !== sender) return false;

    const optIn = state.pendingOptIns.get(sender);
    if(!optIn) return false;

    try {
      const multikey = SchnorrMultikey.fromPublicKey({
        id             : proof.verificationMethod,
        controller     : sender,
        publicKeyBytes : optIn.participantPk,
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
   * The caller provides the transaction data — typically built via
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
    state.phase = ServiceCohortPhase.SigningStarted;

    const prevOutScript = txData.prevOutScripts[0];
    if(!prevOutScript) {
      throw new AggregationServiceError(
        `Cannot start signing for cohort ${cohortId}: txData.prevOutScripts[0] is missing.`,
        'MISSING_PREV_OUT_SCRIPT', { cohortId }
      );
    }

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

    state.signingSession.addNonceContribution(message.from, nonceContribution);

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
    if(!partialSignature) return;

    state.signingSession.addPartialSignature(message.from, partialSignature);

    if(state.signingSession.partialSignatures.size === state.cohort.participants.length) {
      // All partial sigs received — generate final signature
      const signature = state.signingSession.generateFinalSignature();

      // Set Taproot key-path witness (finalScriptWitness injects the aggregated MuSig2 sig)
      state.signingSession.pendingTx.updateInput(0, { finalScriptWitness: [signature] });

      state.result = {
        cohortId,
        signature,
        signedTx : state.signingSession.pendingTx,
      };
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

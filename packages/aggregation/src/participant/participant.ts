import { canonicalHash } from '@did-btcr2/common';
import type { SecuredDocument } from '@did-btcr2/cryptosuite';
import type { SerializedSMTProof} from '@did-btcr2/smt';
import { schnorr } from '@noble/curves/secp256k1.js';
import { bytesToHex, concatBytes, hexToBytes } from '@noble/hashes/utils';
import { Script, Transaction } from '@scure/btc-signer';
import { getBeaconStrategy } from '../core/beacon-strategy.js';
import { AggregationCohort } from '../core/cohort.js';
import type { CohortConditions } from '../core/conditions.js';
import { AggregationParticipantError } from '../core/errors.js';
import { fallbackSighash } from '../core/fallback-spend.js';
import { buildFallbackLeaf } from '../core/recovery-policy.js';
import type { BaseMessage } from '../core/messages/base.js';
import { isCohortAdvertMessage } from '../core/messages/bodies.js';
import { AGGREGATION_WIRE_VERSION } from '../core/messages/base.js';
import {
  AGGREGATED_NONCE,
  AUTHORIZATION_REQUEST,
  COHORT_ADVERT,
  COHORT_OPT_IN_ACCEPT,
  COHORT_READY,
  DISTRIBUTE_AGGREGATED_DATA,
  FALLBACK_AUTHORIZATION_REQUEST,
} from '../core/messages/constants.js';
import {
  createCohortOptInMessage,
  createFallbackSignatureMessage,
  createNonceContributionMessage,
  createSignatureAuthorizationMessage,
  createSubmitNonIncludedMessage,
  createSubmitUpdateMessage,
  createValidationAckMessage,
} from '../core/messages/factories.js';
import type { ParticipantCohortPhaseType } from '../core/phases.js';
import { ParticipantCohortPhase } from '../core/phases.js';
import type { AggregationSigner } from '../core/signer.js';
import { BeaconSigningSession } from '../core/signing-session.js';

/** Length of a beacon signal: SHA-256 of the CAS announcement, or the SMT root. */
const SIGNAL_BYTE_LENGTH = 32;

/**
 * The exact scriptPubKey a did:btcr2 resolver reads a signal out of:
 * `OP_RETURN OP_PUSHBYTES_32 <signal>`, i.e. the bytes `6a20 || signal`.
 * Resolution parses the serialized script of the transaction's LAST output
 * against that shape, so this is the only encoding that announces anything.
 */
function signalScript(signal: Uint8Array): Uint8Array {
  return concatBytes(new Uint8Array([ 0x6a, 0x20 ]), signal);
}

/** True if `script` is any OP_RETURN (data) output, whatever it carries. */
function isOpReturn(script: Uint8Array | undefined): boolean {
  if(!script) return false;
  try {
    return Script.decode(script)[0] === 'RETURN';
  } catch {
    return script.length > 0 && script[0] === 0x6a;
  }
}

/** Number of OP_RETURN outputs in `tx`. */
function opReturnOutputCount(tx: Transaction): number {
  let count = 0;
  for(let i = 0; i < tx.outputsLength; i++) {
    if(isOpReturn(tx.getOutput(i)?.script)) count++;
  }
  return count;
}

/** Sum of every output amount in `tx` (absent amounts count as zero). */
function totalOutputValue(tx: Transaction): bigint {
  let total = 0n;
  for(let i = 0; i < tx.outputsLength; i++) {
    total += tx.getOutput(i)?.amount ?? 0n;
  }
  return total;
}

/**
 * Cohort advert as discovered by the participant (UI: list of joinable cohorts).
 * Carries the advertised {@link CohortConditions} (beaconType, minParticipants,
 * maxParticipants, costs, ...) so a `shouldJoin` decision can inspect them.
 */
export interface CohortAdvert extends CohortConditions {
  cohortId: string;
  serviceDid: string;
  network: string;
  serviceCommunicationPk: Uint8Array;
}

/** Joined cohort info, available after the cohort is finalized. */
export interface JoinedCohortInfo {
  cohortId: string;
  serviceDid: string;
  beaconAddress: string;
  cohortKeys: Array<Uint8Array>;
}

/** Aggregated data awaiting participant validation (UI: review for approval). */
export interface PendingValidation {
  cohortId: string;
  beaconType: string;
  signalBytesHex: string;
  casAnnouncement?: Record<string, string>;
  smtProof?: SerializedSMTProof;
  /** Canonical hash of this participant's update; empty for a decliner. */
  expectedHash: string;
  /**
   * True when the member's own slot is correct in the distributed data AND
   * `signalBytesHex` is the signal that data derives to. Both halves are
   * required: a slot that validates against data the coordinator does not
   * intend to anchor authorizes nothing the member wanted.
   */
  matches: boolean;
  /** True if this participant submitted an update; false if it declined (non-inclusion). */
  included: boolean;
}

/** Pending signing request (UI: review tx for approval). */
export interface PendingSigningRequest {
  cohortId: string;
  sessionId: string;
  pendingTxHex: string;
  /** Hex-encoded scriptPubKey of the UTXO being spent. Required for BIP-341 sighash. */
  prevOutScriptHex: string;
  prevOutValue: string;
}

/**
 * Pending fallback signing request (UI: review the fallback spend for approval).
 * The service fell back to the k-of-n script path; the member signs the SAME
 * beacon transaction over the fallback script-path sighash (ADR 042).
 */
export interface PendingFallbackRequest {
  cohortId: string;
  sessionId: string;
  pendingTxHex: string;
  prevOutScriptHex: string;
  prevOutValue: string;
  /** Fallback leaf script, hex (advisory; the member recomputes it from its own cohort). */
  fallbackLeafScriptHex: string;
}

/** Per-cohort participant state (internal). */
interface ParticipantCohortState {
  phase: ParticipantCohortPhaseType;
  cohortId: string;
  serviceDid: string;
  advert?: CohortAdvert;
  cohort?: AggregationCohort;
  submittedUpdate?: SecuredDocument;
  /**
   * This round's intent, persisted because the phase advances past
   * NonIncluded/UpdateSubmitted into validation/signing. true = submitted an
   * update, false = declined (non-inclusion), undefined = not yet responded.
   */
  included?: boolean;
  validation?: PendingValidation;
  signingRequest?: PendingSigningRequest;
  fallbackRequest?: PendingFallbackRequest;
  signingSession?: BeaconSigningSession;
}

export interface AggregationParticipantParams {
  did: string;
  /**
   * The participant's MuSig2 signing capability. The raw secret is materialized
   * only for the duration of a single nonce/partial-sign operation (see ADR 038);
   * pass a {@link KeyPairAggregationSigner} to back it with an in-memory keypair.
   */
  signer: AggregationSigner;
  /**
   * The joining identity's genesis DID document. Required for an EXTERNAL (x1) did:btcr2
   * identifier, whose key is not in the DID string: it is attached to every cohort opt-in
   * this participant sends so the service can bootstrap-authenticate the participant from
   * the self-verifying genesis. Omitted for a KEY (k1) identifier. When present, the
   * participant's `signer` MUST be the keypair of the genesis document's
   * `capabilityInvocation[0]` verification method, so the advertised `communicationPk`
   * matches the genesis-derived key the service verifies against. Typed as a plain record
   * to keep the aggregation package DID-method-agnostic.
   */
  genesisDocument?: Record<string, unknown>;
}

/**
 * Sans-I/O state machine for an Aggregation Participant.
 *
 * Manages multiple cohorts simultaneously. The client app drives the state
 * machine via `receive()` (for incoming messages) and explicit action methods
 * (for user decisions). All outgoing messages are returned for the caller to
 * send via whatever transport.
 *
 * @class AggregationParticipant
 */
export class AggregationParticipant {
  public readonly did: string;

  /** MuSig2 signing capability. The raw secret never lives as a field here. */
  readonly #signer: AggregationSigner;

  /** EXTERNAL (x1) genesis document attached to opt-ins for bootstrap auth; undefined for k1. */
  readonly #genesisDocument?: Record<string, unknown>;

  /** Per-cohort state, keyed by cohortId. */
  #cohortStates: Map<string, ParticipantCohortState> = new Map();

  constructor({ did, signer, genesisDocument }: AggregationParticipantParams) {
    this.did = did;
    this.#signer = signer;
    this.#genesisDocument = genesisDocument;
  }

  /** The participant's compressed (33-byte) MuSig2 public key. Not secret. */
  public get publicKey(): Uint8Array {
    return this.#signer.publicKey;
  }


  /**
   * Process an incoming message. Updates internal state but never produces
   * outgoing messages: those come exclusively from action methods.
   */
  public receive(message: BaseMessage): void {
    // Reject messages whose wire version doesn't match what this build speaks.
    if(message.version === undefined || message.version !== AGGREGATION_WIRE_VERSION) {
      return;
    }
    const type = message.type;
    switch(type) {
      case COHORT_ADVERT:
        this.#handleCohortAdvert(message);
        break;
      case COHORT_OPT_IN_ACCEPT:
        this.#handleOptInAccept(message);
        break;
      case COHORT_READY:
        this.#handleCohortReady(message);
        break;
      case DISTRIBUTE_AGGREGATED_DATA:
        this.#handleDistributeAggregatedData(message);
        break;
      case AUTHORIZATION_REQUEST:
        this.#handleAuthorizationRequest(message);
        break;
      case AGGREGATED_NONCE:
        this.#handleAggregatedNonce(message);
        break;
      case FALLBACK_AUTHORIZATION_REQUEST:
        this.#handleFallbackAuthorizationRequest(message);
        break;
      default:
        // Unknown message type, silently ignore
        break;
    }
  }


  /** Cohorts the participant has discovered but not yet joined. */
  public get discoveredCohorts(): ReadonlyMap<string, CohortAdvert> {
    const map = new Map<string, CohortAdvert>();
    for(const [id, state] of this.#cohortStates) {
      if(state.phase === ParticipantCohortPhase.Discovered && state.advert) {
        map.set(id, state.advert);
      }
    }
    return map;
  }

  /**
   * Resolve the cohort a service-originated message names, and require the message to
   * come from that cohort's service.
   *
   * Every message below the advert is sent by the coordinator, and each one steers this
   * member: COHORT_READY pins the cohort keys and beacon address, DISTRIBUTE_AGGREGATED_DATA
   * decides what the member validates, AUTHORIZATION_REQUEST and FALLBACK_AUTHORIZATION_REQUEST
   * decide what it signs. `from` is a self-declared field, so a transport that does not bind
   * it to the sender's key (or a caller driving this state machine by hand) would otherwise
   * let any party drive a member's cohort from the outside. Transport authentication is the
   * first line; this is the state machine refusing to act on a stranger's say-so regardless.
   *
   * COHORT_ADVERT is deliberately not routed through here: the advert is what *establishes*
   * the service DID, so there is nothing yet to compare it against. Its authenticity is a
   * transport property (the signed Nostr event / the signed HTTP envelope).
   * @param {BaseMessage} message The inbound message.
   * @returns {ParticipantCohortState | undefined} The cohort state, or undefined when the
   * cohort is unknown or the sender is not its service.
   */
  #serviceCohortState(message: BaseMessage): ParticipantCohortState | undefined {
    const cohortId = message.body?.cohortId;
    if(!cohortId) return undefined;
    const state = this.#cohortStates.get(cohortId);
    if(!state) return undefined;
    if(message.from !== state.serviceDid) return undefined;
    return state;
  }

  #handleCohortAdvert(message: BaseMessage): void {
    // Validate the wire shape (incl. minParticipants range) before trusting it,
    // rather than reading fields with `?? 0` fallbacks (see ADR 039).
    if(!isCohortAdvertMessage(message)) return;
    const { cohortId, network, communicationPk, ...conditions } = message.body;
    if(this.#cohortStates.has(cohortId)) return;  // Already known

    const advert: CohortAdvert = {
      cohortId,
      serviceDid             : message.from,
      network,
      serviceCommunicationPk : communicationPk,
      ...conditions,
    };

    this.#cohortStates.set(cohortId, {
      phase      : ParticipantCohortPhase.Discovered,
      cohortId,
      serviceDid : message.from,
      advert,
    });
  }

  /**
   * User action: join a discovered cohort.
   * Returns the opt-in message to send.
   */
  public joinCohort(cohortId: string): BaseMessage[] {
    const state = this.#cohortStates.get(cohortId);
    if(!state || state.phase !== ParticipantCohortPhase.Discovered) {
      throw new AggregationParticipantError(
        `Cannot join cohort ${cohortId}: not in Discovered phase.`,
        'INVALID_PHASE', { cohortId, phase: state?.phase }
      );
    }

    // Create local cohort to track our view. Carry the advertised recovery
    // params so validateMembership recomputes the same script-tree beacon
    // address the service derived (ADR 042); a mismatch rejects the cohort.
    const advert = state.advert!;
    const cohort = new AggregationCohort({
      id                : cohortId,
      serviceDid        : state.serviceDid,
      minParticipants   : advert.minParticipants,
      network           : advert.network,
      beaconType        : advert.beaconType,
      recoveryKey       : advert.recoveryKey ? hexToBytes(advert.recoveryKey) : undefined,
      recoverySequence  : advert.recoverySequence,
      fundingModel      : advert.fundingModel,
      fallbackThreshold : advert.fallbackThreshold,
    });
    state.cohort = cohort;
    state.phase = ParticipantCohortPhase.OptedIn;

    const optInMessage = createCohortOptInMessage({
      from            : this.did,
      to              : state.serviceDid,
      cohortId,
      participantPk   : this.publicKey,
      communicationPk : this.publicKey,
      // Attach the genesis so an EXTERNAL (x1) sender can be bootstrap-authenticated by
      // the service; omitted for a KEY (k1) sender.
      ...(this.#genesisDocument ? { genesisDocument: this.#genesisDocument } : {}),
    });

    return [optInMessage];
  }

  #handleOptInAccept(message: BaseMessage): void {
    // Acknowledgment from service, no state change needed. Nothing to bind to the
    // cohort's service DID here for the same reason: this handler reads and writes no
    // state. Route it through #serviceCohortState if it ever grows a body.
    void message;
  }


  /** Cohorts that have been finalized: beacon address available. */
  public get joinedCohorts(): ReadonlyMap<string, JoinedCohortInfo> {
    const map = new Map<string, JoinedCohortInfo>();
    for(const [id, state] of this.#cohortStates) {
      if(state.cohort && state.cohort.beaconAddress) {
        map.set(id, {
          cohortId      : id,
          serviceDid    : state.serviceDid,
          beaconAddress : state.cohort.beaconAddress,
          cohortKeys    : state.cohort.cohortKeys,
        });
      }
    }
    return map;
  }

  #handleCohortReady(message: BaseMessage): void {
    const state = this.#serviceCohortState(message);
    if(!state || !state.cohort) return;
    if(state.phase !== ParticipantCohortPhase.OptedIn) return;

    const beaconAddress = message.body?.beaconAddress;
    const cohortKeys = message.body?.cohortKeys;
    if(!beaconAddress || !cohortKeys) return;

    const participantPkHex = bytesToHex(this.publicKey);
    const cohortKeysHex = cohortKeys.map(k => bytesToHex(new Uint8Array(k)));

    state.cohort.validateMembership(participantPkHex, cohortKeysHex, beaconAddress);
    state.phase = ParticipantCohortPhase.CohortReady;
  }


  /**
   * User action: submit a signed BTCR2 update for inclusion in the cohort's
   * aggregated signal.
   */
  public submitUpdate(cohortId: string, signedUpdate: SecuredDocument): BaseMessage[] {
    const state = this.#cohortStates.get(cohortId);
    if(!state || state.phase !== ParticipantCohortPhase.CohortReady) {
      throw new AggregationParticipantError(
        `Cannot submit update to cohort ${cohortId}: not in CohortReady phase.`,
        'INVALID_PHASE', { cohortId, phase: state?.phase }
      );
    }

    state.submittedUpdate = signedUpdate;
    state.included = true;
    state.phase = ParticipantCohortPhase.UpdateSubmitted;

    const message = createSubmitUpdateMessage({
      from         : this.did,
      to           : state.serviceDid,
      cohortId,
      signedUpdate : signedUpdate as unknown as Record<string, unknown>,
    });
    return [message];
  }

  /**
   * User action: decline to submit an update this round (cooperative
   * non-inclusion). The member stays in the cohort and still signs; it will be
   * absent from the CAS Announcement Map, or carry a non-inclusion leaf in the
   * SMT. Returns the SUBMIT_NONINCLUDED message to send.
   */
  public declineUpdate(cohortId: string): BaseMessage[] {
    const state = this.#cohortStates.get(cohortId);
    if(!state || state.phase !== ParticipantCohortPhase.CohortReady) {
      throw new AggregationParticipantError(
        `Cannot decline in cohort ${cohortId}: not in CohortReady phase.`,
        'INVALID_PHASE', { cohortId, phase: state?.phase }
      );
    }

    // Leave submittedUpdate unset; included=false is the load-bearing signal that
    // the validation handler uses to validate the non-inclusion slot.
    state.included = false;
    state.phase = ParticipantCohortPhase.NonIncluded;

    const message = createSubmitNonIncludedMessage({
      from : this.did,
      to   : state.serviceDid,
      cohortId,
    });
    return [message];
  }


  /** Aggregated data awaiting user validation. */
  public get pendingValidations(): ReadonlyMap<string, PendingValidation> {
    const map = new Map<string, PendingValidation>();
    for(const [id, state] of this.#cohortStates) {
      if(state.phase === ParticipantCohortPhase.AwaitingValidation && state.validation) {
        map.set(id, state.validation);
      }
    }
    return map;
  }

  /**
   * The validated aggregated data retained for a cohort, regardless of phase.
   * Unlike {@link pendingValidations} (which lists only cohorts still awaiting
   * the validate decision), this returns the stored validation, including the
   * participant's sidecar (the CAS Announcement map or its SMT inclusion proof),
   * so it is still readable once the cohort reaches Complete. Returns
   * undefined before aggregated data has been received.
   */
  public getValidation(cohortId: string): PendingValidation | undefined {
    return this.#cohortStates.get(cohortId)?.validation;
  }

  #handleDistributeAggregatedData(message: BaseMessage): void {
    const state = this.#serviceCohortState(message);
    // A submitter is in UpdateSubmitted; a decliner (cooperative non-inclusion)
    // is in NonIncluded. Both validate their own slot in the distributed data.
    if(!state || (state.phase !== ParticipantCohortPhase.UpdateSubmitted && state.phase !== ParticipantCohortPhase.NonIncluded)) return;
    const cohortId = state.cohortId;

    const declined = state.included === false;
    // A submitter must have its update stored; a decliner has none by design.
    if(!declined && !state.submittedUpdate) return;

    const beaconType = message.body?.beaconType;
    if(!beaconType) return;
    const strategy = getBeaconStrategy(beaconType);
    if(!strategy) return;

    const signalBytesHex = message.body?.signalBytesHex ?? '';
    // Decliner validates its non-inclusion slot (CAS absence / SMT non-inclusion
    // proof); submitter validates inclusion against its update hash.
    const expectedHash = declined ? '' : canonicalHash(state.submittedUpdate!);
    const result = strategy.validateParticipantView({
      participantDid  : this.did,
      included        : !declined,
      submittedUpdate : declined ? undefined : state.submittedUpdate,
      expectedHash    : declined ? undefined : expectedHash,
      body            : message.body!,
    });

    // Bind the announced signal to the data just validated. Validating a slot
    // says "this data is right"; it says nothing about the 32 bytes the
    // coordinator intends to anchor. Recompute the signal from the validated
    // data and require the announcement to be it, or the member would approve a
    // CAS map/SMT proof containing its update while the chain records a
    // different aggregation that omits it.
    const derivedSignal = strategy.deriveSignal(result);
    const signalBound = derivedSignal !== undefined
      && bytesToHex(derivedSignal) === signalBytesHex.toLowerCase();

    state.validation = {
      cohortId,
      beaconType,
      signalBytesHex,
      expectedHash,
      matches         : result.matches && signalBound,
      casAnnouncement : result.casAnnouncement,
      smtProof        : result.smtProof,
      included        : !declined,
    };
    state.phase = ParticipantCohortPhase.AwaitingValidation;
  }

  /**
   * User action: approve aggregated data and send validation ack.
   */
  public approveValidation(cohortId: string): BaseMessage[] {
    const state = this.#cohortStates.get(cohortId);
    if(!state || state.phase !== ParticipantCohortPhase.AwaitingValidation) {
      throw new AggregationParticipantError(
        `Cannot approve validation for cohort ${cohortId}: not in AwaitingValidation phase.`,
        'INVALID_PHASE', { cohortId, phase: state?.phase }
      );
    }
    state.phase = ParticipantCohortPhase.ValidationSent;
    return [createValidationAckMessage({
      from     : this.did,
      to       : state.serviceDid,
      cohortId,
      approved : true,
    })];
  }

  /**
   * User action: reject aggregated data and send rejection ack.
   */
  public rejectValidation(cohortId: string): BaseMessage[] {
    const state = this.#cohortStates.get(cohortId);
    if(!state || state.phase !== ParticipantCohortPhase.AwaitingValidation) {
      throw new AggregationParticipantError(
        `Cannot reject validation for cohort ${cohortId}: not in AwaitingValidation phase.`,
        'INVALID_PHASE', { cohortId, phase: state?.phase }
      );
    }
    state.phase = ParticipantCohortPhase.Failed;
    return [createValidationAckMessage({
      from     : this.did,
      to       : state.serviceDid,
      cohortId,
      approved : false,
    })];
  }


  /** Signing requests awaiting user approval. */
  public get pendingSigningRequests(): ReadonlyMap<string, PendingSigningRequest> {
    const map = new Map<string, PendingSigningRequest>();
    for(const [id, state] of this.#cohortStates) {
      if(state.phase === ParticipantCohortPhase.AwaitingSigning && state.signingRequest) {
        map.set(id, state.signingRequest);
      }
    }
    return map;
  }

  #handleAuthorizationRequest(message: BaseMessage): void {
    const state = this.#serviceCohortState(message);
    if(!state || !state.cohort) return;
    if(state.phase !== ParticipantCohortPhase.ValidationSent) return;
    const cohortId = state.cohortId;

    const sessionId = message.body?.sessionId;
    const pendingTxHex = message.body?.pendingTx;
    const prevOutScriptHex = message.body?.prevOutScriptHex;
    const prevOutValue = message.body?.prevOutValue;
    if(!sessionId || !pendingTxHex || !prevOutScriptHex || !prevOutValue) return;

    state.signingRequest = {
      cohortId,
      sessionId,
      pendingTxHex,
      prevOutScriptHex,
      prevOutValue,
    };
    state.phase = ParticipantCohortPhase.AwaitingSigning;
  }

  /**
   * Parse and range-check the spent output's value as supplied by the
   * coordinator. It is the only figure the member has for the input side, so a
   * malformed one must fail loudly rather than reach `BigInt` unguarded.
   */
  #prevOutValue(cohortId: string, raw: string): bigint {
    let value: bigint;
    try {
      value = BigInt(raw);
    } catch {
      throw new AggregationParticipantError(
        `Cohort ${cohortId} signing request carries a malformed prevOutValue.`,
        'INVALID_PREVOUT_VALUE', { cohortId, prevOutValue: raw }
      );
    }
    if(value < 0n) {
      throw new AggregationParticipantError(
        `Cohort ${cohortId} signing request carries a negative prevOutValue.`,
        'INVALID_PREVOUT_VALUE', { cohortId, prevOutValue: raw }
      );
    }
    return value;
  }

  /**
   * Gate every signature the member produces on the transaction it was shown.
   *
   * Both the optimistic nonce approval and the fallback approval sign with
   * SIGHASH_DEFAULT, which commits to the entire transaction, while the
   * coordinator alone chooses its inputs and outputs. The member therefore
   * checks the properties its announcement depends on before signing:
   *
   * - it validated the distributed data, and the announced signal is derived
   *   from that data (see {@link PendingValidation.matches});
   * - the LAST output is exactly `OP_RETURN OP_PUSHBYTES_32 <validated signal>`.
   *   Resolution reads the signal from the last output only, so a transaction
   *   carrying the member's signal anywhere else announces someone else's
   *   aggregation, whatever else it contains;
   * - that signal output burns nothing, and it is the transaction's only data
   *   output (a second OP_RETURN is ambiguous and non-standard);
   * - the transaction spends exactly one input. The protocol conveys a single
   *   prevout script/value, which is all a BIP-341 sighash over more inputs
   *   would need, so a multi-input transaction is one the member cannot check
   *   or correctly sign;
   * - the outputs do not spend more than the input holds, so the transaction is
   *   at least capable of confirming and the fee it implies is a real number.
   *
   * Deliberately NOT checked: where the change goes and how large the fee is.
   * The change destination is a caller-chosen privacy lever (ADR 044) and under
   * the only implemented funding model (`operator-funded`) the value at stake is
   * the coordinator's own, so a member cannot tell a legitimate change address
   * from a "drain" and has nothing of its own to lose either way.
   */
  #assertSignableBeaconTx(
    cohortId: string,
    state: ParticipantCohortState,
    tx: Transaction,
    prevOutValue: bigint,
  ): void {
    const validation = state.validation;
    if(!validation?.signalBytesHex) {
      throw new AggregationParticipantError(
        `Cohort ${cohortId} has no validated signal to bind the signature to.`,
        'MISSING_STATE', { cohortId }
      );
    }
    if(!validation.matches) {
      throw new AggregationParticipantError(
        `Cohort ${cohortId} aggregated data did not validate; refusing to sign.`,
        'UNVALIDATED_DATA', { cohortId }
      );
    }

    let signal: Uint8Array;
    try {
      signal = hexToBytes(validation.signalBytesHex);
    } catch {
      throw new AggregationParticipantError(
        `Cohort ${cohortId} validated signal is not hex.`,
        'SIGNAL_MISMATCH', { cohortId }
      );
    }
    if(signal.length !== SIGNAL_BYTE_LENGTH) {
      throw new AggregationParticipantError(
        `Cohort ${cohortId} validated signal is ${signal.length} bytes, expected ${SIGNAL_BYTE_LENGTH}.`,
        'SIGNAL_MISMATCH', { cohortId }
      );
    }

    if(tx.inputsLength !== 1) {
      throw new AggregationParticipantError(
        `Transaction for cohort ${cohortId} spends ${tx.inputsLength} inputs; exactly one is signable.`,
        'INVALID_TX_STRUCTURE', { cohortId, inputs: tx.inputsLength }
      );
    }

    const lastOutput = tx.outputsLength > 0 ? tx.getOutput(tx.outputsLength - 1) : undefined;
    const expectedScript = signalScript(signal);
    const lastScript = lastOutput?.script;
    const anchored = !!lastScript
      && lastScript.length === expectedScript.length
      && lastScript.every((b, i) => b === expectedScript[i]);
    if(!anchored) {
      throw new AggregationParticipantError(
        `Transaction for cohort ${cohortId} does not anchor the validated signal in its last output.`,
        'SIGNAL_MISMATCH', { cohortId }
      );
    }
    if((lastOutput?.amount ?? 0n) !== 0n) {
      throw new AggregationParticipantError(
        `Transaction for cohort ${cohortId} burns value in the signal output.`,
        'INVALID_TX_STRUCTURE', { cohortId, amount: lastOutput?.amount?.toString() }
      );
    }
    const dataOutputs = opReturnOutputCount(tx);
    if(dataOutputs !== 1) {
      throw new AggregationParticipantError(
        `Transaction for cohort ${cohortId} carries ${dataOutputs} OP_RETURN outputs; exactly one is allowed.`,
        'INVALID_TX_STRUCTURE', { cohortId, dataOutputs }
      );
    }

    const outputValue = totalOutputValue(tx);
    if(outputValue > prevOutValue) {
      throw new AggregationParticipantError(
        `Transaction for cohort ${cohortId} spends ${outputValue} from an input of ${prevOutValue}.`,
        'INVALID_TX_STRUCTURE', { cohortId, outputValue: outputValue.toString(), prevOutValue: prevOutValue.toString() }
      );
    }
  }

  /**
   * A fallback signature MUST cover the same transaction as the optimistic
   * round. The two paths spend one UTXO through different witnesses, so signing
   * a fallback over a different transaction hands the coordinator two competing
   * spends (a key-path signature for one, a k-of-n script path for the other)
   * and lets it choose which to broadcast. Members that never saw an
   * authorization request have nothing to compare against and authorize one
   * transaction only, so they are not held to this.
   */
  #assertMatchesOptimisticTx(cohortId: string, state: ParticipantCohortState, pendingTxHex: string): void {
    const optimisticTxHex = state.signingRequest?.pendingTxHex;
    if(optimisticTxHex && optimisticTxHex.toLowerCase() !== pendingTxHex.toLowerCase()) {
      throw new AggregationParticipantError(
        `Fallback transaction for cohort ${cohortId} differs from the transaction of the optimistic round.`,
        'TX_MISMATCH', { cohortId }
      );
    }
  }

  /**
   * User action: approve signing and generate nonce contribution.
   */
  public approveNonce(cohortId: string): BaseMessage[] {
    const state = this.#cohortStates.get(cohortId);
    if(!state || state.phase !== ParticipantCohortPhase.AwaitingSigning) {
      throw new AggregationParticipantError(
        `Cannot approve nonce for cohort ${cohortId}: not in AwaitingSigning phase.`,
        'INVALID_PHASE', { cohortId, phase: state?.phase }
      );
    }
    if(!state.signingRequest || !state.cohort) {
      throw new AggregationParticipantError(
        `Cohort ${cohortId} missing signing request or cohort state.`,
        'MISSING_STATE', { cohortId }
      );
    }

    // allowUnknownOutputs: a beacon transaction carries an OP_RETURN signal
    // output, which scure does not classify as a known (spendable) output type;
    // re-parsing the raw tx would otherwise throw.
    const tx = Transaction.fromRaw(hexToBytes(state.signingRequest.pendingTxHex), { allowUnknownOutputs: true });
    const prevOutValue = this.#prevOutValue(cohortId, state.signingRequest.prevOutValue);

    // Refuse to sign unless the tx announces the signal this member validated
    // and is otherwise a beacon transaction the member can account for.
    this.#assertSignableBeaconTx(cohortId, state, tx, prevOutValue);

    // Derive UTXO metadata for Taproot sighash (BIP-341). Use the script
    // supplied by the service in AUTHORIZATION_REQUEST rather than reading
    // the change output: input and change may use different scripts in future
    // beacon designs, and the prevOutScript must be the UTXO script, not the
    // change script.
    const prevOutScripts = [hexToBytes(state.signingRequest.prevOutScriptHex)];
    const prevOutValues = [prevOutValue];

    const session = new BeaconSigningSession({
      id        : state.signingRequest.sessionId,
      cohort    : state.cohort,
      pendingTx : tx,
      prevOutScripts,
      prevOutValues,
    });
    state.signingSession = session;

    const nonceContribution = this.#signer.withSecret(
      secretKey => session.generateNonceContribution(this.publicKey, secretKey)
    );

    state.phase = ParticipantCohortPhase.NonceSent;

    return [createNonceContributionMessage({
      from              : this.did,
      to                : state.serviceDid,
      cohortId,
      sessionId         : session.id,
      nonceContribution,
    })];
  }

  #handleAggregatedNonce(message: BaseMessage): void {
    const state = this.#serviceCohortState(message);
    if(!state || !state.signingSession) return;
    if(state.phase !== ParticipantCohortPhase.NonceSent) return;

    // The nonce must belong to the round this member is in. The service applies the
    // same check to every contribution it receives; without the mirror image, a stale
    // or replayed message from an earlier round installs its aggregated nonce here and
    // the partial signature computed from it is worthless.
    if(message.body?.sessionId !== state.signingSession.id) return;

    const aggregatedNonce = message.body?.aggregatedNonce;
    if(!aggregatedNonce) return;

    state.signingSession.aggregatedNonce = aggregatedNonce;
    state.phase = ParticipantCohortPhase.AwaitingPartialSig;
  }

  /**
   * User action: generate and return the partial signature.
   * In most UIs this is automatic after AwaitingPartialSig, but exposing it
   * as an explicit action lets the client UI confirm before signing if desired.
   */
  public generatePartialSignature(cohortId: string): BaseMessage[] {
    const state = this.#cohortStates.get(cohortId);
    if(!state || state.phase !== ParticipantCohortPhase.AwaitingPartialSig) {
      throw new AggregationParticipantError(
        `Cannot generate partial signature for cohort ${cohortId}: not in AwaitingPartialSig phase.`,
        'INVALID_PHASE', { cohortId, phase: state?.phase }
      );
    }
    if(!state.signingSession) {
      throw new AggregationParticipantError(
        `No signing session for cohort ${cohortId}.`,
        'MISSING_STATE', { cohortId }
      );
    }

    const signingSession = state.signingSession;
    const partialSig = this.#signer.withSecret(
      secretKey => signingSession.generatePartialSignature(secretKey)
    );
    state.phase = ParticipantCohortPhase.Complete;

    return [createSignatureAuthorizationMessage({
      from             : this.did,
      to               : state.serviceDid,
      cohortId,
      sessionId        : state.signingSession.id,
      partialSignature : partialSig,
    })];
  }


  /** Fallback signing requests awaiting user approval (UI: review the fallback spend). */
  public get pendingFallbackRequests(): ReadonlyMap<string, PendingFallbackRequest> {
    const map = new Map<string, PendingFallbackRequest>();
    for(const [id, state] of this.#cohortStates) {
      if(state.phase === ParticipantCohortPhase.AwaitingFallbackSig && state.fallbackRequest) {
        map.set(id, state.fallbackRequest);
      }
    }
    return map;
  }

  #handleFallbackAuthorizationRequest(message: BaseMessage): void {
    const state = this.#serviceCohortState(message);
    if(!state || !state.cohort) return;
    const cohortId = state.cohortId;
    // The service can fall back at any point after the member validated. This
    // includes the local Complete phase a member reaches the moment it sends its
    // optimistic partial signature: the cohort has NOT finalized (the service
    // only falls back before optimistic completion), and those members are
    // exactly the k signers the fallback needs. Signing both the optimistic
    // partial sig and the fallback sig is safe - both authorize the same outputs,
    // and only one witness can ever confirm the single UTXO. A genuinely failed
    // member is excluded. Ignore a duplicate request already being processed.
    const acceptFrom: ParticipantCohortPhaseType[] = [
      ParticipantCohortPhase.ValidationSent,
      ParticipantCohortPhase.AwaitingSigning,
      ParticipantCohortPhase.NonceSent,
      ParticipantCohortPhase.AwaitingPartialSig,
      ParticipantCohortPhase.Complete,
    ];
    if(!acceptFrom.includes(state.phase)) return;

    const sessionId = message.body?.sessionId;
    const pendingTxHex = message.body?.pendingTx;
    const prevOutScriptHex = message.body?.prevOutScriptHex;
    const prevOutValue = message.body?.prevOutValue;
    const fallbackLeafScriptHex = message.body?.fallbackLeafScriptHex;
    if(!sessionId || !pendingTxHex || !prevOutScriptHex || !prevOutValue || !fallbackLeafScriptHex) return;

    // Drop a request that does not carry the optimistic round's transaction or its
    // session, BEFORE the secret-nonce wipe below: accepting one would both authorize a
    // competing spend and, on its own, kill an in-flight optimistic round for
    // the price of a single unsolicited message. The fallback runs on the service's
    // existing signing session, so its id is the one already on record; a member still
    // in ValidationSent has no session to compare against and is held to neither check.
    const optimisticRequest = state.signingRequest;
    if(optimisticRequest && optimisticRequest.sessionId !== sessionId) return;
    const optimisticTxHex = optimisticRequest?.pendingTxHex;
    if(optimisticTxHex && optimisticTxHex.toLowerCase() !== pendingTxHex.toLowerCase()) return;

    state.fallbackRequest = { cohortId, sessionId, pendingTxHex, prevOutScriptHex, prevOutValue, fallbackLeafScriptHex };
    // The optimistic path is abandoned; wipe any retained secret nonce for it.
    state.signingSession?.clearSecrets();
    state.phase = ParticipantCohortPhase.AwaitingFallbackSig;
  }

  /**
   * User action: authorize the fallback spend. Recomputes the k-of-n fallback
   * leaf from the member's OWN cohort state (not the service-provided script),
   * computes the BIP-341 script-path sighash over the requested transaction, and
   * returns a standalone BIP-340 signature (no nonce round). The member completes
   * once it has contributed; the service needs only k of these.
   */
  public approveFallback(cohortId: string): BaseMessage[] {
    const state = this.#cohortStates.get(cohortId);
    if(!state || state.phase !== ParticipantCohortPhase.AwaitingFallbackSig) {
      throw new AggregationParticipantError(
        `Cannot approve fallback for cohort ${cohortId}: not in AwaitingFallbackSig phase.`,
        'INVALID_PHASE', { cohortId, phase: state?.phase }
      );
    }
    if(!state.fallbackRequest || !state.cohort) {
      throw new AggregationParticipantError(
        `Cohort ${cohortId} missing fallback request or cohort state.`,
        'MISSING_STATE', { cohortId }
      );
    }

    const req = state.fallbackRequest;
    const tx = Transaction.fromRaw(hexToBytes(req.pendingTxHex), { allowUnknownOutputs: true });
    const prevOutScript = hexToBytes(req.prevOutScriptHex);
    const prevOutValue = this.#prevOutValue(cohortId, req.prevOutValue);

    // The coordinator drives output selection on the fallback path too, so the
    // same transaction checks apply, plus: it must be the optimistic round's
    // transaction, not a second one competing with it.
    this.#assertSignableBeaconTx(cohortId, state, tx, prevOutValue);
    this.#assertMatchesOptimisticTx(cohortId, state, req.pendingTxHex);

    // Recompute the fallback leaf from our own cohort keys so a malicious service
    // cannot induce a signature over a different leaf than the one the funded
    // address commits to.
    const fallbackLeaf = buildFallbackLeaf({
      cohortKeys        : state.cohort.cohortKeys,
      fallbackThreshold : state.cohort.effectiveFallbackThreshold,
    });
    const sighash = fallbackSighash(tx, 0, prevOutScript, prevOutValue, fallbackLeaf);
    const signature = this.#signer.withSecret(secretKey => schnorr.sign(sighash, secretKey));

    state.phase = ParticipantCohortPhase.Complete;
    return [createFallbackSignatureMessage({
      from              : this.did,
      to                : state.serviceDid,
      cohortId,
      sessionId         : req.sessionId,
      signerPk          : this.publicKey.slice(1),
      fallbackSignature : signature,
    })];
  }


  public getCohortPhase(cohortId: string): ParticipantCohortPhaseType | undefined {
    return this.#cohortStates.get(cohortId)?.phase;
  }

  /**
   * Zeroize any retained MuSig2 secret nonces across all cohorts. The raw
   * signing key is never held here (it lives behind the {@link AggregationSigner}
   * and is wiped per-operation), but an abandoned signing session can still hold
   * a secret nonce; call this on teardown to clear it deterministically.
   */
  public clearSecrets(): void {
    for(const state of this.#cohortStates.values()) {
      state.signingSession?.clearSecrets();
    }
  }
}

import { canonicalHash } from '@did-btcr2/common';
import type { SecuredDocument } from '@did-btcr2/cryptosuite';
import type { SerializedSMTProof} from '@did-btcr2/smt';
import { schnorr } from '@noble/curves/secp256k1.js';
import { bytesToHex, hexToBytes } from '@noble/hashes/utils';
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

/**
 * True if `tx` has an OP_RETURN output whose payload equals the 32-byte signal
 * `signalHex`. A member binds its fallback signature to the exact signal it
 * validated, so a coordinator that drives the fallback output selection cannot
 * anchor a different announcement (a stale signal, or one whose CAS/SMT root
 * omits the member's update) under the member's signature.
 */
function txEmbedsSignal(tx: Transaction, signalHex: string): boolean {
  let expected: Uint8Array;
  try { expected = hexToBytes(signalHex); } catch { return false; }
  if(expected.length === 0) return false;
  for(let i = 0; i < tx.outputsLength; i++) {
    const script = tx.getOutput(i)?.script;
    if(!script) continue;
    let decoded: Array<string | Uint8Array>;
    try { decoded = Script.decode(script) as Array<string | Uint8Array>; } catch { continue; }
    if(decoded.length === 2 && decoded[0] === 'RETURN' && decoded[1] instanceof Uint8Array) {
      const payload = decoded[1];
      if(payload.length === expected.length && payload.every((b, j) => b === expected[j])) return true;
    }
  }
  return false;
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
    // Acknowledgment from service, no state change needed
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
    const cohortId = message.body?.cohortId;
    if(!cohortId) return;
    const state = this.#cohortStates.get(cohortId);
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
    const cohortId = message.body?.cohortId;
    if(!cohortId) return;
    const state = this.#cohortStates.get(cohortId);
    // A submitter is in UpdateSubmitted; a decliner (cooperative non-inclusion)
    // is in NonIncluded. Both validate their own slot in the distributed data.
    if(!state || (state.phase !== ParticipantCohortPhase.UpdateSubmitted && state.phase !== ParticipantCohortPhase.NonIncluded)) return;

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

    state.validation = {
      cohortId,
      beaconType,
      signalBytesHex,
      expectedHash,
      matches         : result.matches,
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
    const cohortId = message.body?.cohortId;
    if(!cohortId) return;
    const state = this.#cohortStates.get(cohortId);
    if(!state || !state.cohort) return;
    if(state.phase !== ParticipantCohortPhase.ValidationSent) return;

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
   * Bind a signing approval to the announcement the member validated: a beacon
   * transaction MUST carry an OP_RETURN with the exact 32-byte signal stored when
   * the aggregated data was distributed. Both the optimistic nonce approval and
   * the fallback approval sign with SIGHASH_DEFAULT (committing to every output)
   * while the coordinator drives output selection, so without this check a
   * coordinator could anchor a different signal under the member's signature.
   */
  #assertTxAnchorsValidatedSignal(cohortId: string, state: ParticipantCohortState, tx: Transaction): void {
    const signalHex = state.validation?.signalBytesHex;
    if(!signalHex) {
      throw new AggregationParticipantError(
        `Cohort ${cohortId} has no validated signal to bind the signature to.`,
        'MISSING_STATE', { cohortId }
      );
    }
    if(!txEmbedsSignal(tx, signalHex)) {
      throw new AggregationParticipantError(
        `Transaction for cohort ${cohortId} does not anchor the validated signal.`,
        'SIGNAL_MISMATCH', { cohortId }
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

    // Refuse to sign unless the tx anchors the signal this member validated.
    this.#assertTxAnchorsValidatedSignal(cohortId, state, tx);

    // Derive UTXO metadata for Taproot sighash (BIP-341). Use the script
    // supplied by the service in AUTHORIZATION_REQUEST rather than reading
    // the change output: input and change may use different scripts in future
    // beacon designs, and the prevOutScript must be the UTXO script, not the
    // change script.
    const prevOutScripts = [hexToBytes(state.signingRequest.prevOutScriptHex)];
    const prevOutValues = [BigInt(state.signingRequest.prevOutValue)];

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
    const cohortId = message.body?.cohortId;
    if(!cohortId) return;
    const state = this.#cohortStates.get(cohortId);
    if(!state || !state.signingSession) return;
    if(state.phase !== ParticipantCohortPhase.NonceSent) return;

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
    const cohortId = message.body?.cohortId;
    if(!cohortId) return;
    const state = this.#cohortStates.get(cohortId);
    if(!state || !state.cohort) return;
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
    const prevOutValue = BigInt(req.prevOutValue);

    // Refuse to sign unless the fallback tx anchors the signal this member
    // validated (the coordinator drives output selection on the fallback path).
    this.#assertTxAnchorsValidatedSignal(cohortId, state, tx);

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

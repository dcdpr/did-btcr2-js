import { canonicalHash, canonicalize } from '@did-btcr2/common';
import type { SignedBTCR2Update } from '@did-btcr2/cryptosuite';
import type { SchnorrKeyPair } from '@did-btcr2/keypair';
import type { SerializedSMTProof} from '@did-btcr2/smt';
import { blockHash, didToIndex, hashToHex, hexToHash, verifySerializedProof } from '@did-btcr2/smt';
import { bytesToHex } from '@noble/hashes/utils';
import { Transaction } from 'bitcoinjs-lib';
import { AggregationCohort } from './cohort.js';
import { AggregationParticipantError } from './errors.js';
import type { BaseMessage } from './messages/base.js';
import {
  AGGREGATED_NONCE,
  AUTHORIZATION_REQUEST,
  COHORT_ADVERT,
  COHORT_OPT_IN_ACCEPT,
  COHORT_READY,
  DISTRIBUTE_AGGREGATED_DATA,
} from './messages/constants.js';
import {
  createCohortOptInMessage,
  createNonceContributionMessage,
  createSignatureAuthorizationMessage,
  createSubmitUpdateMessage,
  createValidationAckMessage,
} from './messages/factories.js';
import type { ParticipantCohortPhaseType } from './phases.js';
import { ParticipantCohortPhase } from './phases.js';
import { BeaconSigningSession } from './signing-session.js';

/** Cohort advert as discovered by the participant (UI: list of joinable cohorts). */
export interface CohortAdvert {
  cohortId: string;
  serviceDid: string;
  cohortSize: number;
  network: string;
  beaconType: string;
  serviceCommunicationPk: Uint8Array;
}

/** Joined cohort info — available after the cohort is finalized. */
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
  expectedHash: string;
  matches: boolean;
}

/** Pending signing request (UI: review tx for approval). */
export interface PendingSigningRequest {
  cohortId: string;
  sessionId: string;
  pendingTxHex: string;
  prevOutValue: string;
}

/** Per-cohort participant state — internal. */
interface ParticipantCohortState {
  phase: ParticipantCohortPhaseType;
  cohortId: string;
  serviceDid: string;
  advert?: CohortAdvert;
  cohort?: AggregationCohort;
  submittedUpdate?: SignedBTCR2Update;
  validation?: PendingValidation;
  signingRequest?: PendingSigningRequest;
  signingSession?: BeaconSigningSession;
}

export interface AggregationParticipantParams {
  did: string;
  keys: SchnorrKeyPair;
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
  public readonly keys: SchnorrKeyPair;

  /** Per-cohort state, keyed by cohortId. */
  #cohortStates: Map<string, ParticipantCohortState> = new Map();

  constructor({ did, keys }: AggregationParticipantParams) {
    this.did = did;
    this.keys = keys;
  }


  /**
   * Process an incoming message. Updates internal state but never produces
   * outgoing messages — those come exclusively from action methods.
   */
  public receive(message: BaseMessage): void {
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
      default:
        // Unknown message type — silently ignore
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
    const cohortId = message.body?.cohortId;
    if(!cohortId) return;
    if(this.#cohortStates.has(cohortId)) return;  // Already known

    const advert: CohortAdvert = {
      cohortId,
      serviceDid             : message.from,
      cohortSize             : message.body?.cohortSize ?? 0,
      network                : message.body?.network ?? '',
      beaconType             : message.body?.beaconType ?? 'CASBeacon',
      serviceCommunicationPk : message.body?.communicationPk ?? new Uint8Array(),
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

    // Create local cohort to track our view
    const cohort = new AggregationCohort({
      id              : cohortId,
      serviceDid      : state.serviceDid,
      minParticipants : state.advert!.cohortSize,
      network         : state.advert!.network,
      beaconType      : state.advert!.beaconType,
    });
    state.cohort = cohort;
    state.phase = ParticipantCohortPhase.OptedIn;

    const optInMessage = createCohortOptInMessage({
      from            : this.did,
      to              : state.serviceDid,
      cohortId,
      participantPk   : this.keys.publicKey.compressed,
      communicationPk : this.keys.publicKey.compressed,
    });

    return [optInMessage];
  }

  #handleOptInAccept(message: BaseMessage): void {
    // Acknowledgment from service — no state change needed
    void message;
  }


  /** Cohorts that have been finalized — beacon address available. */
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

    const participantPkHex = bytesToHex(this.keys.publicKey.compressed);
    const cohortKeysHex = cohortKeys.map(k => bytesToHex(new Uint8Array(k)));

    state.cohort.validateMembership(participantPkHex, cohortKeysHex, beaconAddress);
    state.phase = ParticipantCohortPhase.CohortReady;
  }


  /**
   * User action: submit a signed BTCR2 update for inclusion in the cohort's
   * aggregated signal.
   */
  public submitUpdate(cohortId: string, signedUpdate: SignedBTCR2Update): BaseMessage[] {
    const state = this.#cohortStates.get(cohortId);
    if(!state || state.phase !== ParticipantCohortPhase.CohortReady) {
      throw new AggregationParticipantError(
        `Cannot submit update to cohort ${cohortId}: not in CohortReady phase.`,
        'INVALID_PHASE', { cohortId, phase: state?.phase }
      );
    }

    state.submittedUpdate = signedUpdate;
    state.phase = ParticipantCohortPhase.UpdateSubmitted;

    const message = createSubmitUpdateMessage({
      from         : this.did,
      to           : state.serviceDid,
      cohortId,
      signedUpdate : signedUpdate as unknown as Record<string, unknown>,
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

  #handleDistributeAggregatedData(message: BaseMessage): void {
    const cohortId = message.body?.cohortId;
    if(!cohortId) return;
    const state = this.#cohortStates.get(cohortId);
    if(!state || state.phase !== ParticipantCohortPhase.UpdateSubmitted) return;
    if(!state.submittedUpdate) return;

    const beaconType = message.body?.beaconType;
    const signalBytesHex = message.body?.signalBytesHex ?? '';
    const expectedHash = canonicalHash(state.submittedUpdate);
    let matches = false;

    if(beaconType === 'CASBeacon') {
      const casAnnouncement = message.body?.casAnnouncement;
      if(casAnnouncement) {
        matches = casAnnouncement[this.did] === expectedHash;
        state.validation = {
          cohortId,
          beaconType,
          signalBytesHex,
          casAnnouncement,
          expectedHash,
          matches,
        };
      }
    } else if(beaconType === 'SMTBeacon') {
      const smtProof = message.body?.smtProof as unknown as SerializedSMTProof | undefined;
      if(smtProof?.updateId && smtProof?.nonce) {
        // Verify updateId matches the canonicalized update hash
        const canonicalBytes = new TextEncoder().encode(canonicalize(state.submittedUpdate));
        const expectedUpdateId = hashToHex(blockHash(canonicalBytes));
        if(smtProof.updateId === expectedUpdateId) {
          // Verify Merkle inclusion
          const index = didToIndex(this.did);
          const candidateHash = blockHash(blockHash(hexToHash(smtProof.nonce)), hexToHash(smtProof.updateId));
          matches = verifySerializedProof(smtProof, index, candidateHash);
        }
        state.validation = {
          cohortId,
          beaconType,
          signalBytesHex,
          smtProof,
          expectedHash,
          matches,
        };
      }
    }

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
    const prevOutValue = message.body?.prevOutValue;
    if(!sessionId || !pendingTxHex || !prevOutValue) return;

    state.signingRequest = {
      cohortId,
      sessionId,
      pendingTxHex,
      prevOutValue,
    };
    state.phase = ParticipantCohortPhase.AwaitingSigning;
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

    const tx = Transaction.fromHex(state.signingRequest.pendingTxHex);

    // Derive UTXO metadata for Taproot sighash (BIP-341).
    // The beacon TX's change output (index 0) uses the same Taproot address as the input.
    const prevOutScripts = tx.outs.length > 0 ? [tx.outs[0].script] : [];
    const prevOutValues = [BigInt(state.signingRequest.prevOutValue)];

    const session = new BeaconSigningSession({
      id        : state.signingRequest.sessionId,
      cohort    : state.cohort,
      pendingTx : tx,
      prevOutScripts,
      prevOutValues,
    });
    state.signingSession = session;

    const nonceContribution = session.generateNonceContribution(
      this.keys.publicKey.compressed,
      this.keys.secretKey.bytes
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
   * In most UIs this is automatic after AwaitingPartialSig — but exposing it
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

    const partialSig = state.signingSession.generatePartialSignature(this.keys.secretKey.bytes);
    state.phase = ParticipantCohortPhase.Complete;

    return [createSignatureAuthorizationMessage({
      from             : this.did,
      to               : state.serviceDid,
      cohortId,
      sessionId        : state.signingSession.id,
      partialSignature : partialSig,
    })];
  }


  public getCohortPhase(cohortId: string): ParticipantCohortPhaseType | undefined {
    return this.#cohortStates.get(cohortId)?.phase;
  }
}

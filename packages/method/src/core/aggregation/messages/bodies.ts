/**
 * Per-message-type body interfaces and a discriminated {@link AggregationMessage}
 * union.
 *
 * {@link BaseBody} remains the superset-of-all-fields body type used by the
 * raw {@link BaseMessage} class (see `base.ts`). The narrow interfaces here
 * describe what each specific message type is *required* to carry and are
 * exposed alongside type guards for consumers who want compile-time narrowing.
 *
 * Guards validate both `type` and the presence of required body fields so they
 * are safe to use on messages that have round-tripped through JSON / a relay.
 */

import type { SerializedSMTProof } from '@did-btcr2/smt';
import type { BaseMessage } from './base.js';
import {
  AGGREGATED_NONCE,
  AUTHORIZATION_REQUEST,
  COHORT_ADVERT,
  COHORT_OPT_IN,
  COHORT_OPT_IN_ACCEPT,
  COHORT_READY,
  DISTRIBUTE_AGGREGATED_DATA,
  NONCE_CONTRIBUTION,
  SIGNATURE_AUTHORIZATION,
  SUBMIT_UPDATE,
  VALIDATION_ACK,
} from './constants.js';

// ── Cohort formation (Step 1) ─────────────────────────────────────────────

export interface CohortAdvertBody {
  cohortId: string;
  cohortSize: number;
  beaconType: string;
  network: string;
  communicationPk: Uint8Array;
}

export interface CohortOptInBody {
  cohortId: string;
  participantPk: Uint8Array;
  communicationPk: Uint8Array;
}

export interface CohortOptInAcceptBody {
  cohortId: string;
}

export interface CohortReadyBody {
  cohortId: string;
  beaconAddress: string;
  cohortKeys: Array<Uint8Array>;
}

// ── Update / aggregation (Steps 2-3) ──────────────────────────────────────

export interface SubmitUpdateBody {
  cohortId: string;
  signedUpdate: Record<string, unknown>;
}

export interface DistributeAggregatedDataBody {
  cohortId: string;
  beaconType: string;
  signalBytesHex: string;
  casAnnouncement?: Record<string, string>;
  smtProof?: Record<string, unknown> | SerializedSMTProof;
}

export interface ValidationAckBody {
  cohortId: string;
  approved: boolean;
}

// ── Signing (Step 4) ──────────────────────────────────────────────────────

export interface AuthorizationRequestBody {
  cohortId: string;
  sessionId: string;
  pendingTx: string;
  prevOutScriptHex: string;
  prevOutValue: string;
}

export interface NonceContributionBody {
  cohortId: string;
  sessionId: string;
  nonceContribution: Uint8Array;
}

export interface AggregatedNonceBody {
  cohortId: string;
  sessionId: string;
  aggregatedNonce: Uint8Array;
}

export interface SignatureAuthorizationBody {
  cohortId: string;
  sessionId: string;
  partialSignature: Uint8Array;
}

// ── Narrow message types (BaseMessage & { type, body }) ──────────────────

export type CohortAdvertMessage = BaseMessage & { type: typeof COHORT_ADVERT; body: CohortAdvertBody };
export type CohortOptInMessage = BaseMessage & { type: typeof COHORT_OPT_IN; body: CohortOptInBody };
export type CohortOptInAcceptMessage = BaseMessage & { type: typeof COHORT_OPT_IN_ACCEPT; body: CohortOptInAcceptBody };
export type CohortReadyMessage = BaseMessage & { type: typeof COHORT_READY; body: CohortReadyBody };
export type SubmitUpdateMessage = BaseMessage & { type: typeof SUBMIT_UPDATE; body: SubmitUpdateBody };
export type DistributeAggregatedDataMessage = BaseMessage & { type: typeof DISTRIBUTE_AGGREGATED_DATA; body: DistributeAggregatedDataBody };
export type ValidationAckMessage = BaseMessage & { type: typeof VALIDATION_ACK; body: ValidationAckBody };
export type AuthorizationRequestMessage = BaseMessage & { type: typeof AUTHORIZATION_REQUEST; body: AuthorizationRequestBody };
export type NonceContributionMessage = BaseMessage & { type: typeof NONCE_CONTRIBUTION; body: NonceContributionBody };
export type AggregatedNonceMessage = BaseMessage & { type: typeof AGGREGATED_NONCE; body: AggregatedNonceBody };
export type SignatureAuthorizationMessage = BaseMessage & { type: typeof SIGNATURE_AUTHORIZATION; body: SignatureAuthorizationBody };

/** Discriminated union of every well-formed aggregation message. */
export type AggregationMessage =
  | CohortAdvertMessage
  | CohortOptInMessage
  | CohortOptInAcceptMessage
  | CohortReadyMessage
  | SubmitUpdateMessage
  | DistributeAggregatedDataMessage
  | ValidationAckMessage
  | AuthorizationRequestMessage
  | NonceContributionMessage
  | AggregatedNonceMessage
  | SignatureAuthorizationMessage;

// ── Type guards ───────────────────────────────────────────────────────────
// Each guard validates `type` plus required body fields so it's safe to use
// on messages that have round-tripped through JSON / a relay.

const hasStr = (b: unknown, k: string): boolean =>
  !!b && typeof (b as Record<string, unknown>)[k] === 'string';
const hasNum = (b: unknown, k: string): boolean =>
  !!b && typeof (b as Record<string, unknown>)[k] === 'number';
const hasBool = (b: unknown, k: string): boolean =>
  !!b && typeof (b as Record<string, unknown>)[k] === 'boolean';
const hasBytes = (b: unknown, k: string): boolean =>
  !!b && (b as Record<string, unknown>)[k] instanceof Uint8Array;
const hasBytesArray = (b: unknown, k: string): boolean => {
  const v = b ? (b as Record<string, unknown>)[k] : undefined;
  return Array.isArray(v) && v.every(x => x instanceof Uint8Array);
};

export function isCohortAdvertMessage(m: BaseMessage): m is CohortAdvertMessage {
  return m.type === COHORT_ADVERT
    && hasStr(m.body, 'cohortId')
    && hasNum(m.body, 'cohortSize')
    && hasStr(m.body, 'beaconType')
    && hasStr(m.body, 'network')
    && hasBytes(m.body, 'communicationPk');
}

export function isCohortOptInMessage(m: BaseMessage): m is CohortOptInMessage {
  return m.type === COHORT_OPT_IN
    && hasStr(m.body, 'cohortId')
    && hasBytes(m.body, 'participantPk')
    && hasBytes(m.body, 'communicationPk');
}

export function isCohortOptInAcceptMessage(m: BaseMessage): m is CohortOptInAcceptMessage {
  return m.type === COHORT_OPT_IN_ACCEPT && hasStr(m.body, 'cohortId');
}

export function isCohortReadyMessage(m: BaseMessage): m is CohortReadyMessage {
  return m.type === COHORT_READY
    && hasStr(m.body, 'cohortId')
    && hasStr(m.body, 'beaconAddress')
    && hasBytesArray(m.body, 'cohortKeys');
}

export function isSubmitUpdateMessage(m: BaseMessage): m is SubmitUpdateMessage {
  return m.type === SUBMIT_UPDATE
    && hasStr(m.body, 'cohortId')
    && !!m.body && typeof (m.body as Record<string, unknown>).signedUpdate === 'object';
}

export function isDistributeAggregatedDataMessage(m: BaseMessage): m is DistributeAggregatedDataMessage {
  return m.type === DISTRIBUTE_AGGREGATED_DATA
    && hasStr(m.body, 'cohortId')
    && hasStr(m.body, 'beaconType')
    && hasStr(m.body, 'signalBytesHex');
}

export function isValidationAckMessage(m: BaseMessage): m is ValidationAckMessage {
  return m.type === VALIDATION_ACK
    && hasStr(m.body, 'cohortId')
    && hasBool(m.body, 'approved');
}

export function isAuthorizationRequestMessage(m: BaseMessage): m is AuthorizationRequestMessage {
  return m.type === AUTHORIZATION_REQUEST
    && hasStr(m.body, 'cohortId')
    && hasStr(m.body, 'sessionId')
    && hasStr(m.body, 'pendingTx')
    && hasStr(m.body, 'prevOutScriptHex')
    && hasStr(m.body, 'prevOutValue');
}

export function isNonceContributionMessage(m: BaseMessage): m is NonceContributionMessage {
  return m.type === NONCE_CONTRIBUTION
    && hasStr(m.body, 'cohortId')
    && hasStr(m.body, 'sessionId')
    && hasBytes(m.body, 'nonceContribution');
}

export function isAggregatedNonceMessage(m: BaseMessage): m is AggregatedNonceMessage {
  return m.type === AGGREGATED_NONCE
    && hasStr(m.body, 'cohortId')
    && hasStr(m.body, 'sessionId')
    && hasBytes(m.body, 'aggregatedNonce');
}

export function isSignatureAuthorizationMessage(m: BaseMessage): m is SignatureAuthorizationMessage {
  return m.type === SIGNATURE_AUTHORIZATION
    && hasStr(m.body, 'cohortId')
    && hasStr(m.body, 'sessionId')
    && hasBytes(m.body, 'partialSignature');
}

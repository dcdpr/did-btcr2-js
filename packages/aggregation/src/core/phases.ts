/**
 * Phases for the did:btcr2 Aggregate Beacon protocol.
 *
 * The protocol has two roles (AggregationService and AggregationParticipant)
 * which experience different phases for the same cohort. Each role has its own
 * phase enum.
 *
 * The signing session has its own phase enum because MuSig2 signing is a
 * sub-protocol within the larger aggregation protocol.
 */
export type ServiceCohortPhaseType =
  | 'Created'
  | 'Advertised'
  | 'CohortSet'
  | 'CollectingUpdates'
  | 'UpdatesCollected'
  | 'DataDistributed'
  | 'Validated'
  | 'SigningStarted'
  | 'NoncesCollected'
  | 'AwaitingPartialSigs'
  | 'FallbackRequested'
  | 'Complete'
  | 'Failed';

export enum ServiceCohortPhase {
  Created = 'Created',
  Advertised = 'Advertised',
  CohortSet = 'CohortSet',
  CollectingUpdates = 'CollectingUpdates',
  UpdatesCollected = 'UpdatesCollected',
  DataDistributed = 'DataDistributed',
  Validated = 'Validated',
  SigningStarted = 'SigningStarted',
  NoncesCollected = 'NoncesCollected',
  AwaitingPartialSigs = 'AwaitingPartialSigs',
  /** Optimistic n-of-n key path abandoned; collecting k-of-n fallback signatures (ADR 042). */
  FallbackRequested = 'FallbackRequested',
  Complete = 'Complete',
  Failed = 'Failed',
}

export type ParticipantCohortPhaseType =
  | 'Discovered'
  | 'OptedIn'
  | 'CohortReady'
  | 'UpdateSubmitted'
  | 'NonIncluded'
  | 'AwaitingValidation'
  | 'ValidationSent'
  | 'AwaitingSigning'
  | 'NonceSent'
  | 'AwaitingPartialSig'
  | 'AwaitingFallbackSig'
  | 'Complete'
  | 'Failed';

export enum ParticipantCohortPhase {
  Discovered = 'Discovered',
  OptedIn = 'OptedIn',
  CohortReady = 'CohortReady',
  UpdateSubmitted = 'UpdateSubmitted',
  /** Member declined to submit an update this round (cooperative non-inclusion); still signs. */
  NonIncluded = 'NonIncluded',
  AwaitingValidation = 'AwaitingValidation',
  ValidationSent = 'ValidationSent',
  AwaitingSigning = 'AwaitingSigning',
  NonceSent = 'NonceSent',
  AwaitingPartialSig = 'AwaitingPartialSig',
  /** Service fell back to the k-of-n script path; member can sign the fallback (ADR 042). */
  AwaitingFallbackSig = 'AwaitingFallbackSig',
  Complete = 'Complete',
  Failed = 'Failed',
}

export type SigningSessionPhaseType =
  | 'AwaitingNonceContributions'
  | 'NonceContributionsReceived'
  | 'AwaitingPartialSignatures'
  | 'PartialSignaturesReceived'
  | 'Complete'
  | 'Failed';

export enum SigningSessionPhase {
  AwaitingNonceContributions = 'AwaitingNonceContributions',
  NonceContributionsReceived = 'NonceContributionsReceived',
  AwaitingPartialSignatures = 'AwaitingPartialSignatures',
  PartialSignaturesReceived = 'PartialSignaturesReceived',
  Complete = 'Complete',
  Failed = 'Failed',
}

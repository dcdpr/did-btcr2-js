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
  Complete = 'Complete',
  Failed = 'Failed',
}

export type ParticipantCohortPhaseType =
  | 'Discovered'
  | 'OptedIn'
  | 'CohortReady'
  | 'UpdateSubmitted'
  | 'AwaitingValidation'
  | 'ValidationSent'
  | 'AwaitingSigning'
  | 'NonceSent'
  | 'AwaitingPartialSig'
  | 'Complete'
  | 'Failed';

export enum ParticipantCohortPhase {
  Discovered = 'Discovered',
  OptedIn = 'OptedIn',
  CohortReady = 'CohortReady',
  UpdateSubmitted = 'UpdateSubmitted',
  AwaitingValidation = 'AwaitingValidation',
  ValidationSent = 'ValidationSent',
  AwaitingSigning = 'AwaitingSigning',
  NonceSent = 'NonceSent',
  AwaitingPartialSig = 'AwaitingPartialSig',
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

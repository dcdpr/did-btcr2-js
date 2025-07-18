import { Maybe } from '@did-btc1/common';
import { BaseMessage } from '../base.js';
import { BEACON_COHORT_NONCE_CONTRIBUTION } from '../constants.js';

export interface CohortNonceContributionMessage {
  to: string;
  from: string;
  cohortId: string;
  sessionId: string;
  nonceContribution: Uint8Array;
}

/**
 * Represents a message containing a nonce contribution for a cohort participant.
 * Participant → Coordinator. Participant sending their public nonce points for the ongoing signing session.
 * @class BeaconCohortNonceContributionMessage
 * @extends BaseMessage
 * @type {BeaconCohortNonceContributionMessage}
 */
export class BeaconCohortNonceContributionMessage extends BaseMessage {
  public cohortId: string;
  public sessionId: string;
  public nonceContribution: Uint8Array;

  constructor(nonceContribMessage: CohortNonceContributionMessage) {
    super({ ...nonceContribMessage, type: BEACON_COHORT_NONCE_CONTRIBUTION });
    this.cohortId = nonceContribMessage.cohortId;
    this.sessionId = nonceContribMessage.sessionId;
    this.nonceContribution = nonceContribMessage.nonceContribution;
  }

  /**
   * Initializes a NonceContributionMessage from a given CohortNonceContributionMessage object.
   * @param {CohortNonceContributionMessage} data The data object to initialize the BeaconCohortNonceContributionMessage.
   * @returns {BeaconCohortNonceContributionMessage} The new BeaconCohortNonceContributionMessage.
   */
  public static fromJSON(data: Maybe<CohortNonceContributionMessage>): BeaconCohortNonceContributionMessage {
    if (data.type != BEACON_COHORT_NONCE_CONTRIBUTION) {
      throw new Error(`Invalid type: ${data.type}`);
    }
    return new BeaconCohortNonceContributionMessage(data);
  }
}
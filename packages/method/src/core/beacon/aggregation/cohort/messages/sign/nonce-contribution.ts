import { JSONUtils, Maybe } from '@did-btcr2/common';
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
  constructor({ to, from, cohortId, sessionId, nonceContribution }: CohortNonceContributionMessage) {
    const body = { cohortId, sessionId, nonceContribution };
    const type = BEACON_COHORT_NONCE_CONTRIBUTION;
    super({ to, from, body, type });
  }

  /**
   * Initializes a NonceContributionMessage from a given CohortNonceContributionMessage object.
   * @param {CohortNonceContributionMessage} data The data object to initialize the BeaconCohortNonceContributionMessage.
   * @returns {BeaconCohortNonceContributionMessage} The new BeaconCohortNonceContributionMessage.
   */
  public static fromJSON(data: Maybe<CohortNonceContributionMessage>): BeaconCohortNonceContributionMessage {
    const message = JSONUtils.isParsable(data) ? JSON.parse(data) : data;
    if (message.type != BEACON_COHORT_NONCE_CONTRIBUTION) {
      throw new Error(`Invalid type: ${message.type}`);
    }
    return new BeaconCohortNonceContributionMessage(message);
  }
}
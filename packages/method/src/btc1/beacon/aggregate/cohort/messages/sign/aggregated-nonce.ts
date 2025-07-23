import { Maybe } from '@did-btc1/common';
import { BaseMessage } from '../base.js';
import { BEACON_COHORT_AGGREGATED_NONCE } from '../constants.js';

export interface CohortAggregatedNonceMessage {
  to: string;
  from: string;
  cohortId: string;
  sessionId: string;
  aggregatedNonce: Uint8Array;
}

/**
 * Represents a message containing an aggregated nonce for a cohort in the Beacon protocol.
 * @class BeaconCohortAggregatedNonceMessage
 * @extends BaseMessage
 * @type {BeaconCohortAggregatedNonceMessage}
 */
export class BeaconCohortAggregatedNonceMessage extends BaseMessage {
  constructor({ to, from, cohortId, sessionId, aggregatedNonce }: CohortAggregatedNonceMessage) {
    const body = { cohortId, sessionId, aggregatedNonce };
    const type = BEACON_COHORT_AGGREGATED_NONCE;
    super({ to, from, body, type });
  }

  /**
   * Initializes a BeaconCohortAggregatedNonceMessage from a given AggregatedNonce object.
   * @param {CohortAggregatedNonceMessage} data The data object to initialize the BeaconCohortAggregatedNonceMessage.
   * @returns {BeaconCohortAggregatedNonceMessage} The new BeaconCohortAggregatedNonceMessage.
   */
  public static fromJSON(data: Maybe<CohortAggregatedNonceMessage>): BeaconCohortAggregatedNonceMessage {
    const message = JSON.parse(data);
    if (message.type != BEACON_COHORT_AGGREGATED_NONCE) {
      throw new Error(`Invalid type: ${message.type}`);
    }
    return new BeaconCohortAggregatedNonceMessage(message);
  }
}
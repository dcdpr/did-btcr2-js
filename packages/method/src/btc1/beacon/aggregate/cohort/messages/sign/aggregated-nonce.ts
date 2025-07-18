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
  public cohortId: string;
  public sessionId: string;
  public aggregatedNonce: Uint8Array;

  constructor(aggNonceMessage: CohortAggregatedNonceMessage) {
    super({ ...aggNonceMessage, type: BEACON_COHORT_AGGREGATED_NONCE });
    this.cohortId = aggNonceMessage.cohortId;
    this.sessionId = aggNonceMessage.sessionId;
    this.aggregatedNonce = aggNonceMessage.aggregatedNonce;
  }

  /**
   * Initializes a BeaconCohortAggregatedNonceMessage from a given AggregatedNonce object.
   * @param {CohortAggregatedNonceMessage} data The data object to initialize the BeaconCohortAggregatedNonceMessage.
   * @returns {BeaconCohortAggregatedNonceMessage} The new BeaconCohortAggregatedNonceMessage.
   */
  public static fromJSON(data: Maybe<CohortAggregatedNonceMessage>): BeaconCohortAggregatedNonceMessage {
    if (data.type != BEACON_COHORT_AGGREGATED_NONCE) {
      throw new Error(`Invalid type: ${data.type}`);
    }
    return new BeaconCohortAggregatedNonceMessage(data);
  }
}
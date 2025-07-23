import { Maybe } from '@did-btc1/common';
import { BaseMessage } from '../base.js';
import { BEACON_COHORT_AUTHORIZATION_REQUEST } from '../constants.js';

export interface CohortAuthorizationRequestMessage {
  to: string;
  from: string;
  cohortId: string;
  sessionId: string;
  pendingTx: string;
}

/**
 * Sends the unsigned PSBT that spends the Beacon UTXO (plus any SMT proofs).
 * Asks the cohort to begin a MuSig2 signing session.
 * @class BeaconCohortAuthorizationRequestMessage
 * @extends BaseMessage
 * @type {CohortAuthorizationRequestMessage}
 */
export class BeaconCohortAuthorizationRequestMessage extends BaseMessage {
  constructor({ to, from, cohortId, sessionId, pendingTx }: CohortAuthorizationRequestMessage) {
    const body = { cohortId, sessionId, pendingTx };
    const type = BEACON_COHORT_AUTHORIZATION_REQUEST;
    super({ to, from, body, type });
  }

  /**
   * Initializes a BeaconCohortAuthorizationRequestMessage from a given AuthorizationRequest object.
   * @param {CohortAuthorizationRequestMessage} data The data object to initialize the BeaconCohortAuthorizationRequestMessage.
   * @returns {BeaconCohortAuthorizationRequestMessage} The serialized BeaconCohortAuthorizationRequestMessage.
   */
  public static fromJSON(data: Maybe<CohortAuthorizationRequestMessage>): BeaconCohortAuthorizationRequestMessage {
    if (data.type != BEACON_COHORT_AUTHORIZATION_REQUEST) {
      throw new Error(`Invalid type: ${data.type}`);
    }
    return new BeaconCohortAuthorizationRequestMessage(data);
  }
}
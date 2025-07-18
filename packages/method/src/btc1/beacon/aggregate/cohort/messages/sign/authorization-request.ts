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
  /**
   * The ID of the cohort that this request is for.
   * @type {string}
   */
  public cohortId: string;

  /**
   * The session ID for the signing session.
   * @type {string}
   */
  public sessionId: string;

  /**
   * The pending transaction that is being authorized.
   * @type {string}
   */
  public pendingTx: string;

  constructor(authRequestMessage: CohortAuthorizationRequestMessage) {
    super({ ...authRequestMessage, type: BEACON_COHORT_AUTHORIZATION_REQUEST });
    this.cohortId = authRequestMessage.cohortId;
    this.sessionId = authRequestMessage.sessionId;
    this.pendingTx = authRequestMessage.pendingTx;
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
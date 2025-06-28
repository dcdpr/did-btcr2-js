import { Maybe } from '@did-btc1/common';
import { BaseMessage } from '../base.js';
import { AUTHORIZATION_REQUEST } from '../constants.js';

export type AuthorizationRequest = {
  to: string;
  from: string;
  threadId?: string;
  cohortId: string;
  sessionId: string;
  pendingTx: string;
}

export class AuthorizationRequestMessage extends BaseMessage {
  public cohortId: string;
  public sessionId: string;
  public pendingTx: string;

  constructor({ to, from, threadId, cohortId, sessionId, pendingTx }: AuthorizationRequest) {
    super({ type: AUTHORIZATION_REQUEST, to, from, threadId, body: { cohortId, sessionId, pendingTx } });
    this.cohortId = cohortId;
    this.sessionId = sessionId;
    this.pendingTx = pendingTx;
  }

  /**
   * Initializes an AuthorizationRequestMessage from a given AuthorizationRequest object.
   * @param {AuthorizationRequest} data The AuthorizationRequest object to initialize the AuthorizationRequestMessage.
   * @returns {AuthorizationRequestMessage} The serialized AuthorizationRequestMessage.
   */
  public static fromJSON(data: Maybe<AuthorizationRequest>): AuthorizationRequestMessage {
    if (data.type != AUTHORIZATION_REQUEST) {
      throw new Error(`Invalid type: ${data.type}`);
    }
    return new AuthorizationRequestMessage(data);
  }
}
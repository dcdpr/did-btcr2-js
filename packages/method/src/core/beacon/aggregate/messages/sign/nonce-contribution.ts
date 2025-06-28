import { Maybe } from '@did-btc1/common';
import { BaseMessage } from '../base.js';
import { NONCE_CONTRIBUTION } from '../constants.js';

export type NonceContribution = {
  to: string;
  from: string;
  threadId?: string;
  cohortId: string;
  sessionId: string;
  nonceContribution: Array<string>;
}

export class NonceContributionMessage extends BaseMessage {
  public cohortId: string;
  public sessionId: string;
  public nonceContribution: Array<string>;

  constructor({ to, from, threadId, cohortId, sessionId, nonceContribution }: NonceContribution) {
    super({ type: NONCE_CONTRIBUTION, to, from, threadId, body: { cohortId, sessionId, nonceContribution } });
    this.cohortId = cohortId;
    this.sessionId = sessionId;
    this.nonceContribution = nonceContribution;
  }

  /**
   * Initializes a NonceContributionMessage from a given NonceContribution object.
   * @param {NonceContribution} data The NonceContribution object to initialize the NonceContributionMessage.
   * @returns {NonceContributionMessage} The serialized NonceContributionMessage.
   */
  public static fromJSON(data: Maybe<NonceContribution>): NonceContributionMessage {
    if (data.type != NONCE_CONTRIBUTION) {
      throw new Error(`Invalid type: ${data.type}`);
    }
    return new NonceContributionMessage(data);
  }
}
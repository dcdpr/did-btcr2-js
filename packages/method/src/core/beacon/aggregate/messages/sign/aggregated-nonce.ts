import { Maybe } from '@did-btc1/common';
import { BaseMessage } from '../base.js';
import { AGGREGATED_NONCE } from '../constants.js';

export type AggregatedNonce = {
  to: string;
  from: string;
  threadId?: string;
  cohortId: string;
  sessionId: string;
  aggregatedNonce: string;
}

export class AggregatedNonceMessage extends BaseMessage {
  public cohortId: string;
  public sessionId: string;
  public aggregatedNonce: string;

  constructor({ to, from, threadId, cohortId, sessionId, aggregatedNonce }: AggregatedNonce) {
    super({
      to,
      from,
      threadId : threadId ?? crypto.randomUUID(),
      type     : AGGREGATED_NONCE,
      body     : { cohortId, sessionId, aggregatedNonce }
    });
    this.cohortId = cohortId;
    this.sessionId = sessionId;
    this.aggregatedNonce = aggregatedNonce;
  }

  /**
   * Initializes an AggregatedNonceMessage from a given AggregatedNonce object.
   * @param {AggregatedNonce} data The AggregatedNonce object to initialize the AggregatedNonceMessage.
   * @returns {AggregatedNonceMessage} The serialized AggregatedNonceMessage.
   */
  public static fromJSON(data: Maybe<AggregatedNonce>): AggregatedNonceMessage {
    if (data.type != AGGREGATED_NONCE) {
      throw new Error(`Invalid type: ${data.type}`);
    }
    return new AggregatedNonceMessage(data);
  }
}
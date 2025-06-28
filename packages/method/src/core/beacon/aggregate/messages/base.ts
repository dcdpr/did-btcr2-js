import { Maybe } from '@did-btcr2/common';

export const MESSAGE_PREFIX = 'https://btcr2.tools/';

export type BaseBody = {
  cohortId: string;
  cohortSize?: number;
  network?: string;
  participantPk?: Uint8Array;
  beaconAddress?: string;
  cohortKeys?: Array<Uint8Array>;
  sessionId?: string;
  aggregatedNonce?: Array<string>;
  nonceContribution?: Array<string>;
  partialSignature?: number;
  pendingTx?: string;
  data?: string;
};

export type Base = {
  type: string;
  to: string;
  from: string;
  threadId?: string;
  body?: BaseBody;
};

export class BaseMessage {
  public type: string;
  public to: string;
  public from: string;
  public threadId?: string;
  public body?: BaseBody;

  constructor({ type, to, from, threadId, body }: Base) {
    this.type = type;
    this.to = to;
    this.from = from;
    this.threadId = threadId;
    this.body = body;
  }

  /**
   * Creates a BaseMessage from a JSON object.
   * @param {Maybe<Base>} data The JSON object to initialize the BaseMessage.
   * @returns {BaseMessage} The initialized BaseMessage.
   */
  public static fromJSON(data: Maybe<Base>): BaseMessage {
    return new BaseMessage(data);
  }

  /**
   * Converts a BaseMessage to a JSON object.
   * @returns {Base} The JSON representation of the BaseMessage.
   */
  public json(): Base {
    return {
      type     : this.type,
      to       : this.to,
      from     : this.from,
      threadId : this.threadId,
      body     : this.body
    };
  }
}
import { Maybe } from '@did-btcr2/common';
import { BaseMessage } from './base.js';
import { OPT_IN } from './keygen.js';

export type OptIn = {
  type: typeof OPT_IN;
  to: string;
  from: string;
  cohortId: string;
  participantPk: Uint8Array;
  threadId?: string;
}

export class OptInMessage extends BaseMessage {
  public cohortId: string;
  public participantPk: Uint8Array;

  constructor({ type = OPT_IN, to, from, threadId, cohortId, participantPk }: OptIn) {
    super({ type, to, from, threadId, body: { cohortId, participantPk }});
    this.cohortId = cohortId;
    this.participantPk = participantPk;
  }

  /**
   * Initializes an OptInMessage from a given OptIn object.
   * @param {OptIn} data - The OptIn object to initialize the OptInMessage.
   * @returns {object} The serialized OptInMessage.
   */
  public static fromJSON(data: Maybe<OptIn>): OptInMessage {
    if (data.type != 'OPT_IN') {
      throw new Error(`Invalid type: ${data.type}`);
    }
    return new OptInMessage(data);
  }
}
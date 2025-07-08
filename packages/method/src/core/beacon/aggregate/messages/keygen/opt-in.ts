<<<<<<<< HEAD:packages/method/src/core/beacon/aggregate/messages/opt-in.ts
import { Maybe } from '@did-btcr2/common';
import { BaseMessage } from './base.js';
import { OPT_IN } from './keygen.js';
========
import { Maybe } from '@did-btc1/common';
import { BaseMessage } from '../base.js';
import { OPT_IN } from '../constants.js';
>>>>>>>> 336422f (add messages; continue coordinator):packages/method/src/core/beacon/aggregate/messages/keygen/opt-in.ts

export type OptIn = {
  to: string;
  from: string;
  cohortId: string;
  participantPk: Uint8Array;
  threadId?: string;
}

export class OptInMessage extends BaseMessage {
  public cohortId: string;
  public participantPk: Uint8Array;

  constructor({ to, from, threadId, cohortId, participantPk }: OptIn) {
    super({
      to,
      from,
      type     : OPT_IN,
      threadId : threadId ?? crypto.randomUUID(),
      body     : { cohortId, participantPk }
    });
    this.cohortId = cohortId;
    this.participantPk = participantPk;
  }

  /**
   * Initializes an OptInMessage from a given OptIn object.
   * @param {OptIn} data The OptIn object to initialize the OptInMessage.
   * @returns {OptInMessage} The serialized OptInMessage.
   */
  public static fromJSON(data: Maybe<OptIn>): OptInMessage {
    if (data.type != OPT_IN) {
      throw new Error(`Invalid type: ${data.type}`);
    }
    return new OptInMessage(data);
  }
}
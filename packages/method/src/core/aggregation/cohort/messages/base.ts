export const MESSAGE_PREFIX = 'https://btcr2.tools/';

export type BaseBody = {
  cohortId: string;
  cohortSize?: number;
  network?: string;
  participantPk?: Uint8Array;
  beaconAddress?: string;
  cohortKeys?: Array<Uint8Array>;
  sessionId?: string;
  aggregatedNonce?: Uint8Array;
  nonceContribution?: Uint8Array;
  partialSignature?: Uint8Array;
  pendingTx?: string;
  beaconType?: string;
  data?: string;
  signedUpdate?: Record<string, unknown>;
  casAnnouncement?: Record<string, string>;
  smtProof?: Record<string, unknown>;
  signalBytesHex?: string;
  approved?: boolean;
};

export type Base = {
  type: string;
  to?: string;
  from: string;
  body?: BaseBody;
};

export class BaseMessage {
  public type: string;
  public to?: string;
  public from: string;
  public body?: BaseBody;

  constructor({ type, to, from, body }: Base) {
    this.type = type;
    this.to = to;
    this.from = from;
    this.body = body;
  }

  /**
   * Converts a BaseMessage to a JSON object.
   * @returns {Base} The JSON representation of the BaseMessage.
   */
  public toJSON(): Base {
    return {
      type : this.type,
      to   : this.to,
      from : this.from,
      body : this.body
    };
  }
}
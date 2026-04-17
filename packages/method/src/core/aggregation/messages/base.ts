/**
 * Current on-the-wire protocol version.
 *
 * Receivers reject messages with an unknown (mismatched) version. Bumping this
 * requires coordinated updates across all participants and any intermediate
 * relays that inspect message content.
 */
export const AGGREGATION_WIRE_VERSION = 1;

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
  /** Hex-encoded scriptPubKey of the UTXO being spent. Required for BIP-341 sighash. */
  prevOutScriptHex?: string;
  prevOutValue?: string;
  communicationPk?: Uint8Array;
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
  version?: number;
  to?: string;
  from: string;
  body?: BaseBody;
};

export class BaseMessage {
  public type: string;
  public version: number;
  public to?: string;
  public from: string;
  public body?: BaseBody;

  constructor({ type, version, to, from, body }: Base) {
    this.type = type;
    this.version = version ?? AGGREGATION_WIRE_VERSION;
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
      type    : this.type,
      version : this.version,
      to      : this.to,
      from    : this.from,
      body    : this.body
    };
  }
}

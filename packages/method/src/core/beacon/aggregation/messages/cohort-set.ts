import { BaseMessage } from './base.js';
import { COHORT_SET } from './keygen.js';

export type CohortSet = {
  type?: typeof COHORT_SET;
  to: string;
  from: string;
  cohortId: string;
  beaconAddress: string;
  cohortKeys: Array<Uint8Array>;
  threadId?: string;
}

export class CohortSetMessage extends BaseMessage {
  public cohortId: string;
  public beaconAddress: string;
  public cohortKeys: Array<Uint8Array>;

  constructor({ type = COHORT_SET, to, from, threadId, cohortId, beaconAddress, cohortKeys }: CohortSet) {
    super({ type, to, from, threadId, body: { cohortId, beaconAddress, cohortKeys }});
    this.cohortId = cohortId;
    this.beaconAddress = beaconAddress;
    this.cohortKeys = cohortKeys;
  }

  /**
   * Initializes an CohortSetMessage from a given OptIn object.
   * @param {OptIn} data - The OptIn object to initialize the CohortSetMessage.
   * @returns {object} The serialized CohortSetMessage.
   */
  public static fromJSON(data: CohortSet): CohortSetMessage {
    if (data.type !== COHORT_SET) {
      throw new Error(`Invalid type: ${data.type}`);
    }
    return new CohortSetMessage(data);
  }
}
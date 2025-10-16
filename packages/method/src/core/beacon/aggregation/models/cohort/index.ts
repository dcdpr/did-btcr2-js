import { TapRootMultiSig } from '@did-btcr2/bitcoin';
import { COHORT_STATUS, COHORT_STATUS_TYPE } from './status.js';

export type Musig2CohortParams = {
    id?: string;
    minParticipants: number;
    status: COHORT_STATUS_TYPE;
    network: string;
    coordinatorDid: string;
}

export class Musig2Cohort {
  /**
   * Unique identifier for the cohort.
   * @type {string}
   */
  public id: string;

  /**
   * DID of the coordinator.
   * @type {string}
   */
  public coordinatorDid: string;

  /**
   * Minimum number of participants required to finalize the cohort.
   * @type {number}
   */
  public minParticipants: number;

  /**
   * Status of the cohort.
   * @type {string}
   */
  public status: COHORT_STATUS_TYPE;

  /**
   * Network on which the cohort operates (e.g., 'mainnet', 'testnet').
   * @type {string}
   */
  public network: string;

  /**
   * Pending signature requests, mapping participant DIDs to their pending signatures.
   * @type {Record<string, string>}
   */
  public pendingSignatureRequests: Record<string, string> = {};

  /**
   * List of participant DIDs.
   * @type {Array<string>}
   */
  public participants: Array<string> = new Array<string>();

  /**
   * List of cohort keys (public keys).
   * @type {Array<Uint8Array>}
   */
  public cohortKeys: Array<Uint8Array> = new Array<Uint8Array>();

  /**
   * Taproot Merkle root for the cohort.
   * @type {Uint8Array}
   */
  public trMerkleRoot?: Uint8Array;

  /**
   * Beacon address for the cohort, calculated from the Taproot multisig.
   * @type {string}
   */
  public beaconAddress?: string;

  /**
   * Creates a new Musig2Cohort instance.
   * @param {Musig2CohortParams} params Parameters for initializing the cohort.
   * @param {string} [params.id] Optional unique identifier for the cohort. If not provided, a random UUID will be generated.
   * @param {number} params.minParticipants Minimum number of participants required to finalize the cohort.
   * @param {string} params.coordinatorDid DID of the coordinator managing the cohort.
   * @param {string} params.status Initial status of the cohort (e.g., 'PENDING', 'COHORT_SET').
   * @param {string} params.network Network on which the cohort operates (e.g., 'mainnet', 'testnet').
   */
  constructor(params: Musig2CohortParams) {
    this.id = params.id || crypto.randomUUID();
    this.minParticipants = params.minParticipants;
    this.coordinatorDid = params.coordinatorDid;
    this.status = params.status as COHORT_STATUS_TYPE || COHORT_STATUS.COHORT_ADVERTISED;
    this.network = params.network;
  }

  public finalize(): void {
    if(this.participants.length < this.minParticipants) {
      throw new Error('Not enough participants to finalize the cohort');
    }
    this.status = COHORT_STATUS.COHORT_SET_STATUS;
    this.beaconAddress = this.calulateBeaconAddress();
  }

  /**
   * Calculates the beacon Taproot multisig address for the cohort using participant keys.
   * @returns {string} The Taproot address for the cohort.
   * @throws {Error} If the Taproot address cannot be calculated.
   */
  public calulateBeaconAddress(): string {
    const trMultisig = new TapRootMultiSig(this.cohortKeys, this.cohortKeys.length);
    const branch = trMultisig.musigTree();
    this.trMerkleRoot = branch.hash;
    if(!branch.address) {
      throw new Error('Failed to calculate Taproot address');
    }
    return branch.address;
  }
}
import { keyAggExport, keyAggregate, sortKeys } from '@scure/btc-signer/musig2';
import { payments, Transaction } from 'bitcoinjs-lib';
import { BeaconCoordinatorError } from '../../error.js';
import { BeaconCohortSigningSession } from '../session/index.js';
import { BeaconCohortReadyMessage } from './messages/keygen/cohort-ready.js';
import { BeaconCohortRequestSignatureMessage } from './messages/sign/request-signature.js';
import { COHORT_STATUS, COHORT_STATUS_TYPE } from './status.js';

export type Musig2CohortObject = {
    id?: string;
    coordinatorDid?: string;
    minParticipants?: number;
    status?: COHORT_STATUS_TYPE;
    network: string;
    beaconType?: string;
}

export interface BeaconCohort {
  id?: string;
  coordinatorDid: string;
  minParticipants: number;
  status: COHORT_STATUS_TYPE;
  network: string;
  pendingSignatureRequests?: Record<string, string>;
  participants?: Array<string>;
  cohortKeys?: Array<Uint8Array>;
  trMerkleRoot?: Uint8Array;
  beaconAddress?: string;
}

export class AggregateBeaconCohort implements BeaconCohort {
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
   * List of cohort keys.
   * @type {Array<Uint8Array>}
   */
  public _cohortKeys: Array<Uint8Array> = new Array<Uint8Array>();

  /**
   * Taproot Merkle root for the cohort.
   * @type {Uint8Array}
   */
  public trMerkleRoot: Uint8Array = new Uint8Array();

  /**
   * Beacon address for the cohort, calculated from the Taproot multisig.
   * @type {string}
   */
  public beaconAddress: string = '';

  /**
   * Type of beacon used in the cohort (default is 'SMTAggregateBeacon').
   * @type {string}
   */
  public beaconType: string;

  /**
   * Creates a new Musig2Cohort instance.
   * @param {Musig2CohortObject} params Parameters for initializing the cohort.
   * @param {string} [params.id] Optional unique identifier for the cohort. If not provided, a random UUID will be generated.
   * @param {number} params.minParticipants Minimum number of participants required to finalize the cohort.
   * @param {string} [params.coordinatorDid] DID of the coordinator managing the cohort.
   * @param {string} params.status Initial status of the cohort (e.g., 'PENDING', 'COHORT_SET').
   * @param {string} params.network Network on which the cohort operates (e.g., 'mainnet', 'testnet').
   */
  constructor({ id, minParticipants, coordinatorDid, status, network, beaconType }: Musig2CohortObject) {
    this.id = id || crypto.randomUUID();
    this.minParticipants = minParticipants || 2;
    this.coordinatorDid = coordinatorDid || '';
    this.status = status as COHORT_STATUS_TYPE || COHORT_STATUS.COHORT_ADVERTISED;
    this.network = network;
    this.beaconType = beaconType || 'SMTAggregateBeacon';
  }

  set cohortKeys(keys: Array<Uint8Array>) {
    this.cohortKeys = sortKeys(keys);
  }

  public validateCohort(participantKeys: Array<string>, cohortKeys: Array<string>, beaconAddress: string): void {
    for(const key of participantKeys){
      if(!cohortKeys.includes(key)) {
        this.status = COHORT_STATUS.COHORT_FAILED;
        throw new BeaconCoordinatorError(
          `Participant key ${key} not found in cohort ${this.id}.`,
          'COHORT_VALIDATION_ERROR',
          {
            cohortId        : this.id,
            participantKeys : participantKeys,
            cohortKeys      : cohortKeys,
            beaconAddress   : beaconAddress
          }
        );
      }
    }
    this.cohortKeys = cohortKeys.map(key => Buffer.from(key, 'hex'));
    const calculatedAddress = this.calulateBeaconAddress();
    if (calculatedAddress !== beaconAddress) {
      this.status = COHORT_STATUS.COHORT_FAILED;
      throw new BeaconCoordinatorError(
        `Calculated beacon address ${calculatedAddress} does not match provided address ${beaconAddress}.`,
        'COHORT_ADDRESS_MISMATCH_ERROR',
        {
          cohortId        : this.id,
          calculatedAddress,
          providedAddress : beaconAddress
        }
      );
    }
    this.beaconAddress = beaconAddress;
    this.status = COHORT_STATUS.COHORT_SET_STATUS;
  }

  /**
   * Finalizes the cohort by checking if the minimum number of participants is met.
   * If the minimum is met, it sets the status to 'COHORT_SET_STATUS' and calculates the beacon address.
   * @throws {BeaconCoordinatorError} If the number of participants is less than the minimum required.
   * @returns {void}
   */
  public finalize(): void {
    if(this.participants.length < this.minParticipants) {
      throw new BeaconCoordinatorError(
        'Not enough participants to finalize the cohort',
        'FINALIZE_COHORT_ERROR',
        {
          cohortId        : this.id,
          participants    : this.participants,
          minParticipants : this.minParticipants
        }
      );
    }
    this.status = COHORT_STATUS.COHORT_SET_STATUS;
    this.beaconAddress = this.calulateBeaconAddress();
  }

  /**
   * Calculates the beacon Taproot multisig address for the cohort using participant keys.
   * @returns {string} The Taproot address for the cohort.
   * @throws {BeaconCoordinatorError} If the Taproot address cannot be calculated.
   */
  public calulateBeaconAddress(): string {
    const keyAggContext = keyAggregate(this.cohortKeys);
    const aggPubkey = keyAggExport(keyAggContext);
    const payment = payments.p2tr({ internalPubkey: aggPubkey });
    if(!payment.hash) {
      throw new BeaconCoordinatorError(
        'Failed to calculate Taproot Merkle root',
        'CALCULATE_BEACON_MERKLE_ROOT_ERROR',
        {
          cohortId        : this.id,
          cohortKeys      : this.cohortKeys,
          minParticipants : this.minParticipants
        }
      );
    }
    this.trMerkleRoot = payment.hash;
    if(!payment.address) {
      throw new BeaconCoordinatorError(
        'Failed to calculate Taproot address',
        'CALCULATE_BEACON_ADDRESS_ERROR',
        {
          cohortId        : this.id,
          cohortKeys      : this.cohortKeys,
          minParticipants : this.minParticipants
        }
      );
    }
    return payment.address;
  }

  /**
   * Generates a CohortReadyMessage to be sent to participants when the cohort is set.
   * @param {string} to The DID of the participant to whom the message is sent.
   * @param {string} from The DID of the coordinator sending the message.
   * @returns {BeaconCohortReadyMessage} The CohortReadyMessage containing the cohort details.
   */
  public getCohortReadyMessage(to: string, from: string): BeaconCohortReadyMessage {
    if(this.status !== COHORT_STATUS.COHORT_SET_STATUS) {
      throw new BeaconCoordinatorError('Cohort status not "COHORT_SET".');
    }
    return new BeaconCohortReadyMessage({
      to,
      from,
      cohortId      : this.id,
      beaconAddress : this.beaconAddress,
      cohortKeys    : this.cohortKeys,
    });
  }

  /**
   * Adds a signature request to the pending requests for the cohort.
   * @param {BeaconCohortRequestSignatureMessage} message The signature request message to add.
   * @throws {Error} If a signature request from the same participant already exists.
   */
  public addSignatureRequest(message: BeaconCohortRequestSignatureMessage): void {
    if(!this.validateSignatureRequest(message)) {
      throw new BeaconCoordinatorError(`No signature request from ${message.from} in cohort ${this.id}.`);
    }

    if(!message.body?.data) {
      throw new BeaconCoordinatorError(`No signature data in request from ${message.from} in cohort ${this.id}.`);
    }

    this.pendingSignatureRequests[message.from] = message.body.data;
  }

  /**
   * Validates a signature request message to ensure it is from a participant in the cohort.
   * @param {BeaconCohortRequestSignatureMessage} message The signature request message to validate.
   * @returns {boolean} True if the message is valid, false otherwise.
   */
  public validateSignatureRequest(message: BeaconCohortRequestSignatureMessage): boolean {
    const cohortId = message.body?.cohortId;
    if(cohortId !== this.id) {
      console.info(`Signature request for wrong cohort: ${cohortId}.`);
      return false;
    }

    if(!this.participants.includes(message.from)) {
      console.info(`Participant ${message.from} not in cohort ${this.id}.`);
      return false;
    }

    return true;
  }

  /**
   * Starts a signing session for the cohort.
   * @returns {BeaconCohortSigningSession} The request signature message for the signing session.
   */
  public startSigningSession(): BeaconCohortSigningSession {
    console.debug(`Starting signing session for cohort ${this.id} with status ${this.status}`);
    if(this.status !== COHORT_STATUS.COHORT_SET_STATUS) {
      throw new BeaconCoordinatorError(`Cohort ${this.id} is not set.`);
    }
    // const smtRootBytes = new Uint8Array(32).map(() => Math.floor(Math.random() * 256));
    const cohort = new AggregateBeaconCohort(this);
    return new BeaconCohortSigningSession({
      cohort,
      pendingTx         : new Transaction(),
      processedRequests : this.pendingSignatureRequests,
    });
  }

  /**
   * Converts the cohort instance to a JSON object representation.
   * @returns {BeaconCohort} The JSON object representation of the cohort.
   */
  public json(): BeaconCohort {
    return Object.json(this) as BeaconCohort;
  }
}
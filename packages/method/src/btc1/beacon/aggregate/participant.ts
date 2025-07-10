import { KeyBytes, Logger, Maybe } from '@did-btc1/common';
import { HDKey } from '@scure/bip32';
import { NostrAdapter } from './communication/nostr.js';
import { CommunicationService } from './communication/service.js';
import { AGGREGATED_NONCE, AUTHORIZATION_REQUEST, COHORT_ADVERT, COHORT_SET, OPT_IN, SUBSCRIBE_ACCEPT } from './messages/constants.js';
import { CohortAdvertMessage } from './messages/keygen/cohort-advert.js';
import { SubscribeAcceptMessage } from './messages/keygen/subscribe-accept.js';
import { Musig2Cohort } from './models/cohort/index.js';
import { SignatureAuthorizationSession } from './models/session/index.js';
import { OptInMessage } from './messages/keygen/opt-in.js';
import { COHORT_STATUS } from './models/cohort/status.js';
import { CohortSetMessage } from './messages/keygen/cohort-set.js';

export class CohortKeyState {
  public cohortId: string;
  public keyIndex: number;
  public did: string;

  constructor(cohortId: string, keyIndex: number, did: string){
    this.cohortId = cohortId;
    this.keyIndex = keyIndex; // HD wallet key index
    this.did = did;
  }
}

export class BeaconParticipant {
  /**
     * The name of the BeaconParticipant service.
     * @type {string}
     */
  public name: string;

  /**
     * The DID of the BeaconParticipant.
     * @type {Array<string>}
     */
  public did: string;

  /**
     * The communication protocol used by the BeaconParticipant.
     * @type {CommunicationService}
     */
  public protocol: CommunicationService;

  /**
   * The HD key used by the BeaconParticipant.
   * @type {HDKey}
   */
  public hdKey: HDKey;

  public nextBeaconKeyIndex: number = 0;
  public coordinatorDids: Array<string> = new Array<string>();
  public cohorts: Array<Musig2Cohort> = new Array<Musig2Cohort>();
  public cohortKeyState: Map<string, CohortKeyState> = new Map<string, CohortKeyState>();
  public activeSigningSessions: Map<string, SignatureAuthorizationSession> = new Map<string, SignatureAuthorizationSession>();

  /**
   * Creates an instance of BeaconParticipant.
   * @param {KeyBytes} sk The secret key used for signing.
   * @param {CommunicationService} protocol The communication protocol used by the participant.
   * @param {string} [name] The name of the participant.
   * @param {string} [did] The decentralized identifier (DID) of the participant.
   */
  constructor(sk: KeyBytes, protocol: CommunicationService, name?: string, did?: string) {
    this.hdKey = HDKey.fromMasterSeed(sk);
    this.name = name || 'BeaconParticipant';
    this.protocol = protocol || new NostrAdapter();
    this.did = did || this.protocol.generateIdentity();
  }

  /**
   * Starts the participant by registering message handlers for various message types.
   * @returns {void}
   */
  public start(): void {
    Logger.info(`Starting BeaconParticipant (${this.did}) on ${this.protocol.name}!`);
    this.protocol.registerMessageHandler(SUBSCRIBE_ACCEPT, this._handleSubscribeAccept.bind(this));
    this.protocol.registerMessageHandler(COHORT_ADVERT, this._handleCohortAdvert.bind(this));
    this.protocol.registerMessageHandler(COHORT_SET, this._handleCohortSet.bind(this));
    this.protocol.registerMessageHandler(AUTHORIZATION_REQUEST, this._handleAuthorizationRequest.bind(this));
    this.protocol.registerMessageHandler(AGGREGATED_NONCE, this._handleAggregatedNonce.bind(this));
    this.protocol.start();
    Logger.info(`Started BeaconParticipant (${this.did}) on ${this.protocol.name}, listening for messages ...`);
  }

  /**
   * Handle subscription acceptance from a coordinator.
   * @param {SubscribeAcceptMessage} message The message containing the subscription acceptance.
   * @returns {Promise<void>}
   */
  private async _handleSubscribeAccept(message: Maybe<SubscribeAcceptMessage>): Promise<void> {
    const subscribeAcceptMessage = SubscribeAcceptMessage.fromJSON(message);
    const coordinatorDid = subscribeAcceptMessage.from;
    if (!this.coordinatorDids.includes(coordinatorDid)) {
      this.coordinatorDids.push(coordinatorDid);
    }
  }

  /**
   * Handles a cohort advertisement message.
   * @param {Maybe<CohortAdvertMessage>} message The cohort advertisement message.
   * @returns {Promise<void>}
   */
  public async _handleCohortAdvert(message: Maybe<CohortAdvertMessage>): Promise<void> {
    const cohortAdvertMessage = CohortAdvertMessage.fromJSON(message);
    Logger.info(`BeaconParticipant ${this.did} received new cohort announcement from ${cohortAdvertMessage.from}.`);
    const cohortId = cohortAdvertMessage.body?.cohortId;
    const network = cohortAdvertMessage.body?.network;
    const minParticipants = cohortAdvertMessage.body?.cohortSize;
    if (!cohortId || !network) {
      Logger.warn(`BeaconParticipant ${this.did} received malformed cohort advert message: ${JSON.stringify(cohortAdvertMessage)}`);
      return;
    }
    const from = cohortAdvertMessage.from;
    if (!this.coordinatorDids.includes(from)) {
      Logger.warn(`BeaconParticipant ${this.did} received unsolicited new cohort announcement from ${from}`);
      return;
    }
    const cohort = new Musig2Cohort({ id: cohortId, minParticipants, network, coordinatorDid: from });
    this.cohorts.push(cohort);
    await this.joinCohort(cohort.id, from);
  }


  public async _handleCohortSet(message: Maybe<CohortSetMessage>) {
    const cohortSetMessage = CohortSetMessage.fromJSON(message);
    const cohortId = cohortSetMessage.cohortId;
    const cohort = this.cohorts.find(c => c.id === cohortId);
    const cohortKeyState = this.cohortKeyState.get(cohortId);
    if (!cohort || !cohortKeyState) {
      Logger.warn(`Cohort with ID ${cohortId} not found or not joined by participant ${this.did}.`);
      return;
    }
  }
  public _handleAuthorizationRequest() {}
  public _handleAggregatedNonce() {}

  /**
   * Joins a cohort with the given ID and coordinator DID.
   * @param {string} cohortId The ID of the cohort to join.
   * @param {string} coordinatorDid The DID of the cohort coordinator.
   * @returns {Promise<void>}
   */
  public async joinCohort(cohortId: string, coordinatorDid: string): Promise<void> {
    Logger.info(`BeaconParticipant ${this.did} joining cohort ${cohortId} with coordinator ${coordinatorDid}`);
    const cohort = this.cohorts.find(c => c.id === cohortId);
    if (!cohort) {
      Logger.warn(`Cohort with ID ${cohortId} not found.`);
      return;
    }
    const index = this.nextBeaconKeyIndex;
    const participantPk = this.hdKey.deriveChild(index).publicKey?.toHex();
    if(!participantPk) {
      Logger.error(`Failed to derive public key for cohort ${cohortId} at index ${index}`);
      return;
    }
    this.cohortKeyState.set(cohortId, new CohortKeyState(cohortId, index, this.did));
    const optInMessage = OptInMessage.fromJSON({
      cohortId,
      participantPk,
      from     : this.did,
      to       : coordinatorDid,
    });

    await this.protocol.sendMessage(optInMessage, coordinatorDid, this.did);
    cohort.status = COHORT_STATUS.COHORT_OPTED_IN;
  }
}
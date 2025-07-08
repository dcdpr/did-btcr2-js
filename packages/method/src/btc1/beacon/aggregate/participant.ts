import { KeyBytes, Logger, Maybe } from '@did-btc1/common';
import { SchnorrKeyPair } from '@did-btc1/keypair';
import { NostrAdapter } from './communication/nostr.js';
import { CommunicationService } from './communication/service.js';
import { AGGREGATED_NONCE, AUTHORIZATION_REQUEST, COHORT_ADVERT, COHORT_SET, SUBSCRIBE_ACCEPT } from './messages/constants.js';
import { CohortAdvertMessage } from './messages/keygen/cohort-advert.js';
import { SubscribeAcceptMessage } from './messages/keygen/subscribe-accept.js';
import { Musig2Cohort } from './models/cohort/index.js';
import { SignatureAuthorizationSession } from './models/session/index.js';

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
     * The name of the BeaconCoordinator service.
     * @type {string}
     */
  public name: string;

  /**
     * The DID of the BeaconCoordinator.
     * @type {Array<string>}
     */
  public did: string;

  /**
     * The communication protocol used by the BeaconCoordinator.
     * @type {CommunicationService}
     */
  public protocol: CommunicationService;

  /**
   * The keys used by the BeaconCoordinator.
   * @type {SchnorrKeyPair}
   */
  public keys: SchnorrKeyPair;

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
    this.keys = new SchnorrKeyPair(sk);
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
  private async _handleSubscribeAccept(message: Maybe<SubscribeAcceptMessage>): void {
    const subscribeAcceptMessage = SubscribeAcceptMessage.fromJSON(message);
    const coordinatorDid = subscribeAcceptMessage.from;
    if (!this.coordinatorDids.includes(coordinatorDid)) {
      this.coordinatorDids.push(coordinatorDid);
    }
  }

  public _handleCohortAdvert(message: Maybe<CohortAdvertMessage>): void {
    const cohortAdvertMessage = CohortAdvertMessage.fromJSON(message);
    Logger.info(`BeaconParticipant ${this.did} received new cohort announcement from ${cohortAdvertMessage.from}.`);
  }
  public _handleCohortSet() {}
  public _handleAuthorizationRequest() {}
  public _handleAggregatedNonce() {}
}
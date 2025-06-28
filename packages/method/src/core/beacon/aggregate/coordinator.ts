import { Base, BaseMessage } from './messages/base.js';
import { OptInMessage } from './messages/opt-in.js';
import { OPT_IN, SUBSCRIBE, SUBSCRIBE_ACCEPT } from './messages/keygen.js';
import { Musig2Cohort } from './models/cohort/index.js';
import { NostrAdapter } from './communication/nostr.js';
import { ProtocolService } from './communication/service.js';
import { NONCE_CONTRIBUTION, REQUEST_SIGNATURE, SIGNATURE_AUTHORIZATION } from './messages/constants.js';
import { Logger, Maybe } from '@did-btc1/common';
import { RequestSignature, RequestSignatureMessage } from './messages/sign/request-signature.js';

/**
 * The BeaconCoordinator class is responsible for managing the coordination of beacon aggregation.
 * @class BeaconCoordinator
 * @type {BeaconCoordinator}
 */
export class BeaconCoordinator {
  /**
   * The name of the BeaconCoordinator service.
   * @type {string}
   */
  public name: string = 'BeaconCoordinator';

  /**
   * The DID of the BeaconCoordinator.
   * @type {Array<string>}
   */
  public did: string = '';

  /**
   * The protocol service used for communication.
   * @type {ProtocolService}
   */
  public protocol: ProtocolService;

  /**
   * List of subscribers to the BeaconCoordinator service.
   * @type {Array<string>}
   */
  public cohorts: Array<Musig2Cohort> = [];

  /**
   * List of subscribers to the BeaconCoordinator service.
   * @type {Array<string>}
   */
  private subscribers: string[] = [];

  /**
   * Constructs a new BeaconCoordinator instance.
   * @param {ProtocolService} protocol The protocol service used for communication.
   * @param {string} [did] Optional DID to use for the coordinator. If not provided, a new DID will be generated.
   */

  constructor(protocol: ProtocolService, did?: string) {
    this.protocol = protocol ?? new NostrAdapter();
    this.setup(did);
  }

  /**
   * Sets up the BeaconCoordinator by registering message handlers and optionally generating a DID.
   * @returns {void}
   */
  public setup(did?: string): void {
    this.did = did || this.protocol.generateIdentity();
    this.protocol.registerMessageHandler(SUBSCRIBE, this._handleSubscribe.bind(this));
    this.protocol.registerMessageHandler(OPT_IN, this._handleOptIn.bind(this));
    this.protocol.registerMessageHandler(REQUEST_SIGNATURE, this._handleRequestSignature.bind(this));
    this.protocol.registerMessageHandler(NONCE_CONTRIBUTION, this._handleNonceContribution.bind(this));
    this.protocol.registerMessageHandler(SIGNATURE_AUTHORIZATION, this._handleSignatureAuthorization.bind(this));
    Logger.info(`BeaconCoordinator initialized with DID: ${this.did}. Run .start() to listen for messages.`);
  }

  /**
   * Initializes the BeaconCoordinator by setting up the protocol and starting it.
   */
  async start(): Promise<void> {
    Logger.info(`Starting BeaconCoordinator ...`);
    await this.protocol.start();
  }

  /**
   * Handles subscription requests from other participants.
   * @param {BaseMessage} message The message containing the subscription request.
   * @returns {Promise<void>}
   */
  private async _handleSubscribe(message: BaseMessage): Promise<void> {
    const sender = message.from;
    if (!this.subscribers.includes(sender)) {
      this.subscribers.push(sender);
      await this.acceptSubscription(sender);
    }
  }

  /**
   * Handles opt-in requests from participants to join a cohort.
   * @param {OptInMessage} message The message containing the opt-in request.
   * @returns {Promise<void>}
   */
  private async _handleOptIn(message: OptInMessage): Promise<void> {
    const optIn = OptInMessage.fromJSON(message);
    const cohortId = optIn.cohortId;
    const participant = optIn.from;
    const participantPk = optIn.participantPk;
    const cohort = this.cohorts.find(c => c.id === cohortId);
    if (cohort && !cohort.participants.includes(participant)) {
      cohort.participants.push(participant);
      cohort.cohortKeys.push(participantPk);
      await this.acceptSubscription(participant);
      // If the cohort has enough participants, start the key generation process.
      if (cohort.participants.length >= cohort.minParticipants) {
        await this._startKeyGeneration(cohort);
      }
    }
  }
\
/**
 * Handles request signature messages from participants.
 * @param {RequestSignatureMessage} message The message containing the request signature.
 * @returns {Promise<void>}
 */
  private async _handleRequestSignature(message: RequestSignatureMessage): Promise<void> {
    const signatureRequest = RequestSignatureMessage.fromJSON(message);
    const cohort = this.cohorts.find(c => c.id === signatureRequest.cohortId);
    if (!cohort) {
      Logger.error(`Cohort with ID ${signatureRequest.cohortId} not found.`);
      return;
    }
    cohort.addSignatureRequest(signatureRequest);
  }

  private async _handleNonceContribution(message: any): Promise<void> {}

  private async _handleSignatureAuthorization(message: any): Promise<void> {}

  /**
   * Starts the key generation process for a cohort once it has enough participants.
   * @param {Musig2Cohort} cohort The cohort for which to start key generation.
   * @returns {Promise<void>}
   */
  private async _startKeyGeneration(cohort: Musig2Cohort): Promise<void> {
    Logger.info(`Starting key generation for cohort ${cohort.id} with participants: ${cohort.participants.join(', ')}`);
    cohort.finalize();
    for(const participant of cohort.participants) {
      const message = cohort.getCohortSetMessage(participant, this.did);
      Logger.info(`Sending COHORT_SET message to ${participant}`);
      await this.protocol.sendMessage(message, participant, this.did);
    }
    Logger.info(`Finished sending COHORT_SET message to ${cohort.participants.length} participants`);
  }

  /**
   * Accepts a subscription request from a participant.
   * @param {string} sender The DID of the participant requesting the subscription.
   * @returns {Promise<void>}
   */
  public async acceptSubscription(sender: string): Promise<void> {
    Logger.info(`Accepting subscription from ${sender}`);
    const response = {
      type : SUBSCRIBE_ACCEPT,
      to   : sender,
      from : this.did
    };
    await this.protocol.sendMessage(response, sender, this.did);
  }
}

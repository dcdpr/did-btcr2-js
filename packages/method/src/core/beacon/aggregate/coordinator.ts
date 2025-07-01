import { Logger, Maybe } from '@did-btc1/common';
import { BeaconCoordinatorError } from '../error.js';
import { NostrAdapter } from './communication/nostr.js';
import { CommunicationService } from './communication/service.js';
import { BaseMessage } from './messages/base.js';
import { NONCE_CONTRIBUTION, OPT_IN, REQUEST_SIGNATURE, SIGNATURE_AUTHORIZATION, SUBSCRIBE, SUBSCRIBE_ACCEPT } from './messages/constants.js';
import { OptInMessage } from './messages/keygen/opt-in.js';
import { NonceContributionMessage } from './messages/sign/nonce-contribution.js';
import { RequestSignatureMessage } from './messages/sign/request-signature.js';
import { Musig2Cohort } from './models/cohort/index.js';
import { SignatureAuthorizationSession } from './models/session/index.js';
import { SIGNING_SESSION_STATUS } from './models/session/status.js';

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
   * Active signing sessions for the BeaconCoordinator.
   * @type {Record<string, SignatureAuthorizationSession>}
   */
  public activeSigningSessions: Map<string, SignatureAuthorizationSession> = new Map();

  /**
   * Constructs a new BeaconCoordinator instance.
   * @param {CommunicationService} protocol The protocol service used for communication.
   * @param {string} [did] Optional DID to use for the coordinator. If not provided, a new DID will be generated.
   */
  constructor(protocol: CommunicationService, name?: string, did?: string) {
    this.name = name || 'BeaconCoordinator';
    this.protocol = protocol || new NostrAdapter();
    this.did = did || this.protocol.generateIdentity();
    this.setup();
  }

  /**
   * Set up the BeaconCoordinator by registering message handlers.
   * @returns {void}
   */
  public setup(): void {
    this.protocol.registerMessageHandler(SUBSCRIBE, this._handleSubscribe.bind(this));
    this.protocol.registerMessageHandler(OPT_IN, this._handleOptIn.bind(this));
    this.protocol.registerMessageHandler(REQUEST_SIGNATURE, this._handleRequestSignature.bind(this));
    this.protocol.registerMessageHandler(NONCE_CONTRIBUTION, this._handleNonceContribution.bind(this));
    this.protocol.registerMessageHandler(SIGNATURE_AUTHORIZATION, this._handleSignatureAuthorization.bind(this));
    Logger.info(`BeaconCoordinator initialized with DID: ${this.did}. Run .start() to listen for messages.`);
  }

  /**
   * Start the BeaconCoordinator communication protocol.
   */
  async start(): Promise<void> {
    Logger.info(`Starting BeaconCoordinator ${this.name} on ${this.protocol.name} ...`);
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

  /**
   * Handles request signature messages from participants.
   * @private
   * @param {RequestSignatureMessage} message The message containing the request signature.
   * @returns {Promise<void>}
   */
  private async _handleRequestSignature(message: Maybe<RequestSignatureMessage>): Promise<void> {
    const signatureRequest = RequestSignatureMessage.fromJSON(message);
    const cohort = this.cohorts.find(c => c.id === signatureRequest.cohortId);
    if (!cohort) {
      Logger.error(`Cohort with ID ${signatureRequest.cohortId} not found.`);
      return;
    }
    cohort.addSignatureRequest(signatureRequest);
    Logger.info(`Received signature request from ${signatureRequest.from} for cohort ${signatureRequest.cohortId}.`);
  }

  /**
   * Handles nonce contribution messages from participants.
   * @param {NonceContributionMessage} message The message containing the nonce contribution.
   * @returns {Promise<void>}
   */
  private async _handleNonceContribution(message: NonceContributionMessage): Promise<void> {
    // Cast message to NonceContributionMessage type.
    const nonceContribMessage = NonceContributionMessage.fromJSON(message);

    // Get the signing session using the cohort ID from the message.
    const signingSession = this.activeSigningSessions.get(nonceContribMessage.cohortId);

    // If the signing session does not exist, log an error and return.
    if(!signingSession) {
      Logger.error(`Session ${nonceContribMessage.sessionId} not found.`);
      return;
    }

    // If the message.cohortId does not match the signingSession.cohortId, throw an error.
    if(nonceContribMessage.cohortId !== signingSession.cohort.id) {
      throw new BeaconCoordinatorError(
        `Nonce contribution for wrong cohort: ${signingSession.cohort.id} != ${nonceContribMessage.cohortId}`,
        'NONCE_CONTRIBUTION_ERROR', message
      );
    }

    // Add the nonce contribution to the signing session.
    signingSession.addNonceContribution(nonceContribMessage.from, nonceContribMessage.nonceContribution);
    Logger.info(`Nonce contribution received from ${nonceContribMessage.from} for session ${nonceContribMessage.sessionId}.`);

    if (signingSession.nonceContributionsReceived()) {
      await this.sendAggregatedNonce(signingSession);
    }
  }

  /**
   * Sends the aggregated nonce to all participants in the session.
   * @param {SignatureAuthorizationSession} session The session containing the aggregated nonce.
   * @returns {Promise<void>}
   */
  public async sendAggregatedNonce(session: SignatureAuthorizationSession): Promise<void> {
    const aggregatedNonces = session.generateAggregatedNonce();
    session.status = SIGNING_SESSION_STATUS.AWAITING_PARTIAL_SIGNATURES;
  }

  private async _handleSignatureAuthorization(message: any): Promise<void> {
    return message;
  }

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

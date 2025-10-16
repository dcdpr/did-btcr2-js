import { Base } from './messages/base.js';
import { OptInMessage } from './messages/opt-in.js';
import { OPT_IN, SUBSCRIBE, SUBSCRIBE_ACCEPT } from './messages/keygen.js';
import { Musig2Cohort } from './models/cohort/index.js';
import { NostrAdapter } from './protocol/nostr.js';
import { ProtocolService } from './protocol/service.js';
import { NONCE_CONTRIBUTION, REQUEST_SIGNATURE, SIGNATURE_AUTHORIZATION } from './messages/sign.js';

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
    this.protocol.registerMessageHandler(REQUEST_SIGNATURE, this._handleSubscribe.bind(this));
    this.protocol.registerMessageHandler(NONCE_CONTRIBUTION, this._handleSubscribe.bind(this));
    this.protocol.registerMessageHandler(SIGNATURE_AUTHORIZATION, this._handleSubscribe.bind(this));
  }

  /**
   * Initializes the BeaconCoordinator by setting up the protocol and starting it.
   * @param {string} [did] Optional DID to use for the coordinator. If not provided, the existing DID will be used.
   */
  async initialize(did?: string): Promise<void> {
    this.setup(did);
    await this.protocol.start();
  }

  /**
   * Handles subscription requests from other participants.
   * @param {Base} message The message containing the subscription request.
   * @returns {Promise<void>}
   */
  private async _handleSubscribe(message: Base): Promise<void> {
    const sender = message.from;
    if (!this.subscribers.includes(sender)) {
      this.subscribers.push(sender);
      await this.acceptSubscription(sender);
    }
  }

  /**
   * Handles opt-in requests from participants to join a cohort.
   * @param {any} message The message containing the opt-in request.
   * @returns {Promise<void>}
   */
  private async _handleOptIn(message: any): Promise<void> {
    const optIn = OptInMessage.fromJSON(message);
    const cohortId = optIn.cohortId;
    const participant = optIn.from;
    const participantPk = optIn.participantPk;
    const cohort = this.cohorts.find(c => c.id === cohortId);
    if (cohort && !cohort.participants.includes(participant)) {
      cohort.participants.push(participant);
      cohort.cohortKeys.push(participantPk);
      await this.acceptSubscription(participant);
      if (cohort.participants.length >= cohort.minParticipants) {
        await this._startKeyGeneration(cohort);
      }
    }
  }

  /**
   * Starts the key generation process for a cohort once it has enough participants.
   * @param {Musig2Cohort} cohort The cohort for which to start key generation.
   * @returns {Promise<void>}
   */
  private async _startKeyGeneration(cohort: Musig2Cohort): Promise<void> {
    cohort.finalize();
  }

  /**
   * Accepts a subscription request from a participant.
   * @param {string} sender The DID of the participant requesting the subscription.
   * @returns {Promise<void>}
   */
  public async acceptSubscription(sender: string): Promise<void> {
    console.log(`Accepting subscription from ${sender}`);
    const response = {
      type : SUBSCRIBE_ACCEPT,
      to   : sender,
      from : this.did
    };
    await this.protocol.sendMessage(response, sender, this.did);
  }
}

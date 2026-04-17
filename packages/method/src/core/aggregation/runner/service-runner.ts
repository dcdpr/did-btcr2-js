import type { SchnorrKeyPair } from '@did-btcr2/keypair';
import type { BaseMessage } from '../messages/base.js';
import {
  COHORT_OPT_IN,
  NONCE_CONTRIBUTION,
  SIGNATURE_AUTHORIZATION,
  SUBMIT_UPDATE,
  VALIDATION_ACK,
} from '../messages/constants.js';
import { ServiceCohortPhase } from '../phases.js';
import type {
  AggregationResult,
  CohortConfig,
  PendingOptIn,
  SigningTxData} from '../service.js';
import {
  AggregationService
} from '../service.js';
import type { Transport } from '../transport/transport.js';
import type { AggregationServiceEvents } from './events.js';
import { TypedEventEmitter } from './typed-emitter.js';

/** Decision callback: accept or reject a participant's opt-in. */
export type OnOptInReceived = (optIn: PendingOptIn) => Promise<{ accepted: boolean }>;

/** Decision callback: finalize keygen now, or wait for more participants. */
export type OnReadyToFinalize = (info: {
  acceptedCount: number;
  minRequired: number;
}) => Promise<{ finalize: boolean }>;

/** Data callback: provide the Bitcoin transaction data to sign. */
export type OnProvideTxData = (info: {
  cohortId: string;
  beaconAddress: string;
  signalBytes: Uint8Array;
}) => Promise<SigningTxData>;

export interface AggregationServiceRunnerOptions {
  /** Underlying transport (NostrTransport, MockTransport, etc.). */
  transport: Transport;

  /** This service's identity. */
  did: string;
  keys: SchnorrKeyPair;

  /** Cohort configuration. */
  config: CohortConfig;

  /**
   * Decide whether to accept a participant's opt-in.
   * Default: auto-accept all opt-ins.
   */
  onOptInReceived?: OnOptInReceived;

  /**
   * Decide whether to finalize keygen now or wait for more participants.
   * Called after each accepted opt-in once minParticipants is reached.
   * Default: finalize as soon as minParticipants is reached.
   */
  onReadyToFinalize?: OnReadyToFinalize;

  /**
   * Provide the Bitcoin transaction data to sign.
   * REQUIRED — no sensible default.
   */
  onProvideTxData: OnProvideTxData;
}

/**
 * High-level facade for running an Aggregation Service over a Transport.
 *
 * Wires the {@link AggregationService} state machine to a {@link Transport},
 * encapsulating message handler registration, outgoing message dispatch,
 * and decision callback orchestration.
 *
 * @example
 * ```typescript
 * const transport = new NostrTransport({ relays: [RELAY] });
 * transport.registerActor(serviceDid, serviceKeys);
 *
 * const runner = new AggregationServiceRunner({
 *   transport,
 *   did: serviceDid,
 *   keys: serviceKeys,
 *   config: { minParticipants: 2, network: 'mutinynet', beaconType: 'CASBeacon' },
 *   onProvideTxData: async ({ beaconAddress, signalBytes }) => {
 *     return await buildBeaconTransaction(beaconAddress, signalBytes, bitcoin);
 *   },
 * });
 *
 * runner.on('keygen-complete', ({ beaconAddress }) => console.log(beaconAddress));
 * runner.on('signing-complete', ({ signature }) => console.log('done'));
 *
 * const result = await runner.run();
 * ```
 *
 * For full manual control, drop down to the underlying state machine via
 * `runner.session`. The state machine has no transport coupling and exposes
 * every protocol decision as an explicit method.
 *
 * @class AggregationServiceRunner
 */
export class AggregationServiceRunner extends TypedEventEmitter<AggregationServiceEvents> {
  /** Direct access to the underlying state machine for advanced use. */
  readonly session: AggregationService;

  readonly #transport: Transport;
  readonly #did: string;
  readonly #config: CohortConfig;
  readonly #onOptInReceived: OnOptInReceived;
  readonly #onReadyToFinalize: OnReadyToFinalize;
  readonly #onProvideTxData: OnProvideTxData;

  #cohortId?: string;
  #handlersRegistered = false;
  #stopped = false;
  /**
   * Guard against the async race where two concurrent #handleOptIn invocations
   * both pass the `participants.length >= minParticipants` check before either
   * mutates the cohort phase. Set synchronously before any `await` so subsequent
   * handlers observe it on their next resumption.
   */
  #finalizing = false;
  #resolveRun?: (result: AggregationResult) => void;
  #rejectRun?: (err: Error) => void;

  constructor(options: AggregationServiceRunnerOptions) {
    super();
    this.#transport = options.transport;
    this.#did = options.did;
    this.#config = options.config;
    this.#onOptInReceived = options.onOptInReceived ?? (async () => ({ accepted: true }));
    this.#onReadyToFinalize = options.onReadyToFinalize ?? (async ({ acceptedCount, minRequired }) => ({
      finalize : acceptedCount >= minRequired,
    }));
    this.#onProvideTxData = options.onProvideTxData;

    this.session = new AggregationService({ did: options.did, keys: options.keys });
  }

  /**
   * Run the protocol to completion. Resolves with the final aggregation result
   * (signature + signed transaction) once signing is complete.
   *
   * @returns {Promise<AggregationResult>} The final result with signature and signed tx.
   */
  run(): Promise<AggregationResult> {
    return new Promise((resolve, reject) => {
      this.#resolveRun = resolve;
      this.#rejectRun = reject;

      try {
        this.#registerHandlers();
        this.#cohortId = this.session.createCohort(this.#config);
        // Emit cohort-advertised BEFORE the send so the event fires before any downstream cascade
        const advertMsgs = this.session.advertise(this.#cohortId);
        this.emit('cohort-advertised', { cohortId: this.#cohortId });
        this.#sendAll(advertMsgs).catch(err => this.#fail(err));
      } catch(err) {
        this.#fail(err as Error);
      }
    });
  }

  /**
   * Stop the runner early. Cleans up internal state.
   * Note: does not unregister transport handlers (the transport interface
   * does not currently expose unregister).
   */
  stop(): void {
    this.#stopped = true;
  }

  /**
   * Internal: handler registration with the transport. Idempotent.
   */
  #registerHandlers(): void {
    if(this.#handlersRegistered) return;
    this.#handlersRegistered = true;

    this.#transport.registerMessageHandler(this.#did, COHORT_OPT_IN, this.#handleOptIn.bind(this));
    this.#transport.registerMessageHandler(this.#did, SUBMIT_UPDATE, this.#handleSubmitUpdate.bind(this));
    this.#transport.registerMessageHandler(this.#did, VALIDATION_ACK, this.#handleValidationAck.bind(this));
    this.#transport.registerMessageHandler(this.#did, NONCE_CONTRIBUTION, this.#handleNonceContribution.bind(this));
    this.#transport.registerMessageHandler(this.#did, SIGNATURE_AUTHORIZATION, this.#handleSignatureAuthorization.bind(this));
  }

  /**
   * Internal: message handlers for each protocol step. Each handler:
   * 1) feeds the message into the state machine via session.receive()
   * 2) emits a high-level event for external observers
   * 3) checks if the new state triggers any automatic next steps, and if so:
   *    a) calls the appropriate decision callback(s)
   *    b) sends any resulting messages from the state machine
   * @param {BaseMessage} msg - The incoming message to handle.
   * @returns {Promise<void>} Resolves when handling is complete.
    * @throws {Error} If any step of handling fails, the error is emitted and the run promise is rejected.
    * Note: if the runner has been stopped, handlers will ignore incoming messages.
   */
  async #handleOptIn(msg: BaseMessage): Promise<void> {
    if(this.#stopped) return;
    try {
      this.session.receive(msg);

      const optIn = this.session.pendingOptIns(this.#cohortId!).get(msg.from);
      if(!optIn) return;
      this.emit('opt-in-received', optIn);

      // Register peer key for encrypted messaging
      if(optIn.communicationPk) {
        this.#transport.registerPeer(msg.from, optIn.communicationPk);
      }

      const decision = await this.#onOptInReceived(optIn);
      if(!decision.accepted) return;

      await this.#sendAll(this.session.acceptParticipant(this.#cohortId!, msg.from));
      this.emit('participant-accepted', { participantDid: msg.from });

      // Check if it's time to finalize. The `#finalizing` flag is set synchronously
      // before the first await so concurrent opt-in handlers observe it and skip —
      // otherwise two handlers could both pass the minParticipants check and both
      // call finalizeKeygen, the second of which would throw (phase mismatch).
      const cohort = this.session.getCohort(this.#cohortId!)!;
      if(cohort.participants.length >= this.#config.minParticipants && !this.#finalizing) {
        this.#finalizing = true;
        const finalizeDecision = await this.#onReadyToFinalize({
          acceptedCount : cohort.participants.length,
          minRequired   : this.#config.minParticipants,
        });
        if(!finalizeDecision.finalize) {
          // Operator declined — reset the flag so a later opt-in can retry.
          this.#finalizing = false;
          return;
        }
        // finalizeKeygen() computes the beacon address synchronously
        // emit BEFORE awaiting sendAll. Otherwise the downstream cascade
        // (which can run all the way to signing-complete) would resolve the
        // run() promise before this event fires.
        const readyMsgs = this.session.finalizeKeygen(this.#cohortId!);
        this.emit('keygen-complete', {
          cohortId      : this.#cohortId!,
          beaconAddress : cohort.beaconAddress,
        });
        await this.#sendAll(readyMsgs);
      }
    } catch(err) {
      this.#fail(err as Error);
    }
  }

  /**
   * Handler for receiving participant updates. When all updates are received, automatically builds
   * and distributes the data for validation.
   * @param {BaseMessage} msg - The incoming message to handle.
   * @returns {Promise<void>} Resolves when handling is complete.
   * @throws {Error} If any step of handling fails, the error is emitted and the run promise is rejected.
   * Note: if the runner has been stopped, handlers will ignore incoming messages.
   */
  async #handleSubmitUpdate(msg: BaseMessage): Promise<void> {
    if(this.#stopped) return;
    try {
      this.session.receive(msg);
      this.emit('update-received', { participantDid: msg.from });

      // When all updates collected, build and distribute
      if(this.session.getCohortPhase(this.#cohortId!) === ServiceCohortPhase.UpdatesCollected) {
        const distributeMsgs = this.session.buildAndDistribute(this.#cohortId!);
        this.emit('data-distributed', { cohortId: this.#cohortId! });
        await this.#sendAll(distributeMsgs);
      }
    } catch(err) {
      this.#fail(err as Error);
    }
  }

  /**
   * Handler for receiving validation acknowledgments. When all validations are received,
   * automatically requests tx data and starts signing.
   * @param {BaseMessage} msg - The incoming message to handle.
   * @returns {Promise<void>} Resolves when handling is complete.
   * @throws {Error} If any step of handling fails, the error is emitted and the run promise is rejected.
   * Note: if the runner has been stopped, handlers will ignore incoming messages.
   */
  async #handleValidationAck(msg: BaseMessage): Promise<void> {
    if(this.#stopped) return;
    try {
      this.session.receive(msg);
      const approved = !!msg.body?.approved;
      this.emit('validation-received', { participantDid: msg.from, approved });

      // When all validations received, request tx data and start signing
      if(this.session.getCohortPhase(this.#cohortId!) === ServiceCohortPhase.Validated) {
        const cohort = this.session.getCohort(this.#cohortId!)!;
        const txData = await this.#onProvideTxData({
          cohortId      : this.#cohortId!,
          beaconAddress : cohort.beaconAddress,
          signalBytes   : cohort.signalBytes!,
        });
        const authMsgs = this.session.startSigning(this.#cohortId!, txData);
        const sessionId = this.session.getSigningSessionId(this.#cohortId!) ?? '';
        this.emit('signing-started', { sessionId });
        await this.#sendAll(authMsgs);
      }
    } catch(err) {
      this.#fail(err as Error);
    }
  }

  /**
   * Handler for receiving nonce contributions and signature authorizations. When all nonces or
   * signatures are received,
   * @param {BaseMessage} msg - The incoming message to handle.
   * @returns {Promise<void>} Resolves when handling is complete.
   * @throws {Error} If any step of handling fails, the error is emitted and the run promise is rejected.
   * Note: if the runner has been stopped, handlers will ignore incoming messages.
   */
  async #handleNonceContribution(msg: BaseMessage): Promise<void> {
    if(this.#stopped) return;
    try {
      this.session.receive(msg);
      this.emit('nonce-received', { participantDid: msg.from });

      // When all nonces collected, send aggregated nonce
      if(this.session.getCohortPhase(this.#cohortId!) === ServiceCohortPhase.NoncesCollected) {
        await this.#sendAll(this.session.sendAggregatedNonce(this.#cohortId!));
      }
    } catch(err) {
      this.#fail(err as Error);
    }
  }

  /**
   * Handler for receiving signature authorizations. When all partial signatures are received, the
   * session automatically completes and the final result is emitted and the run() promise is resolved.
   * @param {BaseMessage} msg - The incoming message to handle.
   * @returns {Promise<void>} Resolves when handling is complete.
   * @throws {Error} If any step of handling fails, the error is emitted and the run promise is rejected.
   * Note: if the runner has been stopped, handlers will ignore incoming messages.
   */
  async #handleSignatureAuthorization(msg: BaseMessage): Promise<void> {
    if(this.#stopped) return;
    try {
      this.session.receive(msg);

      // The state machine auto-completes when all partial sigs received
      const result = this.session.getResult(this.#cohortId!);
      if(result) {
        this.emit('signing-complete', result);
        this.#resolveRun?.(result);
      }
    } catch(err) {
      this.#fail(err as Error);
    }
  }

  /**
   * Internal: helper to send all messages sequentially. Catches and propagates errors.
   * @param {BaseMessage[]} msgs - The messages to send.
   * @returns {Promise<void>} Resolves when all messages have been sent.
   * @throws {Error} If sending any message fails, the error is emitted and the run promise is
   * rejected.
   */
  async #sendAll(msgs: BaseMessage[]): Promise<void> {
    for(const m of msgs) {
      await this.#transport.sendMessage(m, this.#did, m.to);
    }
  }

  /**
   * Internal: helper to handle errors. Emits an 'error' event and rejects the run promise.
   * @param {Error} err - The error to handle.
   */
  #fail(err: Error): void {
    this.emit('error', err);
    this.#rejectRun?.(err);
  }
}

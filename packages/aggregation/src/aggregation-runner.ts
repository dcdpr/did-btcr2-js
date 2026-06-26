import type { SchnorrKeyPair } from '@did-btcr2/keypair';
import { bytesToHex } from '@noble/hashes/utils';
import { DEFAULT_FUNDING_MODEL, DEFAULT_RECOVERY_SEQUENCE } from './core/recovery-policy.js';
import type { AggregationResult } from './service/service.js';
import { InMemoryBus, InMemoryTransport } from './core/transport/in-memory.js';
import { AggregationParticipantRunner } from './participant/participant-runner.js';
import type { OnProvideUpdate } from './participant/participant-runner.js';
import { AggregationServiceRunner } from './service/service-runner.js';
import type { OnProvideTxData } from './service/service-runner.js';
import type { FeeEstimator } from '@did-btcr2/bitcoin';

/** Identity (DID + keys) for one actor in an {@link AggregationRunner.solo} run. */
export interface SoloActor {
  did: string;
  keys: SchnorrKeyPair;
}

/** Options for {@link AggregationRunner.solo}. */
export interface SoloCohortOptions {
  /** The coordinating service identity. */
  service: SoloActor;
  /** The single participant identity (the lone signer of the cohort). */
  participant: SoloActor;
  /**
   * Bitcoin network and beacon type (`'CASBeacon'` | `'SMTBeacon'`) for the
   * cohort. Recovery params are optional here: in a solo run the service actor
   * is the operator and holds full keys, so when `recoveryKey` is omitted the
   * service's own x-only key is used as the CSV recovery key (it can actually
   * perform the recovery), with {@link DEFAULT_RECOVERY_SEQUENCE} as the delay.
   */
  config: {
    network: string;
    beaconType: string;
    /** Operator recovery key, x-only (64-hex). Defaults to the service actor's x-only key. */
    recoveryKey?: string;
    /** Relative-timelock (BIP-68) before recovery is spendable. Defaults to {@link DEFAULT_RECOVERY_SEQUENCE}. */
    recoverySequence?: number;
  };
  /** Provide the participant's signed BTCR2 update for the cohort. */
  onProvideUpdate: OnProvideUpdate;
  /** Provide the Bitcoin transaction data the cohort signs. */
  onProvideTxData: OnProvideTxData;
  /**
   * Fee estimator forwarded to {@link onProvideTxData} so the cohort transaction is
   * sized at a chosen rate. Defaults to a static 5 sat/vB estimator (ADR 045).
   */
  feeEstimator?: FeeEstimator;
  /** Optional overall wall-clock budget for the run (ms). */
  cohortTtlMs?: number;
  /** Optional per-phase stall timeout (ms). */
  phaseTimeoutMs?: number;
}

/**
 * High-level facades for driving an aggregation cohort to completion.
 *
 * @class AggregationRunner
 */
export class AggregationRunner {
  /**
   * Run a cohort of ONE participant entirely in-process and return the
   * aggregated MuSig2 result.
   *
   * One party plays both the coordinating service and the lone participant,
   * connected over an {@link InMemoryTransport} (no relay or HTTP server). This
   * makes the single-participant aggregate-beacon path (the N=1 corner of the
   * two-axis beacon matrix, see ADR 037) first-class, useful for generating
   * and reproducing single-participant aggregate test vectors.
   *
   * The service advertises a cohort with `minParticipants: 1`; the participant
   * joins, submits its update, and the two complete keygen, data distribution,
   * validation, and a one-signer MuSig2 P2TR key-path signing round.
   *
   * @param options Service + participant identities, cohort config, and the
   *   update / tx-data callbacks.
   * @returns The {@link AggregationResult} (cohort id, aggregated signature, signed tx).
   */
  static async solo(options: SoloCohortOptions): Promise<AggregationResult> {
    const transport = new InMemoryTransport(new InMemoryBus());
    transport.registerActor(options.service.did, options.service.keys);
    transport.registerActor(options.participant.did, options.participant.keys);
    // Pre-register communication keys both ways. Production exchanges these via
    // the protocol handshake; in-process we wire them directly.
    transport.registerPeer(options.participant.did, options.participant.keys.publicKey.compressed);
    transport.registerPeer(options.service.did, options.service.keys.publicKey.compressed);
    transport.start();

    // In a solo run the service actor is the operator and holds full keys, so it
    // can both advertise the recovery terms and, if ever needed, perform the
    // recovery. Default the recovery key to the service's own x-only key.
    const recoveryKey = options.config.recoveryKey
      ?? bytesToHex(options.service.keys.publicKey.compressed.slice(1));
    const recoverySequence = options.config.recoverySequence ?? DEFAULT_RECOVERY_SEQUENCE;

    const service = new AggregationServiceRunner({
      transport,
      did                    : options.service.did,
      keys                   : options.service.keys,
      config                 : { minParticipants: 1, network: options.config.network, beaconType: options.config.beaconType, recoveryKey, recoverySequence, fundingModel: DEFAULT_FUNDING_MODEL },
      onProvideTxData        : options.onProvideTxData,
      feeEstimator           : options.feeEstimator,
      cohortTtlMs            : options.cohortTtlMs,
      phaseTimeoutMs         : options.phaseTimeoutMs,
      // In-process bus with the participant already listening: a single advert
      // suffices, so disable the republish loop (no dangling interval).
      advertRepeatIntervalMs : 0,
    });

    const participant = new AggregationParticipantRunner({
      transport,
      did             : options.participant.did,
      keys            : options.participant.keys,
      shouldJoin      : async () => true,
      onProvideUpdate : options.onProvideUpdate,
    });

    await participant.start();
    try {
      return await service.run();
    } finally {
      participant.stop();
      service.stop();
    }
  }
}

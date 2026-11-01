import type { SchnorrKeyPair } from '@did-btcr2/keys';
import { DEFAULT_FUNDING_MODEL } from './core/recovery-policy.js';
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
   * cohort. The leaf values are optional. With none, the beacon address has no
   * script tree, so only the participant key can spend it (ADR 169). If the
   * config has a leaf value, the solo participant also allows that leaf.
   *
   * With no leaf, the beacon address depends only on the participant key. Two
   * solo runs with the same participant key, leaf values, and network get one
   * beacon address, also if the beacon types differ. Each run makes a new
   * participant object, so the BEACON_TYPE_CONFLICT check does not see the
   * earlier run. If a DID document has a beacon service at this address, a
   * signal of another type makes that DID invalid. To use the other beacon
   * type, use another participant key (ADRs 152 and 169).
   */
  config: {
    network: string;
    beaconType: string;
    /** k of the k-of-n fallback leaf (1 in a solo run). Absent: no fallback leaf. */
    fallbackThreshold?: number;
    /** Operator recovery key, x-only (64-hex). With `recoverySequence`, the beacon address gets the CSV recovery leaf. */
    recoveryKey?: string;
    /** Relative-timelock (BIP-68) before recovery is spendable. With `recoveryKey`, the beacon address gets the CSV recovery leaf. */
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
   * Each call makes a new participant object. Thus a run does not know the
   * cohorts of an earlier run. Before a run of another beacon type, read
   * {@link SoloCohortOptions.config}.
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

    // No leaf by default (ADR 169). The service gets the leaf values of the
    // config as they are, and the participant allows only those leaves.
    const { network, beaconType, fallbackThreshold, recoveryKey, recoverySequence } = options.config;

    const service = new AggregationServiceRunner({
      transport,
      did                    : options.service.did,
      keys                   : options.service.keys,
      config                 : {
        minParticipants : 1,
        network,
        beaconType,
        fallbackThreshold,
        recoveryKey,
        recoverySequence,
        fundingModel    : DEFAULT_FUNDING_MODEL,
      },
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
      did               : options.participant.did,
      keys              : options.participant.keys,
      shouldJoin        : async () => true,
      onProvideUpdate   : options.onProvideUpdate,
      allowFallbackLeaf : fallbackThreshold !== undefined,
      allowRecoveryLeaf : recoveryKey !== undefined || recoverySequence !== undefined,
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

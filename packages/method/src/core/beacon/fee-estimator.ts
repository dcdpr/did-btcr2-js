/**
 * Estimates the fee (in satoshis) for a transaction of a given virtual size.
 *
 * Beacons delegate fee calculation to a `FeeEstimator` so that callers can
 * plug in different strategies: static fee rates for tests/regtest, mempool
 * APIs for mainnet, Bitcoin Core `estimatesmartfee` RPC for full-node setups,
 * etc.
 *
 * Implementations return the **total fee in satoshis** for a transaction of
 * the given virtual size (`vsize`). Callers pass the vsize; the estimator
 * decides the fee rate and computes the total.
 */
export interface FeeEstimator {
  /**
   * Estimate the total fee in satoshis for a transaction of the given vsize.
   * @param vsize Transaction virtual size in vbytes.
   * @returns Total fee in satoshis.
   */
  estimateFee(vsize: number): Promise<bigint>;
}

/**
 * Fee estimator that returns a fixed fee rate regardless of network conditions.
 *
 * Suitable for:
 * - Tests (deterministic outputs)
 * - Regtest (no real fee market)
 * - Environments where a fee rate is supplied out-of-band
 *
 * For mainnet production use, prefer a dynamic estimator that queries current
 * network conditions (mempool APIs, Bitcoin Core RPC).
 */
export class StaticFeeEstimator implements FeeEstimator {
  readonly satsPerVbyte: number;

  /**
   * @param satsPerVbyte Fee rate in satoshis per virtual byte. Default: 5 sat/vB.
   */
  constructor(satsPerVbyte: number = 5) {
    if(satsPerVbyte < 0 || !Number.isFinite(satsPerVbyte)) {
      throw new Error(`Invalid satsPerVbyte: ${satsPerVbyte}`);
    }
    this.satsPerVbyte = satsPerVbyte;
  }

  async estimateFee(vsize: number): Promise<bigint> {
    if(vsize < 0 || !Number.isFinite(vsize)) {
      throw new Error(`Invalid vsize: ${vsize}`);
    }
    return BigInt(Math.ceil(vsize * this.satsPerVbyte));
  }
}

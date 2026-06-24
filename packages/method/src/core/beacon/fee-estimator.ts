// The FeeEstimator contract and the StaticFeeEstimator implementation live in
// @did-btcr2/bitcoin, the natural home for a sat/vB fee primitive shared by the
// single-party and aggregated beacon broadcast paths. They are re-exported here so
// the @did-btcr2/method public surface is unchanged.
import { StaticFeeEstimator } from '@did-btcr2/bitcoin';
import type { FeeEstimator } from '@did-btcr2/bitcoin';

export { StaticFeeEstimator };
export type { FeeEstimator };

/**
 * Default fee estimator used when a caller supplies none: a static 5 sat/vB rate.
 * Suitable for tests and regtest. Production callers should inject a dynamic
 * estimator (a mempool API, or Bitcoin Core `estimatesmartfee`) at the point the
 * beacon transaction is built (single-party broadcast options, or the aggregation
 * service runner's fee estimator).
 */
export const DEFAULT_FEE_ESTIMATOR: FeeEstimator = new StaticFeeEstimator(5);

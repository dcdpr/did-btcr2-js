// @did-btcr2/aggregation (umbrella entry)
//
// The whole aggregation surface in one import. Applications should prefer the
// role entry points - `@did-btcr2/aggregation/core`, `/participant`, `/service`
// - so a client never bundles server code and a service never bundles client
// code. This umbrella additionally carries the two cross-role conveniences that
// legitimately need both roles: the in-process single-party runner (for
// single-participant test vectors) and the transport factory.
export * from './core/index.js';
export * from './participant/index.js';
export * from './service/index.js';
export * from './aggregation-runner.js';
export * from './transport-factory.js';

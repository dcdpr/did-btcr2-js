// @did-btcr2/aggregation/core
//
// The shared base both the participant and service roles depend on: the
// protocol-and-crypto core, the wire messages, the cohort model and conditions,
// the recovery and fallback scripts, the protocol phases, the beacon strategy,
// the errors and logger, the base transport interface, the in-memory and Nostr
// transports, the shared HTTP primitives, and the generic typed event emitter.
// It depends on neither role.
export * from './errors.js';
export * from './logger.js';
export * from './conditions.js';
export * from './phases.js';
export * from './cohort.js';
export * from './signing-session.js';
export * from './signer.js';
export * from './beacon-strategy.js';
export * from './recovery-policy.js';
export * from './recovery-spend.js';
export * from './fallback-spend.js';
export * from './typed-emitter.js';
export * from './messages/index.js';
export * from './transport/index.js';

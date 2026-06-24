// Aggregation (extracted to @did-btcr2/aggregation; re-exported here for backward compatibility)
export * from '@did-btcr2/aggregation';

// Beacons
export * from './core/beacon/beacon.js';
export * from './core/beacon/cas-beacon.js';
export * from './core/beacon/error.js';
export * from './core/beacon/factory.js';
export * from './core/beacon/fee-estimator.js';
export * from './core/beacon/interfaces.js';
export * from './core/beacon/signal-discovery.js';
export * from './core/beacon/singleton-beacon.js';
export * from './core/beacon/smt-beacon.js';
export * from './core/beacon/utils.js';

// Core
export * from './core/did-sender-resolver.js';
export * from './core/identifier.js';
export * from './core/interfaces.js';
export * from './core/resolver.js';
export * from './core/types.js';
export * from './core/updater.js';

// Utils
export * from './utils/appendix.js';
export * from './utils/did-document-builder.js';
export * from './utils/did-document.js';

// Facade
export * from './did-btcr2.js';

// @did-btcr2/aggregation/participant
//
// The client role: the participant state machine, its runner, the HTTP client
// transport, the client-side server-sent-events reader, and the participant's
// events. Depends only on the core; never on the service role, so a client
// application that imports this entry never bundles server-hosting code. Import
// shared types (Transport, cohort conditions, etc.) from `@did-btcr2/aggregation/core`.
export * from './participant.js';
export * from './participant-runner.js';
export * from './http-client.js';
export * from './sse-stream.js';
export * from './events.js';

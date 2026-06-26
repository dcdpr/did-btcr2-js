// @did-btcr2/aggregation/service
//
// The coordinating role: the service state machine, its runner, the HTTP server
// transport with its server-side machinery (inbox buffer, nonce cache, rate
// limiter, SSE writer), and the service's events. Depends only on the core;
// never on the participant role. Import shared types from
// `@did-btcr2/aggregation/core`.
export * from './service.js';
export * from './service-runner.js';
export * from './http-server.js';
export * from './inbox-buffer.js';
export * from './nonce-cache.js';
export * from './rate-limiter.js';
export * from './sse-writer.js';
export * from './events.js';

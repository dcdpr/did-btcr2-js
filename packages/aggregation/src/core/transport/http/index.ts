// Shared HTTP transport primitives used by both the client and server roles:
// the signed-envelope format, request authentication, protocol descriptors,
// and HTTP transport errors. The role-specific HTTP client and server live in
// the participant and service entry points.
export * from './envelope.js';
export * from './errors.js';
export * from './protocol.js';
export * from './request-auth.js';

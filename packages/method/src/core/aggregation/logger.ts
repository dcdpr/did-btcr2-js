/**
 * Minimal injectable logger for the aggregation subsystem.
 *
 * Each runner and transport adapter accepts a `Logger` option; the default is
 * {@link CONSOLE_LOGGER}, which forwards to `console.*`. Pass
 * {@link SILENT_LOGGER} to suppress output (useful for tests) or a custom
 * implementation to route logs to pino, winston, Sentry, etc.
 *
 * The interface is intentionally small — we don't want production code taking
 * a hard dependency on any specific logger library.
 */
export interface Logger {
  debug(message: string, ...args: unknown[]): void;
  info(message: string, ...args: unknown[]): void;
  warn(message: string, ...args: unknown[]): void;
  error(message: string, ...args: unknown[]): void;
}

/** Console-backed logger. Default for runners and transports. */
export const CONSOLE_LOGGER: Logger = {
  debug : (msg, ...args) => console.debug(msg, ...args),
  info  : (msg, ...args) => console.info(msg, ...args),
  warn  : (msg, ...args) => console.warn(msg, ...args),
  error : (msg, ...args) => console.error(msg, ...args),
};

/** No-op logger. Useful for tests and production environments with own logging pipeline. */
export const SILENT_LOGGER: Logger = {
  debug : () => {},
  info  : () => {},
  warn  : () => {},
  error : () => {},
};

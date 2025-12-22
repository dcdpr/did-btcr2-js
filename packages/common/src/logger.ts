import chalk, { ChalkInstance } from 'chalk';

export enum Env {
  Development = 'development',
  Production = 'production',
  Test = 'test',
}

export type Level = 'debug' | 'error' | 'info' | 'log' | 'warn' | 'security';

export const NODE_ENV = (process.env.NODE_ENV as Env) || Env.Development;

/**
 * Mapping of log levels to colors for cleaner, more flexible logging.
 */
const LOG_LEVELS: Record<Env, Level[]> = {
  development : ['debug', 'info', 'log', 'warn', 'security'],
  test        : ['log', 'info', 'error'],
  production  : ['error'],
};

/**
 * Colors associated with each log level.
 */
const LEVEL_STYLES: Record<Level, ChalkInstance> = {
  debug    : chalk.green,
  error    : chalk.red,
  info     : chalk.blue,
  log      : chalk.gray,
  warn     : chalk.yellow,
  security : chalk.magenta,
};

/**
 * Defines the method mapping for console methods.
 */
// eslint-disable-next-line no-undef
const LEVEL_METHODS: Record<Level, keyof Console> = {
  debug    : 'debug',
  error    : 'error',
  info     : 'info',
  log      : 'log',
  warn     : 'warn',
  security : 'warn',
};

/**
 * A flexible, feature-rich logger with:
 * - Environment-based filtering
 * - Namespacing
 * - File/line tracing
 * - Timestamps
 * - Colorized output
 * @class Logger
 * @type {Logger}
 */
export class Logger {
  private levels: Level[];
  private namespace?: string;
  private useColors: boolean;
  private static shared: Logger;

  /**
   * Creates a new Logger instance.
   * @param {string} namespace - Optional namespace for log messages.
   * @param {Object} options - Configuration options.
   * @param {Level[]} options.levels - Log levels to enable.
   * @param {boolean} options.useColors - Whether to use colored output.
   */
  constructor(namespace?: string, options: { levels?: Level[]; useColors?: boolean } = {}) {
    this.levels = options.levels || LOG_LEVELS[NODE_ENV] || [];
    this.namespace = namespace || 'did-btcr2-js';
    const envForce = process.env.LOG_COLORS;
    this.useColors = options.useColors || (envForce ? envForce !== '0' && envForce.toLowerCase() !== 'false' : Boolean(process.stdout.isTTY));
  }

  /**
   * Logs a message with the specified level.
   * @param {Level} level - The log level.
   * @param {unknown} message - The message to log.
   * @param {...unknown[]} args - Additional arguments to log.
   * @returns {void}
   */
  private _log(level: Level, message?: unknown, ...args: unknown[]): void {
    if (!this.levels.includes(level)) return;

    const color = LEVEL_STYLES[level];
    const method = LEVEL_METHODS[level];

    const timestamp = new Date().toISOString();
    const namespace = this.namespace ? `[${this.namespace}]` : '';
    const render = this.useColors ? color : (v: string) => v;
    const renderGray = this.useColors ? chalk.gray : (v: string) => v;

    (console[method] as (...args: any[]) => void)(
      `${renderGray(timestamp)} ${namespace} ${render(level)}: ${message}`,
      ...args
    );
  }

  debug(message?: unknown, ...args: unknown[]): Logger {
    this._log('debug', message, ...args); return this;
  }

  error(message?: unknown, ...args: unknown[]): Logger {
    this._log('error', message, ...args); return this;
  }

  info(message?: unknown, ...args: unknown[]): Logger {
    this._log('info', message, ...args); return this;
  }

  warn(message?: unknown, ...args: unknown[]): Logger {
    this._log('warn', message, ...args); return this;
  }

  security(message?: unknown, ...args: unknown[]): Logger {
    this._log('security', message, ...args); return this;
  }

  log(message?: unknown, ...args: unknown[]): Logger {
    this._log('log', message, ...args); return this;
  }

  newline(): Logger {
    console.log(); return this;
  }

  /**
   * Static methods for convenience (auto-instantiate).
   * These use a shared singleton instance.
   * @param {unknown} message - The message to log.
   * @param {...unknown[]} args - Additional arguments to log.
   * @returns {void}
   */
  static debug(message?: unknown, ...args: unknown[]): void {
    Logger.instance().debug(message, ...args);
  }

  static error(message?: unknown, ...args: unknown[]): void {
    Logger.instance().error(message, ...args);
  }

  static info(message?: unknown, ...args: unknown[]): void {
    Logger.instance().info(message, ...args);
  }

  static warn(message?: unknown, ...args: unknown[]): void {
    Logger.instance().warn(message, ...args);
  }

  static security(message?: unknown, ...args: unknown[]): void {
    Logger.instance().security(message, ...args);
  }

  static log(message?: unknown, ...args: unknown[]): void {
    Logger.instance().log(message, ...args);
  }

  static newline() {
    Logger.instance().newline();
  }

  private static instance(levels?: Level[], useColors?: boolean): Logger {
    if (!Logger.shared) {
      Logger.shared = new Logger(undefined, { levels, useColors });
    } else {
      if (levels) Logger.shared.levels = levels;
      if (useColors !== undefined) Logger.shared.useColors = useColors;
    }
    return Logger.shared;
  }
}

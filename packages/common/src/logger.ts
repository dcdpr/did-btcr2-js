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
 */
export class Logger {
  private levels: Level[];
  private namespace?: string;

  constructor(namespace?: string) {
    this.levels = LOG_LEVELS[NODE_ENV] || [];
    this.namespace = namespace ?? 'did-btcr2-js';
  }

  /**
   * Logs a message with the specified level.
   */
  private _log(level: Level, message?: unknown, ...args: unknown[]): void {
    if (!this.levels.includes(level)) return;

    const color = LEVEL_STYLES[level];
    const method = LEVEL_METHODS[level];

    const timestamp = new Date().toISOString();
    const namespace = this.namespace ? `[${this.namespace}]` : '';

    (console[method] as (...args: any[]) => void)(
      `${chalk.gray(timestamp)} ${namespace} ${color(level)}: ${chalk.white(message)}`,
      ...args
    );
  }

  // 🔹 Instance-based logging methods
  public debug(message?: unknown, ...args: unknown[]) {
    this._log('debug', message, ...args); return this;
  }

  public error(message?: unknown, ...args: unknown[]) {
    this._log('error', message, ...args); return this;
  }

  public info(message?: unknown, ...args: unknown[]) {
    this._log('info', message, ...args); return this;
  }

  public warn(message?: unknown, ...args: unknown[]) {
    this._log('warn', message, ...args); return this;
  }

  public security(message?: unknown, ...args: unknown[]) {
    this._log('security', message, ...args); return this;
  }

  public log(message?: unknown, ...args: unknown[]) {
    this._log('log', message, ...args); return this;
  }

  public newline() {
    console.log(); return this;
  }

  /**
   * Static methods for convenience (auto-instantiate).
   */
  public static debug(message?: unknown, ...args: unknown[]) {
    new Logger().debug(message, ...args);
  }

  public static error(message?: unknown, ...args: unknown[]) {
    new Logger().error(message, ...args);
  }

  public static info(message?: unknown, ...args: unknown[]) {
    new Logger().info(message, ...args);
  }

  public static warn(message?: unknown, ...args: unknown[]) {
    new Logger().warn(message, ...args);
  }

  public static security(message?: unknown, ...args: unknown[]) {
    new Logger().security(message, ...args);
  }

  public static log(message?: unknown, ...args: unknown[]) {
    new Logger().log(message, ...args);
  }

  public static newline() {
    new Logger().newline();
  }
}
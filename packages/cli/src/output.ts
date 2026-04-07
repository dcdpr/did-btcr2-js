import type { CommandResult, GlobalOptions } from './types.js';

/**
 * Formats a CommandResult for console output.
 * In 'json' mode, the full result is serialized.
 * In 'text' mode, only the relevant payload is printed.
 * @param {CommandResult} result - The result to format.
 * @param {GlobalOptions} options - The global options to determine output format.
 * @returns {string} - The formatted output string.
 */
export function formatResult(result: CommandResult, options: GlobalOptions): string {
  if (options.output === 'json') {
    return JSON.stringify(result, null, 2);
  }
  const { data } = result;
  return typeof data === 'string' ? data : JSON.stringify(data, null, 2);
}

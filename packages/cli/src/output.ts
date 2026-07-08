import type { CommandResult, GlobalOptions } from './types.js';

/** Placeholder printed in place of a redacted secret value. */
export const REDACTED = '********';

/**
 * Key names whose (scalar) values are treated as secrets and redacted in printed
 * output. Covers RPC passwords plus header credentials (`Authorization`, API
 * keys, bearer tokens) that a profile can now carry in `btc.headers`/`rpcHeaders`.
 */
const SECRET_KEY = /(pass|secret|token|auth|api[-_]?key|credential|bearer)/i;

/** Whether a config key name looks like a secret (so its scalar value should be redacted). */
export function isSecretKey(key: string): boolean {
  return SECRET_KEY.test(key);
}

/**
 * Masks the password in a `scheme://user:pass@host` URL, leaving the rest of the
 * value verbatim. A credential embedded in an endpoint URL (e.g. `rpcUrl`) is not
 * caught by key-name matching, so it is scrubbed here regardless of the key.
 */
export function scrubUrlUserinfo(value: string | undefined): string | undefined {
  if (value === undefined) return undefined;
  return value.replace(/^([a-z][a-z0-9+.-]*:\/\/[^/@:]+):[^/@]*@/i, `$1:${REDACTED}@`);
}

/**
 * Returns a deep copy of `value` with secret scalar values replaced by
 * {@link REDACTED}, so routine introspection (`config get`/`list`/`effective`)
 * does not print RPC passwords or other secrets into terminal scrollback and CI
 * logs. A secret-named key redacts only a scalar value (an object under such a
 * key, e.g. a profile named `access-token`, is still traversed, not wholesale
 * masked). Passwords embedded in URL values are scrubbed regardless of key name.
 * When `keyName` is a secret name, a directly-passed scalar value is redacted
 * (used when a single leaf value is printed). Display-only: the stored config and
 * the value used to connect are untouched.
 */
export function redactSecrets(value: unknown, keyName?: string): unknown {
  if (Array.isArray(value)) {
    return value.map(item => redactSecrets(item));
  }
  if (value !== null && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [ key, val ] of Object.entries(value as Record<string, unknown>)) {
      out[key] = redactSecrets(val, key);
    }
    return out;
  }
  if (keyName !== undefined && isSecretKey(keyName)) {
    return value === undefined ? undefined : REDACTED;
  }
  return typeof value === 'string' ? scrubUrlUserinfo(value) : value;
}

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

import { CLIError } from './error.js';
import { SUPPORTED_NETWORKS } from './types.js';

/**
 * Declarative schema of the known config-file paths, used by both the write-time
 * validation in `config set` and the strict `config validate` check so the two
 * cannot disagree. Leaves name a value kind: `'string'`, `'number'`, `'object'`
 * (a free-form map, e.g. headers), or `'enum:<name>'`. The `'*'` key under
 * `profiles` matches any profile name.
 */
const CONFIG_SCHEMA: SchemaNode = {
  schemaVersion : 'number',
  defaults      : {
    profile : 'string',
    network : 'enum:network',
    output  : 'enum:output',
  },
  profiles : {
    '*' : {
      network : 'enum:network',
      btc     : {
        rest          : 'string',
        rpcUrl        : 'string',
        rpcUser       : 'string',
        rpcPass       : 'string',
        feeRate       : 'number',
        changeAddress : 'string',
        timeoutMs     : 'number',
        headers       : 'object',
        wallet        : 'string',
        rpcHeaders    : 'object',
      },
      cas : {
        gateway   : 'string',
        rpcUrl    : 'string',
        timeoutMs : 'number',
      },
      identity : {
        keystore : 'string',
        default  : 'string',
      },
    },
  },
};

type SchemaLeaf = 'string' | 'number' | 'object' | `enum:${string}`;
type SchemaNode = { [key: string]: SchemaLeaf | SchemaNode };

/** One problem found in a config file: the dotted path and a human-readable reason. */
export interface ConfigIssue {
  path  : string;
  issue : string;
}

/**
 * Resolves a dotted config path to its schema node: a leaf kind string, a nested
 * {@link SchemaNode}, or `undefined` when the path is not part of the known
 * schema. A segment under `profiles` matches the `'*'` template.
 */
function lookupSchemaNode(dotted: string): SchemaLeaf | SchemaNode | undefined {
  let node: SchemaLeaf | SchemaNode | undefined = CONFIG_SCHEMA;
  for (const segment of dotted.split('.')) {
    if (typeof node !== 'object') return undefined;
    // Own-property checks only: `in` would match inherited Object.prototype names
    // (`toString`, `constructor`, `__proto__`), treating a builtin as a known key.
    if (Object.hasOwn(node, segment)) {
      node = node[segment];
    } else if (Object.hasOwn(node, '*')) {
      node = node['*'];
    } else {
      return undefined;
    }
  }
  return node;
}

/** Whether a dotted path is part of the known config schema (leaf or intermediate). */
export function isKnownConfigPath(dotted: string): boolean {
  return lookupSchemaNode(dotted) !== undefined;
}

/**
 * Validates a value against a leaf kind, throwing a {@link CLIError} for a value
 * that does not match: an out-of-range enum, a non-number for a `number` leaf, or
 * a non-object for an `object` leaf (a map such as `headers`). A no-op for
 * `string` leaves and for intermediate nodes.
 */
function assertLeafValue(kind: SchemaLeaf, dotted: string, value: unknown): void {
  if (kind === 'enum:network' && !SUPPORTED_NETWORKS.includes(value as never)) {
    throw new CLIError(
      `Invalid value for ${dotted}: "${String(value)}". Expected one of ${SUPPORTED_NETWORKS.join(', ')}.`,
      'INVALID_ARGUMENT_ERROR',
      { path: dotted, value },
    );
  }
  if (kind === 'enum:output' && value !== 'json' && value !== 'text') {
    throw new CLIError(
      `Invalid value for ${dotted}: "${String(value)}". Expected "json" or "text".`,
      'INVALID_ARGUMENT_ERROR',
      { path: dotted, value },
    );
  }
  if (kind === 'number' && typeof value !== 'number') {
    throw new CLIError(
      `Invalid value for ${dotted}: expected a number, got ${typeof value}. `
      + 'Pass a bare number (e.g. `config set ' + dotted + ' 5`).',
      'INVALID_ARGUMENT_ERROR',
      { path: dotted, value },
    );
  }
  if (kind === 'object' && (typeof value !== 'object' || value === null || Array.isArray(value))) {
    throw new CLIError(
      `Invalid value for ${dotted}: expected a JSON object (e.g. \`config set ${dotted} '{"Key":"Value"}'\`).`,
      'INVALID_ARGUMENT_ERROR',
      { path: dotted, value },
    );
  }
}

/**
 * Write-time validation for `config set`. An enum, number, or object leaf whose
 * value has the wrong kind is a hard rejection (throws). An unknown path is
 * permitted but reported, so `config set` can warn and still write (keeping
 * forward-compatible and third-party keys usable). Returns `{ unknownPath }`.
 */
export function validateConfigSet(dotted: string, value: unknown): { unknownPath: boolean } {
  const node = lookupSchemaNode(dotted);
  if (node === undefined) return { unknownPath: true };
  if (typeof node === 'string') {
    assertLeafValue(node, dotted, value);
  }
  return { unknownPath: false };
}

/**
 * Strict validation for `config validate`: walks a parsed config and collects
 * every unknown key and out-of-enum value, plus a `schemaVersion` that is newer
 * than this CLI supports. Never throws; returns the full list so the caller can
 * report all problems at once.
 */
export function findConfigIssues(config: Record<string, unknown>, supportedSchemaVersion: number): ConfigIssue[] {
  const issues: ConfigIssue[] = [];

  const version = config.schemaVersion;
  if (typeof version === 'number' && version > supportedSchemaVersion) {
    issues.push({
      path  : 'schemaVersion',
      issue : `newer than supported (${version} > ${supportedSchemaVersion}); upgrade the CLI to use this file`,
    });
  }

  walk(config, [], issues);
  return issues;
}

/** Recursively collects unknown-key and bad-enum issues under `prefix`. */
function walk(obj: Record<string, unknown>, prefix: string[], issues: ConfigIssue[]): void {
  for (const [ key, value ] of Object.entries(obj)) {
    const path = [ ...prefix, key ];
    const dotted = path.join('.');
    const node = lookupSchemaNode(dotted);

    if (node === undefined) {
      issues.push({ path: dotted, issue: 'unknown key' });
      continue; // Do not descend into an unknown subtree.
    }

    if (typeof node === 'string') {
      try {
        assertLeafValue(node, dotted, value);
      } catch (error) {
        issues.push({ path: dotted, issue: (error as Error).message });
      }
    } else if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
      walk(value as Record<string, unknown>, path, issues);
    }
  }
}

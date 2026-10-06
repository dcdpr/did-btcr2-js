import type { Sidecar } from '@did-btcr2/api';
import { readFileSync } from 'node:fs';
import { CLIError } from './error.js';

/** The fields of a sidecar data file, and the JSON type of each. */
const SIDECAR_FIELDS: Record<string, 'string' | 'object' | 'array'> = {
  '@context'      : 'string',
  genesisDocument : 'object',
  updates         : 'array',
  casUpdates      : 'array',
  smtProofs       : 'array',
};

/**
 * Reads a sidecar data file for `identifier add --sidecar`, `message sign
 * --sidecar`, and `message verify --sidecar`. Refuses a file that is not a JSON
 * object, a field with the wrong JSON type, and an unknown field. The file
 * carries data only: a `versionId`, a `versionTime`, or a `minConf` is an
 * unknown field. A resolution options file has the field `sidecar`, so the
 * error for it names the object to use.
 */
export function readSidecarFile(path: string): Sidecar {
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(path, 'utf-8'));
  } catch (error) {
    throw new CLIError(
      `Could not read the sidecar data file ${path}: ${(error as Error).message}`,
      'INVALID_ARGUMENT_ERROR',
      { path },
    );
  }
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new CLIError(`The sidecar data file ${path} must hold a JSON object.`, 'INVALID_ARGUMENT_ERROR', { path });
  }
  for (const [ field, value ] of Object.entries(parsed)) {
    const expected = SIDECAR_FIELDS[field];
    if (expected === undefined) {
      const hint = field === 'sidecar' ? ' The file holds resolution options: use the object in its "sidecar" field.' : '';
      throw new CLIError(
        `The sidecar data file ${path} has the unknown field "${field}".${hint}`,
        'INVALID_ARGUMENT_ERROR',
        { path, field },
      );
    }
    const actual = Array.isArray(value) ? 'array' : value === null ? 'null' : typeof value;
    if (actual !== expected) {
      throw new CLIError(
        `The field "${field}" of the sidecar data file ${path} must be a JSON ${expected}.`,
        'INVALID_ARGUMENT_ERROR',
        { path, field },
      );
    }
  }
  return parsed as Sidecar;
}

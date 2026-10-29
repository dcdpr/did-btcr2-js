import { DEFAULT_MIN_CONF } from '@did-btcr2/api';
import type { ResolutionOptions } from '@did-btcr2/api';
import { readFile } from 'node:fs/promises';
import { CLIError } from './error.js';
import { readGenesisDocumentFile } from './genesis-document-file.js';

/** The flags that select the resolution options of a command. */
export type ResolutionOptionFlags = {
  resolutionOptions?     : string;
  resolutionOptionsPath? : string;
  minConf?               : number;
  genesisDocument?       : string;
};

/** Whether any resolution flag is set. */
export function hasResolutionFlags(flags: ResolutionOptionFlags): boolean {
  return flags.resolutionOptions !== undefined
    || flags.resolutionOptionsPath !== undefined
    || flags.minConf !== undefined
    || flags.genesisDocument !== undefined;
}

/** The help text of `--min-conf`. `resolve`, `update`, and `deactivate` share it. */
export const MIN_CONF_HELP =
  'Minimum block confirmations a beacon signal needs before resolution applies it '
  + `(positive integer, default: ${DEFAULT_MIN_CONF}). Overrides a minConf inside the JSON resolution options`;

/** Whether a value is an object that is not `null` and not an array. */
export function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Builds the resolution options from the flags. The inline JSON wins over
 * the file. The `--min-conf` flag wins over a `minConf` inside the JSON. The
 * `--genesis-document` file wins over a `sidecar.genesisDocument` inside the
 * JSON. Returns `undefined` if no flag is set.
 *
 * If the JSON is not an object, the function does not add a flag value to it.
 * If its `sidecar` is not an object, the function does not add the genesis
 * document. The api checks the options (ADR 157), so it refuses the JSON value
 * as it is.
 */
export async function readResolutionOptions(flags: ResolutionOptionFlags): Promise<ResolutionOptions | undefined> {
  let resolutionOptions: ResolutionOptions | undefined;
  if (flags.resolutionOptions) {
    try {
      resolutionOptions = JSON.parse(flags.resolutionOptions);
    } catch {
      throw new CLIError(
        'Invalid resolution options. Must be a valid JSON string.',
        'INVALID_ARGUMENT_ERROR',
        { resolutionOptions: flags.resolutionOptions }
      );
    }
  } else if (flags.resolutionOptionsPath) {
    try {
      const content = await readFile(flags.resolutionOptionsPath, 'utf-8');
      resolutionOptions = JSON.parse(content);
    } catch {
      throw new CLIError(
        'Invalid resolution options path. Must be a valid path to a JSON file.',
        'INVALID_ARGUMENT_ERROR',
        { resolutionOptionsPath: flags.resolutionOptionsPath }
      );
    }
  }
  const genesisDocument = flags.genesisDocument === undefined
    ? undefined
    : await readGenesisDocumentFile(flags.genesisDocument);
  if (resolutionOptions !== undefined && !isObject(resolutionOptions)) return resolutionOptions;
  // The flag wins over a minConf inside the JSON options.
  if (flags.minConf !== undefined) {
    resolutionOptions = { ...resolutionOptions, minConf: flags.minConf };
  }
  // The file wins over a sidecar.genesisDocument inside the JSON options.
  if (genesisDocument !== undefined) {
    const sidecar: unknown = resolutionOptions?.sidecar;
    if (sidecar !== undefined && !isObject(sidecar)) return resolutionOptions;
    resolutionOptions = {
      ...(resolutionOptions ?? {}),
      sidecar : { ...(resolutionOptions?.sidecar ?? {}), genesisDocument },
    };
  }
  return resolutionOptions;
}

/**
 * Commander argParser for `--min-conf`. Accepts a positive integer (minimum 1),
 * the domain the specification gives `minConf`. Errors at parse time otherwise.
 */
export function parseMinConf(value: string): number {
  if (!/^[1-9]\d*$/.test(value)) {
    throw new CLIError(
      '--min-conf must be a positive integer (minimum 1).',
      'INVALID_ARGUMENT_ERROR',
      { value },
    );
  }
  return Number(value);
}

import { DEFAULT_MIN_CONF } from '@did-btcr2/api';
import type { ResolutionOptions } from '@did-btcr2/method';
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

/**
 * Builds the resolution options from the flags. The inline JSON wins over
 * the file. The `--min-conf` flag wins over a `minConf` inside the JSON. The
 * `--genesis-document` file wins over a `sidecar.genesisDocument` inside the
 * JSON. Returns `undefined` if no flag is set.
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
  // The flag wins over a minConf inside the JSON options.
  if (flags.minConf !== undefined) {
    resolutionOptions = { ...(resolutionOptions ?? {}), minConf: flags.minConf };
  }
  // The file wins over a sidecar.genesisDocument inside the JSON options.
  if (flags.genesisDocument !== undefined) {
    const genesisDocument = await readGenesisDocumentFile(flags.genesisDocument);
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

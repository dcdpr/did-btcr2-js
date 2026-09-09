import { readFile } from 'node:fs/promises';
import { CLIError } from './error.js';

/** The help text of `--genesis-document`. `resolve`, `update`, and `deactivate` share it. */
export const GENESIS_DOCUMENT_HELP =
  'Path to the JSON genesis document of an external identifier (x). '
  + 'Fills sidecar.genesisDocument of the resolution options';

/**
 * Reads and parses a genesis document file. The content must be a JSON
 * object. The shape of the document is checked by the api, not here.
 * @param path The path of the JSON file.
 * @returns The parsed object.
 * @throws {CLIError} If the file is unreadable, not JSON, or not an object.
 */
export async function readGenesisDocumentFile(path: string): Promise<object> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(await readFile(path, 'utf-8'));
  } catch {
    throw new CLIError(
      'Invalid genesis document path. Must be a valid path to a JSON file.',
      'INVALID_ARGUMENT_ERROR',
      { genesisDocument: path },
    );
  }
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new CLIError(
      'Invalid genesis document. The file must contain a JSON object.',
      'INVALID_ARGUMENT_ERROR',
      { genesisDocument: path },
    );
  }
  return parsed;
}

import { homedir } from 'node:os';
import { join } from 'node:path';
import { blankToUndef } from '../types.js';

/**
 * Default keystore file path, following the XDG Base Directory Specification's
 * data directory. Secret key material is data a user accumulates, so it lives
 * under the data directory, kept separate from the configuration directory used
 * for portable settings.
 *
 * Resolution order:
 * 1. `$XDG_DATA_HOME/btcr2/keystore.json`
 * 2. `%LOCALAPPDATA%/btcr2/keystore.json` (Windows)
 * 3. `~/.local/share/btcr2/keystore.json` (fallback)
 */
export function defaultKeystorePath(): string {
  const base = blankToUndef(process.env.XDG_DATA_HOME)
    ?? blankToUndef(process.env.LOCALAPPDATA)
    ?? join(homedir(), '.local', 'share');
  return join(base, 'btcr2', 'keystore.json');
}

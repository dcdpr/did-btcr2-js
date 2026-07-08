import { homedir } from 'node:os';
import { join } from 'node:path';
import { blankToUndef } from './types.js';

/**
 * State-location overrides that influence where the CLI keeps its home
 * directory and its two state files. A subset of the broader
 * `ConnectionOverrides`, restated here so this module (the single source of
 * truth for on-disk locations) has no runtime dependency on `config.ts`.
 */
export interface PathOverrides {
  /** Explicit home root from the `--home` flag. Wins over `$BTCR2_HOME`. */
  home?     : string;
  /** Explicit config-file path from the `--config` flag. Overrides the home default. */
  config?   : string;
  /** Explicit keystore path from the `--keystore` flag. Overrides the home default. */
  keystore? : string;
}

/** Environment variable naming the CLI home directory (all state colocated). */
export const ENV_HOME = 'BTCR2_HOME';

/** The config and keystore file names, kept side by side under the home root. */
export const CONFIG_FILENAME = 'config.json';
export const KEYSTORE_FILENAME = 'keystore.json';

/**
 * Resolves the CLI home directory: the single root that holds `config.json` and
 * `keystore.json` side by side (ADR 079). Resolution order, highest wins:
 *
 * 1. `--home <dir>` (the {@link PathOverrides.home} flag)
 * 2. `$BTCR2_HOME`
 * 3. the platform default (see {@link platformDefaultHome})
 *
 * A blank value at any layer defers to the next, mirroring the `blankToUndef`
 * treatment every other precedence layer uses, so an exported-but-empty
 * `BTCR2_HOME` does not resolve the home to a bare relative path.
 */
export function resolveHome(overrides?: PathOverrides): string {
  return blankToUndef(overrides?.home)
    ?? blankToUndef(process.env[ENV_HOME])
    ?? platformDefaultHome();
}

/**
 * The default home when no `--home` / `$BTCR2_HOME` override is present, chosen
 * per OS so the location is idiomatic while staying a single colocated dir:
 *
 * - Windows: `%LOCALAPPDATA%\btcr2` (fallback `%APPDATA%\btcr2`, then the user
 *   profile), the native place for per-user application state.
 * - Linux / macOS: `~/.btcr2`, the short, teachable dot-directory in the same
 *   family as `~/.ssh`, `~/.aws`, and `~/.gnupg`.
 */
export function platformDefaultHome(): string {
  if (process.platform === 'win32') {
    const base = blankToUndef(process.env.LOCALAPPDATA)
      ?? blankToUndef(process.env.APPDATA)
      ?? homedir();
    return join(base, 'btcr2');
  }
  return join(homedir(), '.btcr2');
}

/**
 * Default config-file path: `<home>/config.json`. The `--config` flag, when
 * present, overrides it wholesale (it names a specific file, not a home).
 */
export function defaultConfigPath(overrides?: PathOverrides): string {
  return join(resolveHome(overrides), CONFIG_FILENAME);
}

/**
 * Default keystore path: `<home>/keystore.json`. The `--keystore` flag and a
 * profile's `identity.keystore` (resolved in `config.ts`) override it; this
 * function is the final fallback in that chain.
 */
export function defaultKeystorePath(overrides?: PathOverrides): string {
  return join(resolveHome(overrides), KEYSTORE_FILENAME);
}

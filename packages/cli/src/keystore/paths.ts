/**
 * The default keystore path now lives alongside the config file under a single
 * CLI home root (`<home>/keystore.json`, ADR 079). The implementation lives in
 * `../paths.ts` (the single source of truth for on-disk state locations); it is
 * re-exported here so existing `./paths.js` importers in the keystore layer keep
 * their import surface.
 */
export { defaultKeystorePath } from '../paths.js';

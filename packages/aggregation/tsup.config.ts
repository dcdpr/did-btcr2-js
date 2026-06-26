import { defineConfig } from 'tsup';

/**
 * CJS bundle build.
 *
 * The ESM + types output is produced by `tsc` (see `tsconfig.json`). This config
 * produces `dist/cjs/index.js` (the umbrella) and one CJS entry per role subpath
 * (`core`, `participant`, `service`), mirroring the package `exports` map. All
 * runtime dependencies (the workspace packages, `@scure/btc-signer`, `@noble/*`,
 * `nostr-tools`) ship a `require` export condition, so nothing needs to be
 * bundled inline.
 */
export default defineConfig({
  entry     : [
    'src/index.ts',
    'src/core/index.ts',
    'src/participant/index.ts',
    'src/service/index.ts',
  ],
  format    : ['cjs'],
  outDir    : 'dist/cjs',
  target    : 'node22',
  platform  : 'node',
  sourcemap : false,
  dts       : false,
  clean     : true,
  splitting : false,
  minify    : false,
  shims     : true,
  outExtension() {
    return { js: '.js' };
  },
});

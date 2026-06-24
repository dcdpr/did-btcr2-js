import { defineConfig } from 'tsup';

/**
 * CJS bundle build.
 *
 * The ESM + types output is produced by `tsc` (see `tsconfig.json`). This config
 * only produces `dist/cjs/index.js`. All runtime dependencies (the workspace
 * packages, `@scure/btc-signer`, `@noble/*`, `nostr-tools`) ship a `require` export
 * condition, so nothing needs to be bundled inline.
 */
export default defineConfig({
  entry     : ['src/index.ts'],
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

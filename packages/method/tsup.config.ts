import { defineConfig } from 'tsup';

/**
 * CJS bundle build.
 *
 * The ESM + types output is produced by `tsc` (see `tsconfig.json`).
 * This config only produces `dist/cjs/index.js` with ESM-only transitive
 * dependencies bundled inline so the output is usable via `require()`.
 *
 * Bundled-inline deps (no `require` export condition in their package.json):
 * - multiformats subpath exports
 *
 * `helia` and `@helia/strings` are intentionally NOT bundled — they are
 * lazy-loaded via `await import(...)` in `src/utils/appendix.ts` so Node's
 * runtime can resolve them as ESM without tsup trying to pull their native
 * (libp2p / node-datachannel) modules into the bundle.
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
  noExternal : [
    /^multiformats(\/|$)/,
  ],
});

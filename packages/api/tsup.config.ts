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
 * `helia` and `@helia/strings` are not used directly by api — they are only
 * reached via `@did-btcr2/method`, which lazy-loads them from `appendix.ts`.
 *
 * `@did-btcr2/*` workspace packages are kept external and resolved from
 * `node_modules` at runtime (they each produce their own CJS bundle).
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

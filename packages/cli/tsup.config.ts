import { defineConfig } from 'tsup';

/**
 * CJS bundle build for the library entry point.
 *
 * The ESM + types output is produced by `tsc` (see `tsconfig.json`), which
 * also handles the `bin/btcr2.ts` CLI entry (ESM only — it uses top-level
 * await and `import.meta.url`). This config only produces `dist/cjs/index.js`
 * for consumers that programmatically `require('@did-btcr2/cli')`.
 *
 * `shims: true` rewrites `import.meta.url` in `src/version.ts` to a CJS-safe
 * fallback using `__filename`.
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

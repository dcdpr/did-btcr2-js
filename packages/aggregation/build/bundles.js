import esbuild from 'esbuild';
import browserConfig from './esbuild-browser-config.cjs';

// esm polyfilled bundle for browser
esbuild.build({
    ...browserConfig,
    metafile: true,
    outfile: 'dist/browser.mjs',
});

// iife polyfilled bundle for browser
esbuild.build({
    ...browserConfig,
    format: 'iife',
    globalName: 'BTCR2Aggregation',
    outfile: 'dist/browser.js',
});

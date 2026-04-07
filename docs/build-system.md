# Build System

A detailed reference for how the `did-btcr2-js` monorepo is built, packaged, tested, and published. This document is intended for contributors, maintainers, and release engineers — anyone who needs to understand or modify the pipeline.

## Overview

`did-btcr2-js` is a pnpm workspace monorepo with 9 interdependent TypeScript packages that all publish to npm. Each package ships both ES Modules (the primary format) and CommonJS (for legacy `require()` consumers). Two packages (`method` and `api`) also ship pre-bundled browser builds.

The build system uses:

- **[pnpm](https://pnpm.io/)** — package manager + workspace orchestration
- **[TypeScript](https://www.typescriptlang.org/) 5.7+** — type checker and ESM compiler via `tsc --build` (project references)
- **[tsup](https://tsup.egoist.dev/)** — CJS bundler for packages with ESM-only transitive dependencies
- **[esbuild](https://esbuild.github.io/)** — direct invocation for browser bundles (via `build/bundles.js`)
- **[ESLint](https://eslint.org/)** — flat-config linter with `@typescript-eslint` + `eslint-plugin-mocha`
- **[mocha](https://mochajs.org/) + [chai](https://www.chaijs.com/) + [c8](https://github.com/bcoe/c8)** — test runner, assertion library, and V8 coverage
- **Node.js ≥ 22** — minimum runtime for development and for installed consumers

## Package dependency graph

The build order is determined by workspace dependencies declared in each package's `dependencies` block using `workspace:^`:

```
common          (no workspace deps)
├── keypair
│   ├── cryptosuite
│   ├── bitcoin
│   └── kms
├── smt
└── method
    └── api
        └── cli
```

When you run `pnpm build` from the repo root, pnpm walks this graph in topological order so every package is built before its consumers.

## tsconfig layout

There are **four shared base configs** at the repo root and four per-package configs in each package (`tsconfig.json`, `tsconfig.cjs.json`, `tests/tsconfig.json`, `lib/tsconfig.json`). Every per-package config extends one of the base configs; no per-package config copies compiler options.

```
tsconfig.base.json           — shared defaults (strict, ES2022, verbatim imports, project references)
tsconfig.base.cjs.json       — CJS overrides (module: CommonJS, Node10 resolution)
tsconfig.base.tests.json     — test overrides (types: node/mocha/chai, verbatim relaxed)
tsconfig.base.lib.json       — lib-script editor-only typecheck (noEmit, types: node)
tsconfig.json                — root solution file (`files: []` + `references: [ ... 9 packages ]`)

packages/<pkg>/tsconfig.json             — ESM build with `composite: true` + `references` to workspace deps
packages/<pkg>/tsconfig.cjs.json         — CJS build (5 packages only, see below)
packages/<pkg>/tests/tsconfig.json       — test build (emits to `tests/compiled/`)
packages/<pkg>/lib/tsconfig.json         — editor typecheck for lib scripts (no emit)
```

### `tsconfig.base.json` — shared compiler defaults

```jsonc
{
  "compilerOptions": {
    "target": "ES2022",
    "lib": ["ES2022", "DOM", "DOM.Iterable"],
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "moduleDetection": "force",
    "declaration": true,
    "declarationMap": true,
    "sourceMap": true,
    "esModuleInterop": true,
    "resolveJsonModule": true,
    "strict": true,
    "noImplicitOverride": true,
    "noFallthroughCasesInSwitch": true,
    "forceConsistentCasingInFileNames": true,
    "isolatedModules": true,
    "verbatimModuleSyntax": true,
    "skipLibCheck": true,
    "types": []
  }
}
```

**Key decisions:**
- `lib: ["ES2022", "DOM", "DOM.Iterable"]` — DOM types are available by default so browser-capable packages can use `fetch`, `URL`, `TextEncoder`, `structuredClone`, etc. Node-only packages override this to just `["ES2022"]`.
- `types: []` — no `@types/*` is automatically included. Each package explicitly opts in to `node`, `mocha`, `chai`, etc. This prevents test-only types from leaking into published `.d.ts` files.
- `verbatimModuleSyntax: true` — every type-only import must use `import type`. Enforced at build time by `tsc` and at lint time by `@typescript-eslint/consistent-type-imports`.
- `isolatedModules: true` — required for reliable tsup/esbuild transpilation (both are used for CJS and browser bundles).

### Per-package src `tsconfig.json` — project references

```jsonc
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "composite": true,
    "rootDir": "src",
    "outDir": "dist/esm",
    "declarationDir": "dist/types",
    "tsBuildInfoFile": "dist/.tsbuildinfo"
  },
  "include": ["src"],
  "references": [
    { "path": "../common" }
  ]
}
```

Every package has `composite: true`, so `tsc --build` can:
- Walk the `references` graph
- Cache incremental builds via `dist/.tsbuildinfo`
- Refuse to rebuild packages whose sources haven't changed
- Enforce that you can't import from a package you haven't declared as a reference

**Node-only package overrides** (`bitcoin`, `kms`, `cli`) add:
```jsonc
{
  "compilerOptions": {
    "lib": ["ES2022"],
    "types": ["node"]
  }
}
```
This excludes DOM globals and opts in to `@types/node`.

### Root solution file

```jsonc
// tsconfig.json (root)
{
  "files": [],
  "references": [
    { "path": "packages/common" },
    { "path": "packages/keypair" },
    { "path": "packages/cryptosuite" },
    { "path": "packages/bitcoin" },
    { "path": "packages/kms" },
    { "path": "packages/smt" },
    { "path": "packages/method" },
    { "path": "packages/api" },
    { "path": "packages/cli" }
  ]
}
```

Running `tsc -b` from the repo root builds the entire graph in topological order with incremental caching. This is exposed as `pnpm build:ts` in the root `package.json`.

## Build outputs

Each package produces up to four output directories, depending on type:

```
packages/<pkg>/dist/
├── esm/            # ES Modules (always produced — primary format)
├── cjs/            # CommonJS (only for packages where it's feasible — see below)
│   └── package.json  # { "type": "commonjs" } override so Node treats this subtree as CJS
├── types/          # .d.ts files with source maps (.d.ts.map)
├── browser.mjs     # method + api only — esbuild browser bundle
├── browser.js      # method + api only — legacy browser bundle
└── .tsbuildinfo    # tsc --build incremental cache (do not commit)
```

### ESM build

Every package produces its ESM output via `tsc -p tsconfig.json`. For the ESM path this is the only compiler — tsup is not used. Output lives under `dist/esm/` as `.js` files with `.js.map` source maps and declarations next to them in `dist/types/`.

### CJS build

**5 packages** build CJS via `tsc -p tsconfig.cjs.json`:
`common`, `keypair`, `bitcoin`, `kms`, `smt`

These packages have dependency graphs that are fully CJS-compatible, so a plain `tsc` invocation produces working CommonJS output. The post-build step `echo '{"type": "commonjs"}' > ./dist/cjs/package.json` writes a small `package.json` override so Node's module loader treats the `dist/cjs/` subtree as CommonJS regardless of the parent package's `"type": "module"` declaration.

**4 packages** build CJS via `tsup`:
`cryptosuite`, `method`, `api`, `cli`

These packages have **ESM-only transitive dependencies** (e.g. `multiformats/bases/base58` subpath exports, `helia` + `@helia/strings`) that cannot be consumed from CommonJS via a plain `require()`. `tsup` solves this by bundling the ESM-only deps directly into the CJS output file.

Each has a `tsup.config.ts`:

```typescript
import { defineConfig } from 'tsup';

export default defineConfig({
  entry      : ['src/index.ts'],
  format     : ['cjs'],
  outDir     : 'dist/cjs',
  target     : 'node22',
  platform   : 'node',
  sourcemap  : false,
  dts        : false,
  clean      : true,
  splitting  : false,
  minify     : false,
  shims      : true,
  outExtension() {
    return { js: '.js' };
  },
  noExternal : [
    /^multiformats(\/|$)/,
  ],
});
```

**`noExternal`** tells tsup which deps to bundle inline rather than leave as external `require()` calls. For example, `cryptosuite` bundles `multiformats`; `method` bundles `multiformats` but leaves `helia` external (see below).

**`outExtension`** overrides tsup's default `.cjs` extension with `.js` so the output matches the tsc-built packages. The `dist/cjs/package.json` override handles the ESM-vs-CJS distinction at runtime.

**`shims: true`** rewrites ESM-only constructs like `import.meta.url` into CJS-compatible equivalents (`__filename`/`__dirname`).

#### The helia lazy-load pattern

`method` depends on `helia` and `@helia/strings`, which transitively pull in `@libp2p/*` packages, which in turn load native `.node` binaries (`node-datachannel`). These native modules can't be statically bundled into a single CJS file — their `require('./build/Release/node_datachannel.node')` paths would break.

The solution is in `packages/method/src/utils/appendix.ts`:

```typescript
static async fetchFromCas(hashBytes: HashBytes): Promise<string | undefined> {
  const cid = CID.create(1, 1, createDigest(1, hashBytes));

  // Lazy-load helia to avoid bundling its native deps into downstream CJS builds.
  const { createHelia } = await import('helia');
  const { strings } = await import('@helia/strings');

  const helia = await createHelia();
  const node = strings(helia);
  return await node.get(cid, {});
}
```

`helia` and `@helia/strings` are **dynamic imports**, not top-level imports. tsup leaves dynamic imports alone at bundle time. At runtime, Node 22+ natively supports `await import(esm)` from a CJS context, so the lazy load works in both the ESM and CJS builds of `method`. CJS consumers who never call `fetchFromCas()` never pay the cost of loading helia at all.

### Browser bundles

The `method` and `api` packages ship `dist/browser.mjs` + `dist/browser.js` bundles for use in browser runtimes. These are produced by `build/bundles.js` — a Node script that invokes `esbuild` directly. The esbuild config uses `platform: 'browser'`, polyfills Node built-ins via `node-stdlib-browser`, and bundles everything into a single file.

Browser bundles are **not** used by `tsc`, `tsup`, or the regular ESM/CJS consumer paths. They are a separate, parallel build artifact, exposed via the `"browser"` condition in each package's `exports` field.

### Published package shape

Every package's `package.json` exposes the three (or four) formats via the `exports` field:

```jsonc
{
  "main": "./dist/cjs/index.js",
  "module": "./dist/esm/index.js",
  "types": "./dist/types/index.d.ts",
  "exports": {
    ".": {
      "types": "./dist/types/index.d.ts",
      "browser": "./dist/browser.mjs",   // method + api only
      "import": "./dist/esm/index.js",
      "require": "./dist/cjs/index.js"
    }
  }
}
```

Node and bundlers use the `exports` field to pick the right entry based on the consumer's module type. The `main` and `module` fields are legacy fallbacks.

## Test pipeline

Tests live in `packages/<pkg>/tests/` as `*.spec.ts` files. The pipeline is:

1. **`pnpm build:tests`** — each package runs `tsc -p tests/tsconfig.json` which compiles both `src/**/*.ts` and `tests/**/*.ts` into `tests/compiled/`. This includes the src files (so the tests can import from `../src/index.js` at runtime).
2. **`pnpm test`** — each package runs `pnpm c8 mocha`. Mocha reads `.mocharc.json` in the package root, which points at `tests/compiled/**/*.spec.js`. c8 collects V8 coverage on the compiled JS and prints a coverage table.

**Critical workflow note:** the test runner executes compiled JavaScript, not TypeScript directly. If you change a source or test file and run `pnpm test` without `pnpm build:tests` first, you are running the stale compiled output. The single-package convenience script `pnpm build:test` (singular) chains both: `pnpm build && pnpm build:tests && pnpm c8 mocha`.

### Running a single test file

From inside a package directory:

```bash
pnpm c8 mocha tests/compiled/tests/<spec-name>.spec.js
```

Note the `tests/compiled/tests/<spec>` path — because the test tsconfig compiles both `../src` and `.` into `compiled/`, the spec files end up at `compiled/tests/`, not directly under `compiled/`.

## Linting

A single root-level `eslint.config.cjs` applies to all packages. Key rules:

- **Code style:** 2-space indent, single quotes, semicolons, colon-aligned key spacing in multi-line objects
- **Type discipline:** `@typescript-eslint/consistent-type-imports` with `separate-type-imports` autofix — enforces `import type` for type-only imports (paired with `verbatimModuleSyntax` in tsconfig)
- **Unused vars:** error, except when prefixed with `_`
- **Mocha rules:** `mocha/no-exclusive-tests` as a warning (catches accidentally-committed `.only` calls)

Each package has a `pnpm lint` script that runs `eslint . --max-warnings 0` (zero warnings allowed). Autofix is available via `pnpm lint:fix`.

## Build commands

### Root-level (from monorepo root)

| Command | What it does |
|---|---|
| `pnpm build` | Runs `pnpm --recursive --stream build` — per-package build via pnpm, topologically ordered |
| `pnpm build:ts` | Runs `tsc -b` — incremental build via project references (faster for iterative work) |
| `pnpm build:ts:watch` | Incremental build in watch mode |
| `pnpm build:ts:clean` | Clean all `.tsbuildinfo` + `dist/` outputs |
| `pnpm build:ts:force` | Force full rebuild, ignoring incremental caches |
| `pnpm build:tests` | Per-package `pnpm build:tests` — compiles each package's tests |
| `pnpm build:all` | `pnpm build && pnpm build:tests` combined |
| `pnpm test` | Run all tests with coverage |
| `pnpm lint` | Lint all packages with zero-warning tolerance |
| `pnpm lint:fix` | Lint + autofix |
| `pnpm clean` | Remove all `dist/`, `tests/compiled/`, `coverage/` directories |

### Per-package (from a package directory)

| Command | What it does |
|---|---|
| `pnpm build` | Full build: clean → ESM → CJS → (browser if applicable) |
| `pnpm build:esm` | ESM only, via `tsc -p tsconfig.json` |
| `pnpm build:cjs` | CJS only, via `tsc -p tsconfig.cjs.json` or `tsup` |
| `pnpm build:browser` | (method + api only) esbuild browser bundle |
| `pnpm build:tests` | Compile tests to `tests/compiled/` |
| `pnpm test` | Run tests (requires prior `build:tests`) |
| `pnpm build:test` | Full build + build:tests + test in one command |
| `pnpm lint` | Lint this package |
| `pnpm release` | Build and pack into `release/<pkg>/*.tgz` |

## Publishing

Each package's release flow is driven by its `release` script:

```json
"release": "pnpm build && pnpm pack && mv *.tgz ../../release/<pkg>"
```

This produces a `.tgz` tarball under the monorepo's `release/` directory. Actual `npm publish` is run manually by a maintainer.

**Recommended publish order** (respecting the dependency graph):
```
common → keypair → {cryptosuite, bitcoin, kms, smt} → method → api → cli
```

Workspace protocol versions (`workspace:^`) are rewritten to their concrete semver during `pnpm pack`, so published tarballs contain proper `^X.Y.Z` dep declarations.

## Development workflow — putting it all together

Typical iterative development loop:

```bash
# One-time setup
pnpm install

# Make source changes in packages/<pkg>/src/...

# Fast incremental rebuild of everything
pnpm build:ts

# Or in watch mode
pnpm build:ts:watch

# Run tests for a single package
cd packages/method
pnpm build:tests && pnpm test

# Lint everything before committing
pnpm lint
# ...or with autofix
pnpm lint:fix
```

When you're about to publish a release:

```bash
# Full clean slate rebuild
pnpm clean
pnpm build         # per-package build (hits all code paths)
pnpm build:tests   # compile tests
pnpm test          # run tests
pnpm lint          # zero warnings
pnpm build:ts      # verify tsc -b is also clean
```

## Browser bundle caveats

The `method` and `api` browser bundles are large (several MB each). Reducing them is on the [TODO roadmap](#). If you're consuming did:btcr2 from a browser app and bundle size matters, use a bundler like Vite, webpack, or esbuild directly with the package's `import` entry (`./dist/esm/index.js`) and let your bundler tree-shake.

The `"browser"` condition in `exports` exists for consumers that can't run a Node build. Prefer the ESM entry if you can.

## Troubleshooting

### "Cannot find module 'X'" after `pnpm install`

Try `pnpm install --force` to rebuild the symlink tree. If the error mentions a `@did-btcr2/*` package, make sure you've run `pnpm build` at least once (workspace deps resolve to `dist/esm/index.js`, which doesn't exist until the first build).

### `require()` of a package fails with "Cannot find module X"

You're probably trying to `require()` a package whose `dist/cjs/` was not built. Check that the package's `build:cjs` script ran successfully — for tsup-based packages, check for errors in the bundled output. If the package is `cryptosuite`, `method`, `api`, or `cli`, the bundler is tsup; everywhere else it's tsc.

### `tsc -b` reports the same errors repeatedly

Try `pnpm build:ts:force` to bypass the incremental cache, or `pnpm build:ts:clean && pnpm build:ts` for a full clean rebuild.

### Test runner says "Cannot find module '../src/index.js'"

You forgot to run `pnpm build:tests` before `pnpm test`. The test compiler includes both `../src` and `.` in its `include` and emits to `tests/compiled/{src,tests}/` — without that step, the runtime import paths don't exist.

### ESLint reports a `consistent-type-imports` violation after a refactor

Run `pnpm lint:fix` to have ESLint rewrite mixed imports into separate `import type` + `import` statements. If the autofix can't decide, manually split the import into two statements.

## Further reading

- [pnpm workspaces](https://pnpm.io/workspaces) — the underlying workspace mechanism
- [TypeScript project references](https://www.typescriptlang.org/docs/handbook/project-references.html) — the basis for `tsc -b`
- [tsup documentation](https://tsup.egoist.dev/) — configuration reference for the CJS bundler
- [Node.js module resolution](https://nodejs.org/api/packages.html#packages_package_entry_points) — how `exports` conditions work at runtime
- Root [CLAUDE.md](../CLAUDE.md) — contributor guide with build/test quick reference

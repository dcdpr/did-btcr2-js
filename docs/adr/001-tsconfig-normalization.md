---
title: "ADR 001: tsconfig Normalization and CJS via tsup"
---

# ADR 001 — tsconfig Normalization, Project References, and CJS via tsup

**Status:** Accepted
**Date:** 2026-04-08
**Branch / PR:** `chore/lib-tsconfig-node-types`

## Context

Prior to this decision, the monorepo's TypeScript configuration had drifted significantly:

- 36 per-package tsconfig files with massive duplication and no shared base
- 8 of 9 src configs had no explicit `types` array → every `@types/*` package leaked into every build
- No explicit `lib` array → DOM globals were silently available in node-only packages (`bitcoin`, `kms`, `cli`)
- CJS build configs (`tsconfig.cjs.json`) inherited `module: NodeNext` from the root and produced ESM-syntax output that was tricked into being treated as CJS via a post-hoc `dist/cjs/package.json` override — but four packages (`cryptosuite`, `method`, `api`, `cli`) had this CJS output silently broken at runtime because their transitive dependencies (`multiformats` subpath exports, `helia`) are ESM-only and could not be `require()`'d
- No TypeScript project references — `tsc` ran 9 times from scratch on every build
- Two orphan tsconfig files in directories with zero `.ts` files (`api/lib/`, `smt/lib/`)

The accumulated drift made the build system fragile, the publish surface dishonest (CJS published but broken), and onboarding contributors difficult.

## Decision

A monorepo-wide normalization landed in five commits on the `chore/lib-tsconfig-node-types` branch. Key choices:

### 1. Four shared base tsconfig files at the repo root

```
tsconfig.base.json           — shared compiler defaults
tsconfig.base.cjs.json       — CJS overrides (module: CommonJS, Node10 resolution)
tsconfig.base.tests.json     — test overrides (types: node/mocha/chai, verbatim relaxed)
tsconfig.base.lib.json       — lib script editor-only typecheck (noEmit, types: node)
```

Every per-package config extends one of these bases. No per-package config copies compiler options.

### 2. Project references with `composite: true` and `tsBuildInfoFile`

Each package's `tsconfig.json` declares `composite: true` and lists its workspace dependencies in a `references` array. The root `tsconfig.json` is a solution file (`files: []` + `references: [ ... 9 packages ]`). Running `tsc -b` from the root walks the dependency graph and rebuilds only the changed packages.

This was exposed via four root scripts: `build:ts`, `build:ts:watch`, `build:ts:clean`, `build:ts:force`.

### 3. Strict compiler flags

Enabled in the base config:

- `noImplicitOverride: true`
- `noFallthroughCasesInSwitch: true`
- `forceConsistentCasingInFileNames: true`
- `isolatedModules: true`
- `verbatimModuleSyntax: true`
- `moduleDetection: "force"`

`verbatimModuleSyntax` is the largest cascade — it forced ~380 source files to split mixed `import { Type, value }` statements into separate `import type` and `import` statements. This was applied via the `@typescript-eslint/consistent-type-imports` ESLint rule with the `separate-type-imports` autofix.

### 4. Explicit `lib` and `types`

The root sets `lib: ["ES2022", "DOM", "DOM.Iterable"]` and `types: []`. Browser-compatible packages inherit the defaults. Node-only packages (`bitcoin`, `kms`, `cli`) override with `lib: ["ES2022"]` + `types: ["node"]` to exclude DOM globals.

This stops `@types/*` packages from auto-leaking into builds and makes each package's runtime contract explicit.

### 5. CJS via tsup for the four ESM-only-dep packages

`cryptosuite`, `method`, `api`, and `cli` cannot produce working CJS via plain `tsc` because their transitive dependencies (`multiformats` subpath exports, `helia`) only define `import` conditions in their `package.json` `exports` fields. Plain `require()` of these packages fails at runtime.

The fix: introduce `tsup` as a devDependency in those four packages and use it to **bundle the ESM-only dependencies inline** into the CJS output. tsup is invoked via a per-package `tsup.config.ts` and a `build:cjs` script that replaces the `tsc -p tsconfig.cjs.json` invocation. The other five packages (`common`, `keypair`, `bitcoin`, `kms`, `smt`) continue to use `tsc` for CJS — their dep graphs are CJS-compatible without bundling.

A subtlety: `helia` and `@helia/strings` use native modules (`libp2p` → `node-datachannel`) that can't be statically bundled. To work around this, `method/src/utils/appendix.ts` was refactored to **lazy-load** them via dynamic `import()` so tsup doesn't pull the native deps into the bundle. Node 22+ supports `await import(esm)` from CJS contexts, so the lazy load works at runtime in both the ESM and CJS builds.

### 6. Two orphan tsconfigs deleted

`api/lib/tsconfig.json` and `smt/lib/tsconfig.json` pointed at directories with zero `.ts` files. Deleted.

## Consequences

**Positive:**

- All 9 packages now publish real, working CJS via `require()`. Previously 5/9 worked, 4/9 were broken.
- Build is faster via project references — incremental rebuilds only touch changed packages.
- Type discipline is enforced at compile time (`verbatimModuleSyntax`) and lint time (`consistent-type-imports`).
- Node-only packages can no longer accidentally use DOM globals (and vice versa).
- The `@types/*` leakage is fixed — published `.d.ts` files no longer carry test-framework types.
- The CJS build is no longer dishonest. What we publish is what consumers can use.

**Negative:**

- One-time migration cost: ~380 file changes for the `import type` cascade.
- `tsup` is now a build-time dependency in 4 packages (small impact — tsup itself has few transitive deps).
- The CJS extension is `.js` (not `.cjs`), which still requires the `dist/cjs/package.json` `{"type": "commonjs"}` override hack to tell Node how to interpret the files. A future cleanup could migrate all 9 packages to tsup, switch the extension to `.cjs`, and drop the override entirely. Tracked in `TODO.md`.
- `appendix.ts` `fetchFromCas()` now does dynamic `import()` instead of static — slightly more cognitive overhead at the call site, but it's the only place this pattern is needed and the comment block explains why.

## Alternatives considered

- **Drop CJS entirely from the four ESM-only-dep packages.** Considered and partially adopted in an earlier iteration. Rejected because it's a breaking change for consumers (removes the `require` export condition), even though those consumers could never have used CJS successfully anyway. The tsup approach restores the ability to claim dual ESM/CJS publishing without breaking shape.
- **Migrate to Bun for both runtime and bundling.** Considered. Rejected because (a) `did:btcr2` is a reference implementation that needs to behave identically to consumers' Node runtime, (b) several native deps in the chain may not work cleanly under Bun, (c) the migration cost outweighs the benefit for a published library.
- **Keep using `typedoc-vitepress-theme` for docs.** Considered. Rejected because the docs site was being rebuilt anyway as a contributor-only resource (see ADR 002, forthcoming) and the simpler TypeDoc + `projectDocuments` approach is a better fit.

## Verification

- `pnpm build` — all 9 packages build cleanly
- `pnpm build:ts` — incremental tsc build via project references is clean
- `pnpm build:tests && pnpm test` — 810 tests passing
- `pnpm lint` — zero warnings monorepo-wide
- Runtime smoke test — `require()` and `import()` both work for all 9 packages
- CLI binary `btcr2 --version` returns the correct version

## References

- [`docs/contributing/build-system.md`](../contributing/build-system.md) — full build pipeline documentation
- TypeScript [Project References](https://www.typescriptlang.org/docs/handbook/project-references.html) docs
- [tsup documentation](https://tsup.egoist.dev/)
- [`verbatimModuleSyntax` TypeScript option](https://www.typescriptlang.org/tsconfig/#verbatimModuleSyntax)

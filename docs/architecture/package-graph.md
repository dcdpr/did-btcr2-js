---
title: Package Graph
---

# Package Graph

This page documents the inter-package dependency graph for the `did-btcr2-js` monorepo. Understanding it is essential when:

- Building the monorepo (the build runs in topological order)
- Publishing a release (publish in topological order so each consumer sees its updated dependency)
- Adding a new cross-package import (you must declare it in the consumer's `dependencies` AND add a TypeScript project reference to its `tsconfig.json`)

## The graph

```
std          (no workspace dependency)
smt          (no workspace dependency)
keys         -> std
bitcoin      -> std
integrity    -> keys
key-manager  -> keys
method       -> integrity, bitcoin, smt
aggregation  -> integrity, bitcoin, smt
api          -> method, key-manager
cli          -> api
```

`a -> b` means that `a` depends on `b`. The drawing omits an edge if a longer path covers it. For example, `method` also depends on `std` and `keys`, and the path through `integrity` covers these edges. The table below lists each declared dependency. `std` and `smt` have no upstream workspace dependency. `cli` is at the end of the longest path.

## Per-package dependencies

| Package | Workspace dependencies | Dev dependencies | Role |
|---|---|---|---|
| `std` | _(none)_ | _(none)_ | Foundation: depends on nothing |
| `smt` | _(none)_ | _(none)_ | Self-contained; uses `@noble/*` directly |
| `keys` | `std` | _(none)_ | Used by all crypto-touching packages |
| `integrity` | `std`, `keys` | _(none)_ | Data Integrity proofs |
| `bitcoin` | `std` | `keys` | Bitcoin RPC/REST clients |
| `key-manager` | `std`, `keys` | _(none)_ | Key management |
| `method` | `std`, `keys`, `integrity`, `bitcoin`, `smt` | _(none)_ | Core implementation |
| `aggregation` | `std`, `keys`, `integrity`, `bitcoin`, `smt` | `method` | Multi-party aggregate beacons (MuSig2) |
| `api` | `std`, `keys`, `integrity`, `bitcoin`, `key-manager`, `method`, `smt` | _(none)_ | High-level SDK facade |
| `cli` | `api`, `key-manager` | _(none)_ | Binary entry point |

All workspace dependencies use the `workspace:^` protocol in `package.json`. At publish time, pnpm rewrites these to concrete semver ranges in the published tarballs.

## Build order

The build runs in topological order. pnpm also sorts by the dev dependencies. The packages of one wave can build in parallel:

```
Wave 1: std, smt                         (no workspace dependency)
Wave 2: keys                             (depends on std)
Wave 3: integrity, bitcoin, key-manager  (keys is a dependency or a dev dependency)
Wave 4: method                           (depends on integrity, bitcoin, and smt)
Wave 5: aggregation, api                 (method is a dependency or a dev dependency)
Wave 6: cli                              (depends on api)
```

When you run `pnpm build` from the repo root, pnpm walks this graph automatically. When you run `pnpm build:ts`, TypeScript's project references mechanism walks the same graph (declared in the `references` field of each `tsconfig.json`) and uses incremental caches via `dist/.tsbuildinfo` to skip unchanged packages.

## Publish order

Same as build order, but with the additional constraint that you cannot publish a package whose updated dependency is not yet on npm. The recommended manual sequence:

```
std to smt to keys to integrity to bitcoin to key-manager to method to aggregation to api to cli
```

`pnpm -r publish` does this automatically: workspace deps are resolved in topological order.

## Cross-package imports: rules

When you add a new import from package A to package B (e.g., `import { Foo } from '@did-btcr2/bar'` in `packages/foo/src/index.ts`), you must:

1. **Add B to A's `package.json` `dependencies`** with the `workspace:^` protocol:
   ```json
   "@did-btcr2/bar": "workspace:^"
   ```
2. **Add B as a TypeScript project reference** in A's `tsconfig.json`:
   ```json
   "references": [
     { "path": "../bar" }
   ]
   ```
3. **Run `pnpm install`** so pnpm refreshes the symlink in `packages/foo/node_modules/@did-btcr2/bar`.
4. **Run `pnpm build:ts`** to verify the project reference resolves and B is built before A.

If you skip step 2, the build will fail at runtime (because B's `dist/` doesn't exist when A tries to consume it). If you skip step 1, pnpm won't create the symlink and the import will fail to resolve.

## Cycles

The dependency graph is intentionally acyclic. **Don't introduce cycles.** If you find yourself wanting to import from a downstream package back into an upstream one, the right answer is almost always:

- Move the shared type/utility into a more upstream package (often `std`)
- Or restructure the abstraction so the dependency arrow points the correct way (often via dependency injection: pass the downstream concern in as a parameter rather than importing it)

TypeScript project references would catch a cycle attempt at build time, but it's better to think about the design before the type checker has to enforce it.

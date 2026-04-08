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
common
├── keypair
│   ├── cryptosuite ──────────┐
│   ├── bitcoin ──────────────┤
│   └── kms ──────────────────┤
├── smt ──────────────────────┤
└── method <─────common,keypair,cryptosuite,bitcoin
    └── api <─────common,keypair,cryptosuite,bitcoin,kms,method,smt
        └── cli <─common,api,cryptosuite,method
```

The `<─` arrows show "depends on" — `method` depends on `common`, `keypair`, `cryptosuite`, and `bitcoin`. The leftmost packages have no upstream workspace dependencies; the rightmost (`cli`) has the most.

## Per-package dependencies

| Package | Workspace dependencies | Direction |
|---|---|---|
| `common` | _(none)_ | Foundation — depends on nothing |
| `keypair` | `common` | Used by all crypto-touching packages |
| `cryptosuite` | `common`, `keypair` | Data Integrity proofs |
| `bitcoin` | `common`, `keypair` | Bitcoin RPC/REST clients |
| `kms` | `common`, `keypair` | Key management |
| `smt` | _(none — no workspace deps)_ | Self-contained; uses `@noble/*` directly |
| `method` | `common`, `keypair`, `cryptosuite`, `bitcoin` | Core implementation |
| `api` | `common`, `keypair`, `cryptosuite`, `bitcoin`, `kms`, `method`, `smt` | High-level SDK facade |
| `cli` | `common`, `cryptosuite`, `method`, `api` | Binary entry point |

All workspace dependencies use the `workspace:^` protocol in `package.json`. At publish time, pnpm rewrites these to concrete semver ranges in the published tarballs.

## Build order

The build proceeds in topological order. Three "waves" can run in parallel within each:

```
Wave 1: common
Wave 2: keypair, smt              (parallel — both only depend on common or nothing)
Wave 3: cryptosuite, bitcoin, kms (parallel — all depend on common + keypair)
Wave 4: method                    (depends on cryptosuite + bitcoin from wave 3)
Wave 5: api                       (depends on method + kms + smt)
Wave 6: cli                       (depends on api)
```

When you run `pnpm build` from the repo root, pnpm walks this graph automatically. When you run `pnpm build:ts`, TypeScript's project references mechanism walks the same graph (declared in each `tsconfig.json`'s `references` field) and uses incremental caches via `dist/.tsbuildinfo` to skip unchanged packages.

## Publish order

Same as build order, but with the additional constraint that you cannot publish a package whose updated dependency is not yet on npm. The recommended manual sequence:

```
common → keypair → smt → cryptosuite → bitcoin → kms → method → api → cli
```

`pnpm -r publish` does this automatically — workspace deps are resolved in topological order.

## Cross-package imports — rules

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

- Move the shared type/utility into a more upstream package (often `common`)
- Or restructure the abstraction so the dependency arrow points the correct way (often via dependency injection — pass the downstream concern in as a parameter rather than importing it)

TypeScript project references would catch a cycle attempt at build time, but it's better to think about the design before the type checker has to enforce it.

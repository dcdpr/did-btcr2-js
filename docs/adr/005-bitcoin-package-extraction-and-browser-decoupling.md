---
title: "ADR 005: Bitcoin Package Extraction and Browser Decoupling"
---

# ADR 005: Bitcoin Package Extraction and Browser Decoupling

**Status:** Accepted

**Date:** 2025-09-18

**Commits:** [`faff3be`](https://github.com/dcdpr/did-btcr2-js/commit/faff3be), [`0d957d6`](https://github.com/dcdpr/did-btcr2-js/commit/0d957d6)

## Context

At inception (see [ADR 001](001-monorepo-package-boundaries.md)) the project was organized as a pnpm workspace, but not all of today's layer-one packages existed yet. Bitcoin client code: REST (Esplora) and RPC (Bitcoin Core): originally lived inside `packages/method/lib/bitcoin/*` as a subdirectory of the method package. Several practical problems accumulated:

1. **Browser consumers pulled in the full Bitcoin client surface.** Any bundler following `@did-btcr2/method` imports reached down into the embedded Bitcoin code, which imported `node:http`, `node:https`, and JSON-RPC transport code that does not exist in browsers. Browser builds either failed at bundle time or silently broke at runtime when the client actually tried to open a socket.
2. **Dual-build complexity.** The initial browser-compatibility attempt was a two-file pattern: `bitcoin.node.ts` and `bitcoin.browser.ts`, with separate `index.node.ts` / `index.browser.ts` entry points. Bundlers were expected to pick the right one based on a `"browser"` field in `package.json`. This works until it doesn't: some bundlers honor the field, some don't, and the method package couldn't rely on either branch existing for its consumers.
3. **Consumer surface was wrong.** A wallet that just wants to *resolve* a DID shouldn't care that `method` can also drive a Bitcoin Core RPC connection. The monorepo's intent (ADR 001) was that layer-one concerns be installable independently. Bitcoin-as-subdirectory blocked that.
4. **Testing was tangled.** Tests for Bitcoin client behavior had to live under the method package, even though they had nothing to do with DID resolution. Method's test suite carried the full setup burden for the Bitcoin clients.

There were two distinct decisions to make, and they landed two days apart: which is why this ADR covers both commits:

- **`faff3be` (2025-09-16)**: should Bitcoin client code live inside `method` or as its own package?
- **`0d957d6` (2025-09-18)**: given a separate package, should the package ship two builds (node + browser) or one universal build?

## Options considered

**For the extraction:**

1. **Leave Bitcoin code inside `method`.** Simplest; blocks browser consumers of `method` and muddles the consumer surface.
2. **Extract to `@did-btcr2/bitcoin` with its own versioning.** Clean layer boundary, independent testing, independent publishing; adds one more package to maintain.

**For the build shape (after extraction):**

1. **Keep dual builds (`bitcoin.node.ts` + `bitcoin.browser.ts`), rely on `"browser"` field.** Bundler-dependent resolution, fragile across consumers. Duplication between the two files drifts.
2. **Ship one module that uses only cross-runtime APIs** (`globalThis.fetch`, platform crypto), with any Node-specific helpers confined to `lib/` scripts that aren't part of the library's public surface. Single source of truth.

## Decision

**Extraction: Option 2.** Bitcoin code moves out of `packages/method/lib/bitcoin/` into a new `@did-btcr2/bitcoin` package on 2025-09-16 (commit `faff3be`). The package scope is the full Bitcoin-client surface: REST (Esplora) client, RPC (Bitcoin Core) client, JSON-RPC transport, network constants, shared error types, and the Bitcoin utilities. `method` declares `@did-btcr2/bitcoin` as a workspace dependency.

**Build shape: Option 2.** Two days later (commit `0d957d6`), the dual-build pattern is collapsed:

- `packages/bitcoin/src/bitcoin.node.ts`: **deleted**.
- `packages/bitcoin/src/bitcoin.browser.ts` to **renamed** to `bitcoin.ts` as the single entry point.
- `packages/bitcoin/src/index.node.ts` and `packages/bitcoin/src/index.browser.ts`: **deleted**.
- A single `index.ts` replaces both.

At the same time, the large monolithic `rest-client.ts` (420 lines) and `rpc-client.ts` (888 lines) are broken up into modular sub-clients (`client/rest/{address,block,transaction,index}.ts` and `client/rpc/{index,interface,json-rpc}.ts`). The decomposition is needed anyway: the monoliths were hard to test and hard to reuse: but it also makes the "single module, no Node-only APIs" rule practical to enforce in code review.

The method package's browser build no longer reaches into Node-only Bitcoin code because that code no longer exists; what remains in `@did-btcr2/bitcoin` is runtime-universal.

## Consequences

**Positive**
- `method` becomes publishable as a browser-safe package. Consumers that only need to *resolve* a DID in a browser no longer drag Node-only Bitcoin internals into their bundle.
- The consumer surface matches the layer intent described in [ADR 001](001-monorepo-package-boundaries.md). Wallets pull only what they use.
- Single-module builds eliminate the bundler-field fragility. The package behaves the same regardless of which bundler a consumer uses.
- Bitcoin-client tests live with Bitcoin-client code. A change to JSON-RPC handling runs its own test suite without touching the method package.
- The decomposition of `rest-client.ts` and `rpc-client.ts` into sub-clients sets up the shape that later becomes the sans-I/O protocol layer (see [ADR 009](009-sans-io-bitcoin-transport-foundation.md)).

**Negative**
- One more package to version, publish, and keep in sync. Co-evolution is managed through `workspace:^` semver ranges (the broader policy is described in [ADR 001](001-monorepo-package-boundaries.md)).
- The rename from `bitcoin.browser.ts` to `bitcoin.ts` deletes legitimate-looking history in a `git log --follow`; contributors reading historical blame across the September 2025 window have to know that `faff3be`/`0d957d6` is a boundary point.
- Consumers pinned to `@did-btcr2/method@<0.15` who also interacted with embedded Bitcoin code directly had to migrate their imports. No `@did-btcr2/bitcoin` re-export was added inside `method`.

**Explicitly accepted trade-offs**
- **No built-in Node-only entry for RPC convenience.** Operators wanting a Node-native Bitcoin Core RPC client build it on top of the universal module: the platform's `fetch` does the wire-level work. Any Node-specific conveniences (e.g., reading `bitcoin.conf` for RPC credentials) belong in consumer code or `lib/` scripts, not the library.
- **One package per layer-one concern.** The Bitcoin package does not further subdivide into `bitcoin-rest` / `bitcoin-rpc`. Both are Bitcoin-client concerns and version together; splitting them would be a distinction without a consumer benefit.
- **ADR 001 is not amended to reflect the timeline.** The original ADR describes the current structure and was deliberately written as if inception-and-present were one state. The actual extraction happened here, on 2025-09-18; readers tracking chronology should treat ADR 001 as aspirational-at-inception and this ADR as the moment the aspiration became fact for the Bitcoin layer.

## References

- `packages/bitcoin/`: the package that resulted.
- Commit `faff3be` (2025-09-16): initial extraction.
- Commit `0d957d6` (2025-09-18): dual-build consolidation and client decomposition.
- [ADR 001](001-monorepo-package-boundaries.md): the monorepo structure this extraction realizes for the Bitcoin layer.
- [ADR 019](019-browser-compat-and-noble.md): later formalization of the "no Node-only APIs in library source" constraint that this ADR first enforced for Bitcoin code.
- [ADR 009](009-sans-io-bitcoin-transport-foundation.md): the sans-I/O rewrite of the Bitcoin transport layer built on top of the modular sub-clients introduced here.

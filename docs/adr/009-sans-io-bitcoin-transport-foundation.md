---
title: "ADR 009: Sans-I/O Foundation at the Bitcoin Transport Layer"
---

# ADR 009: Sans-I/O Foundation at the Bitcoin Transport Layer

**Status:** Accepted

**Date:** 2025-11-25

**Commit:** [`190de07`](https://github.com/dcdpr/did-btcr2-js/commit/190de07)

## Context

Once the Bitcoin client was its own package ([ADR 005](005-bitcoin-package-extraction-and-browser-decoupling.md)), the next problem surfaced: the package was still doing I/O inline. Every REST call and every RPC call:

- Called `fetch()` directly.
- Captured its own timeout and retry semantics in ad-hoc code.
- Left callers with no way to substitute transport behavior (for tests, for proxies, for caching intermediaries) except by monkey-patching the global `fetch`.
- Interleaved "build the request" logic with "send the request" logic, so a unit test could not verify the request shape without also running an HTTP server.

Four concrete pains came from this shape:

1. **Tests monkey-patched global `fetch`.** Every spec file had its own save/restore dance. A thrown error leaked a stub into the next test. CI flakes tracked back to this more than once.
2. **`BitcoinNetworkConnection` juggled multiple networks simultaneously.** One object held connections for mainnet, testnet, signet, regtest: a leftover from earlier design where the resolver picked network at call time. In practice every caller used exactly one network, and the multi-network object was pure ceremony.
3. **RPC code was not ergonomic.** RPC responses were loosely typed; JSON-RPC batching was simulated with sequential calls; error mapping (Bitcoin Core returns specific code to we want a typed error) happened in several places with minor variations.
4. **The API facade was monolithic.** `@did-btcr2/api` exposed a single flat surface (`api.create`, `api.resolve`, `api.update`, `api.keyManager`, `api.multikey`, ...). Adding a new concern meant growing that flat surface indefinitely.

The decision window was also the first opportunity to formalize a serialization convention across packages. Several classes (keypair, DID document, multikey, signed updates) were being passed into canonicalization and into `JSON.stringify` with inconsistent results: some had `toJSON()`, some didn't, some leaked secret material. A ground-truth convention was overdue.

## Options considered

1. **Keep direct `fetch`; add retry/timeout inline; leave tests monkey-patching.** Minimal change. Every existing pain persists. Each new test adds another monkey-patch.
2. **Wrap `fetch` in a thin executor class with retry/timeout, inject through constructors.** Solves the test-seam problem but still interleaves request-building with request-sending; still no way to unit-test request shape without running the executor.
3. **Separate "what request to make" from "how to send it": a pure *protocol layer* that produces request descriptors, and a *transport* that executes them. Inject the transport; make the protocol layer pure.** Tests drive the protocol layer directly; transports are swappable; the protocol layer is trivially fuzzable.

## Decision

**Option 3.** Commit `190de07` lands six coordinated changes that together establish sans-I/O as the pattern for transport-adjacent code in the monorepo:

**1. `HttpExecutor` abstraction.**
A minimal interface: effectively `(HttpRequest) => Promise<HttpResponse>`: that the Bitcoin package accepts via constructor injection. The default executor wraps `globalThis.fetch` with `AbortSignal.timeout()` for deadlines. Tests pass a scripted executor that returns canned responses. No global monkey-patching.

**2. `EsploraProtocol` and `RpcProtocol` (sans-I/O).**
Pure request-builder classes. `EsploraProtocol.getAddressTxs(address)` returns a `HttpRequest` describing method, path, query, headers: and that's all. The caller (the REST client) sends it through the `HttpExecutor`. Unit tests on the protocol layer don't need a transport at all; they assert on the descriptor shape. This is the pattern that later migrates to the `Resolver` ([ADR 016](016-sans-io-resolver.md)) and `Updater` ([ADR 025](025-sans-io-updater.md)) state machines, and to the HTTP server primitives ([ADR 032](032-sans-io-server-primitives.md)).

**3. Single-network `BitcoinConnection` replaces multi-network `BitcoinNetworkConnection`.**
One instance = one network. Callers that actually need more than one connection build more than one instance. The multi-network abstraction had zero callers that needed it.

**4. Rewritten RPC client with typed method maps and real JSON-RPC batching.**
Each RPC method is a typed key/value in a methods map; responses flow through with full type inference. JSON-RPC `[request, request, ...]` batch arrays are now a first-class code path. `RpcErrorType`, `EsploraBlock`, `NetworkName` are proper types rather than loose strings.

**5. API facade split into sub-facades.**
`@did-btcr2/api` restructures from a flat object into a tree of concern-specific sub-facades: `CryptoApi` (with nested `MultikeyApi`, `CryptosuiteApi`, `DataIntegrityProofApi`), `BitcoinApi`, `KeyManagerApi`, `DidApi`, `DidMethodApi`. Each sub-facade owns its configuration, its lifecycle (`use()` / `clear()` / `current` on the crypto sub-facades for optionally-stateful activation), and its dispose path. Top-level convenience shortcuts (`api.sign()`, `api.signDocument()`) delegate down the tree. This is the foundation that [ADR 024](024-api-facade-lazy-and-layered-config.md) later extends with lazy construction and layered config.

**6. `toJSON()` convention introduced across packages.**
Every class that participates in canonicalization or appears on the API boundary implements `toJSON()` returning a stable, safe JSON shape. Secret-bearing classes return redacted output from `toJSON()` and expose `exportJSON()` for explicit serialization. This convention is formalized as a cross-package rule in [ADR 014](014-canonicalization-functions-and-toJSON-convention.md); the foundation was laid here.

**Supporting changes in the same commit:**
- Branded types (`DidString`, `TxId`) replace loose `string` types where the distinction is load-bearing.
- Pluggable `Logger` interface with a `NOOP_LOGGER` default: first opt-in logging seam.
- `dispose()` lifecycle with `#disposed` guard on resource-holding sub-facades.
- Input validation at public boundaries: `assertString()`, `assertBytes()`, `assertCompressedPubkey()`. Internal code trusts internal code; the library validates at the edge.
- `tryResolveDid()`: non-throwing resolution returning a discriminated union, for callers who prefer result types over exceptions.
- Tests rewritten against the sans-I/O architecture: 96%+ branch coverage on the Bitcoin package, 141 tests / 97.89% line coverage on the API package.

## Consequences

**Positive**
- Tests assert on request descriptors without running a transport. Protocol-level unit tests are microsecond-fast and independent of any HTTP stack.
- The `HttpExecutor` seam means the same code runs under `fetch`, under a mocked executor, under a proxying executor for corporate environments, under a caching executor, or under a Workers/Deno runtime's native fetch: without any changes inside the Bitcoin package.
- Single-network `BitcoinConnection` makes every caller's intent explicit and removes a class of "wrong network picked by default" bugs.
- Sub-facades on the API layer scale by addition, not by mutation. Adding a new concern (a future CAS sub-facade, a new crypto primitive) goes in its own sub-facade with its own tests.
- `toJSON()` as a cross-cutting convention gives canonicalization a consistent input shape, which is the root-cause fix for a whole class of hash-mismatch bugs that later [ADR 014](014-canonicalization-functions-and-toJSON-convention.md) codifies.
- This ADR is the origin point for every later sans-I/O state machine in the codebase ([ADR 016](016-sans-io-resolver.md), [ADR 025](025-sans-io-updater.md), [ADR 032](032-sans-io-server-primitives.md)). The pattern scales because the foundation is small.

**Negative**
- Breaking release across several packages simultaneously. Version bumps: bitcoin 0.4.0, api 0.3.0, common 5.0.0, cryptosuite 6.0.0, keypair 0.10.0, kms 0.3.0, method 0.23.0. Consumers updated imports everywhere or stayed pinned.
- Separating request-building from request-sending adds one layer to understand. Reading the Bitcoin package now requires reading both the protocol layer and the executor, not just a single client class. This is a net win for clarity once learned, but it is not zero cognitive cost.
- Sub-facades mean more surface area. Five sub-facades instead of one flat object: each with its own configuration, lifecycle, tests. The complexity is *distributed* rather than *removed*. The judgment here is that distributed, typed complexity is far easier to reason about than concentrated, loosely-typed complexity.

**Explicitly accepted trade-offs**
- **`HttpExecutor` is pull-based, not streaming.** The Bitcoin package doesn't need streaming semantics today; every response fits in memory. When a streaming need appears (e.g., large block downloads), it'll need a separate streaming executor contract. Designing for that now is premature.
- **`toJSON()` is a convention, not enforced by the type system.** A class that forgets `toJSON()` canonicalizes against its own enumerable fields: which is the pre-fix bug. Code review and the `JSON.parse(JSON.stringify(...))` round-trip inside `canonicalize()` round-trip (added later in [ADR 014](014-canonicalization-functions-and-toJSON-convention.md)) together keep this honest.
- **No built-in retry policy.** The `HttpExecutor` default doesn't retry. Retries: if needed: are the caller's concern, since retry-safety depends on the operation's idempotency, which only the caller knows. A `RetryingHttpExecutor` wrapping the default is a few lines of consumer code.
- **No connection pooling.** Each request goes through `fetch`. In Node ≥ 22, `fetch` uses undici with its own connection pool; in browsers, the platform handles it. We don't add a second layer.

## References

- [`packages/bitcoin/src/connection.ts`](../../packages/bitcoin/src/connection.ts): `BitcoinConnection` (single-network).
- `packages/bitcoin/src/`: `EsploraProtocol`, `RpcProtocol`, `HttpExecutor` live in this package.
- [`packages/api/src/api.ts`](../../packages/api/src/api.ts): sub-facade tree introduced here.
- [ADR 005](005-bitcoin-package-extraction-and-browser-decoupling.md): the package carve-out this refactor built on.
- [ADR 016](016-sans-io-resolver.md): sans-I/O pattern applied to the resolver.
- [ADR 025](025-sans-io-updater.md): sans-I/O pattern applied to the update path.
- [ADR 024](024-api-facade-lazy-and-layered-config.md): later evolution of the API facade to lazy construction + layered config.
- [ADR 032](032-sans-io-server-primitives.md): sans-I/O pattern applied to the HTTP transport server side.
- [ADR 014](014-canonicalization-functions-and-toJSON-convention.md): formalization of the `toJSON()` convention introduced here.

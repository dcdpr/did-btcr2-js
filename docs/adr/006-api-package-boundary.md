---
title: "ADR 006: API Package Boundary"
---

# ADR 006: API Package Boundary

**Status:** Accepted

**Date:** 2025-09-26

**Commit:** [`74b517e`](https://github.com/dcdpr/did-btcr2-js/commit/74b517e)

## Context

After the Bitcoin package was extracted (see [ADR 005](005-bitcoin-package-extraction-and-browser-decoupling.md)), the package graph had `common`, `keypair`, `cryptosuite`, `bitcoin`, and `method` as layer-one packages. Every consumer writing real code against the library had to import from four or five of them at once:

```ts
import { DidBtcr2, Identifier } from '@did-btcr2/method';
import { SchnorrKeyPair } from '@did-btcr2/keypair';
import { SchnorrMultikey } from '@did-btcr2/cryptosuite';
import { BitcoinRestClient } from '@did-btcr2/bitcoin';
import type { KeyBytes, PatchOperation } from '@did-btcr2/common';
```

This is correct at the layer level: each package owns a focused concern: but it pushes the assembly cost onto every consumer. Three problems surfaced:

1. **Cross-package configuration was ad hoc.** A consumer wiring up a real resolution needed to construct a Bitcoin REST client, maybe an RPC client, decide default confirmation counts, pick a network, and then hand all of that to `method`. Each package had its own config shape; the consumer was the integration layer.
2. **The "how do I use this" surface was too wide.** New consumers had to learn the entire layer graph before writing their first `resolve()` call. Tutorials and examples had to pull in five packages to show anything interesting.
3. **There was no stable seam for cross-cutting concerns.** Things like input validation, dispose lifecycle, default logger, branded types, timeouts: none of these belonged to any single layer-one package, but all of them were reasonable things a consumer would want in one place.

The method package was already the "top of the stack" in the DID-protocol sense, but elevating it to "the SDK" would have conflated two different concerns: *the spec implementation* and *the consumer ergonomics layer*. Those two roles have different change drivers. Spec changes force `method` to change; consumer-ergonomics improvements shouldn't.

## Options considered

1. **No facade.** Consumers assemble from the layer packages directly. Lowest infrastructure cost; maximum consumer burden. Every example in docs pulls from 4-5 packages; every consumer writes its own integration glue.
2. **Re-export from `method`.** Treat `method` as the top-level entry, re-exporting from the layers below. Single import for consumers; `method` becomes a god package that owns both spec implementation and consumer ergonomics. Spec revisions and SDK ergonomics end up coupled through one versioning stream.
3. **Dedicated `@did-btcr2/api` package.** An SDK facade that sits above `method`, re-exports selected surface from every layer-one package, owns the consumer-facing configuration shape, and has its own versioning cycle independent of spec changes.

## Decision

**Option 3.** On 2025-09-26 (commit `74b517e`), `@did-btcr2/api@0.1.0` is initialized with the explicit role of **consumer-facing SDK facade**. The package:

- **Re-exports typed surface from every layer-one package**: `DidDocument`, `DidDocumentBuilder`, `Identifier`, `IdentifierTypes`, and key crypto/encoding types flow out through the public exports of `api`. Consumers import a single package for the common surface.
- **Defines cross-cutting configuration types.** `ApiConfig`, `BitcoinApiConfig`, and later `KeyManagerApiConfig` / `CasApiConfig` live in `api`: not in the layer packages that would otherwise have to know about each other. A consumer's `new Api({ bitcoin: {...}, kms: {...} })` is the one integration point.
- **Introduces the sub-facade pattern.** The original commit already carved out a `KeyPairApi` inside `api.ts`. Every subsequent sub-facade (`BitcoinApi`, `KeyManagerApi`, `CryptoApi`, `DidApi`, `DidMethodApi`) follows this shape: ergonomics, defaults, and lifecycle live at the sub-facade, not in the underlying layer package.
- **Is versioned independently.** `@did-btcr2/api@0.1.0` starts at 0.1 even though `@did-btcr2/method` was already at 0.17. Spec revisions bump `method`; SDK ergonomics bump `api`.

The boundary rule is: **`method` is the spec; `api` is the SDK.** A test vector generator or cross-language parity test might consume `method` directly. Application code: CLIs, wallets, services: consumes `api`. [ADR 009](009-sans-io-bitcoin-transport-foundation.md) later expands the sub-facade tree. [ADR 024](024-api-facade-lazy-and-layered-config.md) later adds lazy construction and layered config on top of this boundary.

## Consequences

**Positive**
- One import for consumer application code. Documentation and examples collapse from five-package scaffolding to `import { Api } from '@did-btcr2/api'`.
- Spec-driven churn stays in `method`. Ergonomics-driven churn stays in `api`. The two can move on their own version cadences; ADR 010's spec-tracking policy doesn't force `api` to break when only names changed underneath.
- Cross-cutting concerns (input validation, dispose, timeouts, branded types, logger) have a natural home. They don't distort any layer-one package's scope.
- The CLI package (`@did-btcr2/cli`) consumes `api` rather than `method` directly, which means CLI behavior is always a thin shell over the canonical SDK surface. Consumers auditing the CLI can assume it demonstrates real API usage.

**Negative**
- One more package to version, publish, and keep in sync.
- Re-exports create a risk of surface drift. If `api` forgets to re-export something that `method` added, consumers can't reach it. Mitigated by code review and by the convention that every public-facing type in `method` has a matching re-export in `api`.
- The two-tier structure (layer packages + facade) adds a layer of indirection. A consumer tracing a `resolve()` call reads `api` to `method` to `bitcoin`/`cryptosuite`/`keypair`. This is intentional but not zero cognitive cost.

**Explicitly accepted trade-offs**
- **`api` does not gate access to layer packages.** A consumer who wants to skip the facade and import from `method` directly can, and that's fine: the facade is an ergonomics layer, not a security boundary. Tooling, test-vector generation, and cross-implementation compatibility work often wants direct layer access.
- **No auto-generated sub-facade tree.** The sub-facade structure is hand-maintained. A reflection or codegen-based approach would reduce duplication but couple the facade to layer-package internals in ways that are hard to unwind.
- **No separate "api-types" package.** Types flow through the runtime module of `api`. A pure-types separate package would shave a handful of bytes off bundle size for type-only consumers; the savings weren't worth a second package.
- **Versioning independence is policy, not mechanism.** Nothing in the build system enforces that `api` stays at a lower version than `method`, or that spec-aligned renames in `method` require an `api` release. Consistency is a release-process concern, not a package-layout one.

## References

- [`packages/api/src/api.ts`](../../packages/api/src/api.ts): the current sub-facade tree that originated from the inception class.
- [`packages/api/src/index.ts`](../../packages/api/src/index.ts): re-exports defining the consumer-facing surface.
- [ADR 001](001-monorepo-package-boundaries.md): the monorepo structure; `api` is the layer-two package sitting above layer-one concerns.
- [ADR 024](024-api-facade-lazy-and-layered-config.md): lazy construction and layered config layered on top of this boundary.
- [ADR 005](005-bitcoin-package-extraction-and-browser-decoupling.md): preceding extraction that created the layer-one graph this facade sits on.
- [ADR 009](009-sans-io-bitcoin-transport-foundation.md): expanded sub-facade tree and dispose lifecycle.

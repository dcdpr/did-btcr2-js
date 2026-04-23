---
title: "ADR 004: Rename did:btc1 to did:btcr2"
---

# ADR 004: Rename did:btc1 / @did-btc1/* to did:btcr2 / @did-btcr2/*

**Status:** Accepted

**Date:** 2025-08-23

**Commit:** [`31dfad0`](https://github.com/dcdpr/did-btcr2-js/commit/31dfad0)

## Context

The project originally shipped as `did:btc1` under the npm scope `@did-btc1/*`. The W3C-aligned spec work driving the DID method's design moved to the name `did:btcr2` (the `r2` suffix distinguishing it from the earlier `did:btcr` method registered in 2019 under a different ownership and design). Continuing to publish the TypeScript reference implementation under the old name risked:

1. **Confusion with the legacy `did:btcr` method.** New adopters Googling "did btcr" could land on documentation, tooling, or resolvers for either method and not realize the two are incompatible.
2. **Divergence from the spec identity.** The spec's canonical URL, test-vector repository, and cross-language implementation work were all transitioning to the `btcr2` name. A TypeScript implementation under `@did-btc1/*` would have been the odd one out.
3. **Breaking-change coordination.** Every downstream consumer would eventually need to swap the name anyway once the spec's canonical URL resolved to `btcr2`. Delaying the rename would just compound the breaking change with every future release under the old name.

## Options considered

1. **Stay on `@did-btc1/*`.** Lowest friction for existing installations; keeps the project identity misaligned with the spec indefinitely.
2. **Publish under both names (dual-publish).** Doubles the release burden; creates two truth sources and invites divergence between them.
3. **Rename wholesale to `@did-btcr2/*`** in a coordinated release, with a final `@did-btc1/*` release that points readers at the new packages.

## Decision

**Option 3.** On 2025-08-23, publish the first `@did-btcr2/*` packages (`@did-btcr2/common@2.0.0` and the other core packages following within days). The `@did-btc1/*` packages are marked deprecated on npm with a pointer to the new scope. All internal references, documentation, DID URI prefixes (`did:btc1:` to `did:btcr2:`), and test vectors are updated atomically.

Repository name is changed from `did-btc1-js` to `did-btcr2-js`. Spec URL is updated to [dcdpr.github.io/did-btcr2](https://dcdpr.github.io/did-btcr2/).

Version numbers reset in the rename packages to reflect "first release under new name":
- `@did-btc1/common@1.1.0` to `@did-btcr2/common@2.0.0` (major bump signals the rename)
- `@did-btc1/method@0.13.0` to `@did-btcr2/method@0.13.1` (continuous; the method was already 0.13 at the rename)

## Consequences

**Positive**
- Single canonical name across spec, repo, and npm scope. Searchability improves; documentation cross-references unambiguously.
- No accidental mixing of `did:btc1` and `did:btcr2` identifiers: the DID URI scheme is different, so a legacy resolver cannot resolve a new DID (or vice versa) without explicit awareness.
- Breaking change is concentrated at one point in time. Subsequent releases iterate on the new name.

**Negative**
- Downstream consumers had to update their dependencies. A single breaking change is better than indefinite divergence, but it is still a breaking change.
- Historical links in issues, commit messages, and older branches reference `@did-btc1/*`. The commit graph preserves the old names, so archeology on pre-rename decisions still works but the names are not current.

**Explicitly accepted trade-offs**
- We did not ship a shim package that re-exported `@did-btc1/*` contents from `@did-btcr2/*`. Consumers update imports in their own code; we do not hide the rename behind a compatibility layer.
- We did not keep the old DID URI prefix (`did:btc1:`) as a synonym. A `did:btc1:*` identifier is simply not a valid did:btcr2 identifier. Re-encoding old DIDs under the new prefix is the user's responsibility.

## References

- Git commit `31dfad0 2025-08-23`: first `@did-btcr2/common@2.0.0` publish.
- [dcdpr.github.io/did-btcr2](https://dcdpr.github.io/did-btcr2/): current spec home.
- [ADR 001](001-monorepo-package-boundaries.md): the monorepo structure that was renamed wholesale.

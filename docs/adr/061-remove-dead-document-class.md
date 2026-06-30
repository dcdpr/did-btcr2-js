---
title: "ADR 061: Remove the Unused Public Document Wrapper Class"
---

# ADR 061: Remove the Unused Public Document Wrapper Class

**Status:** Accepted

**Date:** 2026-06-30

**Branch / PR:** `chore/method-hygiene`

**References:** [ADR 058](058-remove-legacy-helia-cas-path.md), [ADR 016](016-sans-io-resolver.md)

## Context

`packages/method/src/utils/did-document.ts` defined a class named `Document`:

```ts
export class Document {
  public static isValid(didDocument: DidDocument | GenesisDocument): boolean {
    return new DidDocument(didDocument).validateGenesis();
  }
}
```

It is a three-line static wrapper that does nothing a caller cannot do directly with
`new DidDocument(...).validateGenesis()`. It has zero callers anywhere in the monorepo
(source, tests, lib scripts, test vectors), yet it was reachable as a public export,
`import { Document } from '@did-btcr2/method'`, through the wildcard barrel
`export * from './utils/did-document.js'` in `method/src/index.ts`. The name also collides
conceptually with the DOM `Document` and with the package's real `DidDocument`, making it a
trap for anyone scanning the public surface.

A repository convention already covers this situation:
[ADR 058](058-remove-legacy-helia-cas-path.md) removed the dead public method
`Appendix.fetchFromCas` and recorded it as a breaking, minor-version change. This decision
applies the same treatment to the `Document` class.

## Decision

### Remove the `Document` class outright

Delete the class. Callers that need genesis validation use the live API directly:
`new DidDocument(doc).validateGenesis()` or `DidDocument.validate(doc)`. The barrel export
needs no edit, it is a wildcard re-export with no named `Document` entry, so the public
surface is automatically corrected once the class is gone.

### Treat the removal as a breaking, minor-version change

Although `Document` was undocumented and uncalled, it was part of the published API surface,
so removing it can break an external consumer importing it by name. Per 0.x semantics
(breaking changes signalled by a minor bump) and the [ADR 058](058-remove-legacy-helia-cas-path.md)
precedent, `@did-btcr2/method` takes a minor bump and this ADR serves as the release note.

## Consequences

- The published API of `@did-btcr2/method` no longer exports `Document`. A consumer importing
  it by name must switch to `DidDocument` (which exposes the same `validateGenesis()` /
  `validate()` behavior). No in-tree code was affected.
- `DidDocument.validateGenesis()` is unchanged and remains in active use by the `DidDocument`
  constructor and `DidDocument.validate()`; it is not orphaned by the removal.
- The misleading `Document` name is gone from the surface, leaving `DidDocument`,
  `GenesisDocument`, and `Btcr2DidDocument` as the document types.

## Rejected alternatives

- **Deprecate first, remove later.** A deprecation cycle is warranted for an API with real
  users or real behavior. This class has neither: zero callers and no behavior of its own
  beyond delegating to `DidDocument`. A deprecation shim would prolong the confusing name for
  no benefit.
- **Keep it.** Retaining a named, public, never-called wrapper invites accidental use and
  keeps a second spelling of `validateGenesis` on the surface. The cost of carrying it
  outweighs any hypothetical convenience.

## Note

The same branch also added resolver unit tests covering the previously-untested
`versionId`, `versionTime`, and `deactivated` early-return branches in `Resolver.updates()`
(see [ADR 016](016-sans-io-resolver.md) for the resolver state machine). That is test
coverage rather than a design decision and is recorded here only for branch traceability.

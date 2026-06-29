---
title: "ADR 058: Remove the Legacy Helia CAS Read Path and Shrink the Method Bundle"
---

# ADR 058: Remove the Legacy Helia CAS Read Path and Shrink the Method Bundle

**Status:** Accepted

**Date:** 2026-06-29

**Branch / PR:** `refactor/remove-helia-cas-path`

**References:** [ADR 023](023-cas-read-path.md)

## Context

`Appendix.fetchFromCas()` was an early content-addressed-store read helper: it derived a CIDv1 from a content hash and fetched the block by spinning up an in-process Helia (IPFS) node via dynamic `import('helia')` and `import('@helia/strings')`. The canonical CAS read path is now `CasApi` (ADR 023): resolution emits a `Need*` for CAS-delivered content and the caller fulfills it, with IPFS access supplied by the SDK's executor rather than the method package embedding an IPFS node.

That left `fetchFromCas` as dead code: it has no callers anywhere in the workspace, only its own definition. Its cost was not zero, though:

- It kept `helia` and `@helia/strings` in the method package's runtime dependencies. Helia pulls a large libp2p / IPFS subtree, which dominated the browser bundle.
- It was the only `src` use of `multiformats` (`CID` + digest), so `multiformats` was a direct runtime dependency and was bundled into both the CJS and browser outputs.
- The CJS build config carried a `noExternal` carve-out forcing `multiformats` inline (it has no `require` export), plus a comment explaining why Helia was deliberately left external. Both existed only to service this one method.

`multiformats` is still used directly by two scenario-tooling scripts under `lib/` (`publish-scenarios.ts`, `verify-live.ts`), which derive CIDs to pin and fetch CAS objects exactly as a resolver would. Those are development tools, not part of the published runtime surface.

## Decision

Remove the legacy Helia read path and the dependency weight it carried:

1. **Delete `Appendix.fetchFromCas()`** and its now-unused imports (`CID`, the digest factory, and the `HashBytes` type). CAS reads go solely through the `CasApi` path per [ADR 023](023-cas-read-path.md).
2. **Drop `helia` and `@helia/strings`** from the method package entirely; nothing else references them.
3. **Demote `multiformats` to a dev dependency.** No `src` module imports it anymore; the published runtime reaches it only transitively (through `@web5/dids`, which declares its own dependency), while the `lib/` scenario scripts that import it directly are dev tooling.
4. **Remove the now-moot CJS `noExternal` carve-out** for `multiformats` and the stale Helia comment from the tsup config. With no direct `multiformats` import, the CJS bundle contains none.

## Consequences

- The method browser bundle drops from roughly 4.0 MB to 1.5 MB (`browser.js` 4,122,945 to 1,572,273 bytes; `browser.mjs` 3,884,046 to 1,488,588 bytes), about a 62% reduction, almost all of it the removed Helia / libp2p subtree. The CJS bundle drops from 137 KB to 111 KB.
- Two runtime dependencies (`helia`, `@helia/strings`) leave the method package, and a third (`multiformats`) leaves its runtime surface. This is the first concrete step toward the monorepo bundle-size and extraneous-dependency goals.
- `Appendix.fetchFromCas` is a public static (`Appendix` is re-exported from the package barrel), so its removal is a breaking change to the public surface and is released as a minor version bump under 0.x semantics.
- CAS resolution behavior is unchanged: the path was already dead, and the live path (`CasApi`) is untouched. All existing tests pass without modification.

## Rejected alternatives

- **Keep the dead method "just in case."** It had no callers and duplicated a capability the SDK already owns (ADR 023). Carrying an embedded IPFS node in the method package to keep a dead code path is exactly the weight this change removes.
- **Keep `multiformats` as a runtime dependency.** No published runtime module imports it directly anymore; the transitive path via `@web5/dids` covers runtime use, and the only direct importers left are dev-only scenario scripts. Declaring it as a dev dependency states that accurately.
- **Keep the lazy `import('helia')` but drop the dependency.** A dynamic import of an undeclared package is a latent runtime failure, and it would still force the tsup carve-out and the explanatory build comment to stay. Removing the dead path removes the reason for both.

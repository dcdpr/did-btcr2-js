# ADR 097: Resolution failures carry their root cause

- **Status:** Accepted
- **Date:** 2026-08-28
- **Packages:** `@did-btcr2/api`

## Context

The api has two resolution failure surfaces, and both hid the reason a resolution failed. `DidMethodApi.resolve` caught every failure and re-threw a constant wrapper, `Failed to resolve DID: <did>`, with the real failure attached as `cause`. `DidBtcr2Api.tryResolveDid`, the no-throw variant, then copied that wrapper's `message` into its `errorMessage` field. Whichever path a caller took, the surfaced text named the DID and nothing else: the actual reason (no Bitcoin connection configured, a network refusal, a missing genesis document, an invalid update) sat two `cause` hops down, and the ok:false result had no field carrying the thrown value at all, so reaching the reason meant giving up exactly the no-throw ergonomics `tryResolveDid` exists to provide. The cli's non-verbose resolve failure line printed the same constant.

Two latent defects sat next to this. `tryResolveDid` read `err.message` on the caught value unguarded, so a rejection with `null` (or `undefined`) crashed the no-throw method with a TypeError, violating its contract. And the most common deep failure in practice, a Node fetch refusal, bottoms out in an `AggregateError` whose own `message` is empty (Node collects the per-address dual-stack failures in its `errors` array), so a naive "deepest message" extraction prints nothing precisely when the caller most needs the reason.

## Decision

**A public `rootCauseMessage(err: unknown): string` helper extracts the message of the deepest meaningful link in a cause chain, and both failure surfaces use it.** `DidMethodApi.resolve` still throws a wrapper carrying `{ cause: err }`, but its message becomes `Failed to resolve DID <did>: <root cause>`. `tryResolveDid` sets `errorMessage` (top-level and inside `raw.didResolutionMetadata`) to the root cause message and gains a `cause?: unknown` field on the ok:false variant carrying the original thrown value, so the full chain, and any typed error in it, stays reachable without a throw.

The helper walks `err.cause` links, capped at 16 hops (which also terminates self-referential chains), and tracks the deepest non-empty message rather than the last link's: a link with no usable message is skipped, so the nearest meaningful message above it wins. When a link's message is empty but it has an `errors` array, the helper descends one level into the first sub-error (the `AggregateError` case above; one level only, no recursion, so a self-referential `errors` array is safe). The function is total: every property read is guarded, and a chain with no usable message anywhere degrades to `String(value)` or, when even that is empty or throws (a thrown empty string, a null-prototype object), to `'Unknown error'`, never to an empty message. Totality is what fixes the unguarded `err.message` crash.

**Deepest-only, not a joined chain.** Joining every message in the chain (`outer: middle: inner`) was rejected. The api's own wrapping makes chains self-similar: `tryResolveDid` walks through `resolve`'s new wrapper, so a joined chain would print the DID and the reason twice. And the method package's typed errors do not propagate `cause` upward, so real chains are shallow and the deepest message is the informative one. Callers who want the whole chain have it, once, in `cause`.

**The wrapper message keeps the DID and gains the reason**, rather than being dropped in favor of re-throwing the cause bare: the DID says which resolution failed when several run concurrently, and existing callers match on the `Failed to resolve DID` prefix, which survives.

## Scope boundary

**The defensive branch in `tryResolveDid` stays.** The branch returning ok:false from a resolution that resolved without a document is unreachable today (`resolve` either returns a document or throws), but it is the correct behavior if the upstream contract ever loosens, and it costs nothing.

**Documentation refresh rides the branch-wide doc sync.** The package demo shows the old failure format in a sample output and a troubleshooting table, and the readme's failure shape predates the `cause` field; both are refreshed in this branch's documentation pass, not here.

## Consequences

**Positive.** A resolution failure names its reason at every surface: the thrown wrapper's own message, `errorMessage` on the ok:false result, `raw.didResolutionMetadata`, and the cli's non-verbose resolve failure line, which prints the improved message with no cli change. The no-throw contract of `tryResolveDid` now holds for every thrown value, including `null`. Callers can branch on the typed error without a try/catch, via `cause`.

**Negative.** Error text becomes part of what callers observe: anything matching the exact old constant `Failed to resolve DID: <did>` no longer matches (the `Failed to resolve DID` prefix still does), and the printed cli failure line changes shape with it. The extraction is heuristic; an exotic error shape can still surface `'Unknown error'` where a human reading the chain would have found more.

**Neutral.** `rootCauseMessage` becomes public surface (the package root re-exports it): a helper the facade needs for its own error surfaces is one consumers would otherwise reimplement. The 16-hop cap is invisible in practice; real chains here are two or three links.

## Implementation

- `packages/api/src/helpers.ts`: `rootCauseMessage` (public), over private `messageOf` (the message a single link contributes, guarded) and `fallbackString` (last-resort stringification).
- `packages/api/src/method.ts`: the resolve catch inlines the root cause in the wrapper message; `{ cause: err }` unchanged.
- `packages/api/src/types.ts`: `cause?: unknown` on the ok:false `ResolutionResult` variant.
- `packages/api/src/api.ts`: the `tryResolveDid` catch uses `rootCauseMessage` for both `errorMessage` sites and carries `cause`.
- Tests: a `rootCauseMessage` unit matrix (chain walking, `AggregateError` descent, totality against hostile values); resolve inlining the no-connection guard text; the ok:false result carrying the root cause and `cause` with matching raw metadata; no throw on a `null` rejection; the export-surface row.

## References

- ADR 093 (network inheritance), ADR 094 (deactivation as an ordinary update), ADR 095 (offline initial document and beacon addresses), ADR 096 (facade signer factory and write-path re-exports): the same api CRUD review produced all five findings.
- `docs/api-crud-review.md`: the review that surfaced this, as gap G5.

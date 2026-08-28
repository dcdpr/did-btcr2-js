# ADR 100: The update path refuses a deactivated source document

- **Status:** Accepted
- **Date:** 2026-09-02
- **Packages:** `@did-btcr2/api`

## Context

ADR 094 made deactivation an ordinary update carrying the deactivation patch, and placed one guard in front of it: `DidMethodApi.deactivate()` refuses a source document whose `deactivated` flag is already set, because a second deactivation signs and broadcasts an update that no resolver can ever read. The guard lived only in `deactivate()`. `DidMethodApi.update()`, the operation every write path ends in, accepted a deactivated source without comment, and so did the layer beneath it: the `Updater` state machine in the method package applies whatever patches it is given, and the resolver is the only component that reads the flag.

The consequence is the one ADR 094 closed for deactivation, open for every other update. Resolution halts at the deactivating update and returns; nothing announced after it is ever applied. An update signed on top of a deactivated document is therefore well-formed, passes the signing-key check, is published to the CAS if the policy says so, spends a beacon UTXO to announce itself, and is invisible to every conformant resolver. Each layer reports success.

The path is reachable without contrivance. `DidBtcr2Api.updateDid` resolves the current document when the caller does not supply one; for a deactivated DID the resolver returns the document with the flag set and the facade hands it straight to `update()`. Since ADR 098 the caller's resolution options reach that resolution, so a DID whose updates live only in sidecar data now resolves to its deactivated state and the path applies to it too. The cli's `update` and `deactivate` commands take a different route to the same place: both call `DidMethodApi.update()` directly with a caller-supplied source document, so the cli's own deactivate command never met the guard of ADR 094 either.

## Decision

**`DidMethodApi.update()` refuses a deactivated source document as its first act.** The check precedes the Bitcoin connection lookup, so a caller with no connection configured is told about the deactivation rather than the missing connection, and no signing, publication, or chain access happens on a document that cannot take an update. The refusal is an `UpdateError` of the same type as the deactivation guard, carrying the document's id.

**The guard sits at the chokepoint, not at each entry.** `updateDid`, `UpdateBuilder.execute()`, `deactivate()`, and the cli's direct calls all end in `update()`; one guard there covers every route, including ones written later. A guard in the facade's source-resolution helper was rejected because it would cover only auto-resolution and leave the builder, direct `update()` callers, and the cli open. A guard inside the method package's `Updater` was rejected for the reason ADR 094 gave: the state machine is the specification's update algorithm and applies arbitrary patches; that algorithm does not itself refuse one, and product guarding belongs at the api, the layer with the product contract.

**Refusal, not a warning.** This is a validity guard, not an optional limit. The specification defines resolution as halting at the deactivation, so an update on a deactivated document has no defined effect under any resolver; there is no configuration in which broadcasting it is the right outcome, and the cost of doing so is real funds. Guards of that kind ship on.

**`deactivate()` keeps its own check in front.** Its message says the document is *already* deactivated, which is the accurate phrasing for that verb, and the tests pin it. `update()`'s message says the document is deactivated and cannot be updated. A caller reaching `update()` through `deactivate()` sees the first; every other caller sees the second. The second is the backstop; `deactivate()` never reaches it.

## Scope boundary

**The guard checks only what it is given.** ADR 094's boundary carries over unchanged: the check inspects the source document in hand, supplied or resolved, and does not re-resolve. A caller who supplies a stale document with the flag absent can still broadcast an unreadable update; the guard closes the accidental case, not the adversarial one.

**No change to the method package.** The `Updater` and the resolver are untouched; the resolver's halt-at-deactivation behaviour is what makes the refused update pointless, and it predates this decision.

**The cli inherits the refusal through its bypass.** The cli's `update` and `deactivate` commands now refuse a deactivated source document, with `update()`'s message rather than `deactivate()`'s, because they call `update()` directly. Moving the cli onto the facade's `updateDid` and `deactivateDid` is a separate cli change.

**Documentation rides the branch-wide sync.** The api demo's deactivation section is refreshed in this branch's documentation pass, not here.

## Consequences

**Positive.** Deactivation is now terminal from the write side as well as the read side. No route through the api can spend a beacon UTXO announcing an update on a deactivated document, whether the document was supplied or resolved and whichever entry point the caller used.

**Negative.** Behaviour changes for a caller who passed a deactivated document to `update()` or the builder and relied on it broadcasting. That update could never have been applied, so the change removes a way to lose funds rather than a capability; it rides the api MINOR this branch already takes, and the changeset names it.

**Neutral.** `deactivate()`'s behaviour and message are unchanged. Two guards with two messages now exist for one condition, deliberately: each names the verb the caller used.

## Implementation

- `packages/api/src/method.ts`: the refusal as the first statement of `update()`; the method's documentation states the rule.
- `packages/api/src/api.ts`: `updateDid` documents that a deactivated source, supplied or resolved, is refused before signing.
- Tests: `update()` refuses a deactivated document with no connection configured, proving the guard precedes the connection check; the builder path; the facade with a resolved deactivated document, proving auto-resolution cannot bypass it; the facade with a supplied deactivated document.

## References

- ADR 094 (deactivation as an ordinary update): the guard this generalises and the "checks only what it is given" boundary it inherits.
- ADR 098 (update source resolution accepts resolution options): the passthrough that made the resolved path reachable for sidecar-only DIDs.
- ADR 099 (offline facade mints regtest identifiers): the same second-round api CRUD review produced both findings.
- `docs/api-crud-review-2026-09-01.md`: the second-round review that surfaced this, as gap G10.

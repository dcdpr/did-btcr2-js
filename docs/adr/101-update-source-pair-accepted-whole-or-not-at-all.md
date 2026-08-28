# ADR 101: A write's source pair is accepted whole or not at all

- **Status:** Accepted
- **Date:** 2026-09-03
- **Packages:** `@did-btcr2/api`

## Context

`DidBtcr2Api.updateDid` and `DidBtcr2Api.deactivateDid` take an optional source pair: `sourceDocument` and `sourceVersionId`. A shared private helper resolves the DID if the caller does not supply the pair (ADR 094). ADR 098 passed the caller's resolution options into that helper. Its decision text states that resolution runs "when `sourceDocument` or `sourceVersionId` is missing".

That wording described a defect. The helper resolved the DID if either field was missing, then kept whichever field the caller supplied. A caller who passed only `sourceDocument` got that document paired with the resolver's version number. A caller who passed only `sourceVersionId` got that number paired with the resolver's document. The helper also did not check that a supplied document described the DID under update. The layer beneath reads `sourceDocument.id` everywhere and uses `did` only for resolution and messages.

The consequence is an update that no resolver applies. For a supplied document, the update's source hash comes from the caller and its source version comes from the resolver. If the two do not describe the same state, a resolver rejects the update on replay with a source-hash mismatch. For a supplied version, the update's target version comes from the caller and its source hash comes from the resolver. If the two do not describe the same state, a resolver rejects the update on replay as a late or out-of-order update. In both cases the facade signs the update and spends a beacon UTXO, and every layer reports success at call time.

## Decision

**The facade accepts the source pair together or not at all.** If the caller supplies both fields, the helper skips resolution and returns the pair. If the caller supplies neither, the helper resolves the DID with the caller's resolution options and takes both values from the resolution. If the caller supplies one field without the other, the helper refuses the call before any resolution. This rule supersedes ADR 098's "either field missing" wording.

**A supplied document must describe the DID under update.** If the pair is present, the helper compares `sourceDocument.id` with `did` and refuses a mismatch. The check runs before the deactivation guard of ADR 100 and before any signing or chain access.

**Explicit refusal, not a silent all-or-nothing rule.** This decision rejects a rule that drops the half-supplied field and resolves anyway. A caller who passed one field had a reason for it. A silent drop hides the mistake until replay.

This decision also rejects two other rules. The first keeps the old behaviour, which produces the unreplayable update above. The second resolves the DID and cross-checks a supplied document against the resolution. That rule removes the reason for the supplied pair, which is to skip resolution. An offline caller also cannot run that rule.

**The refusal is a typed error.** Both refusals throw an `UpdateError` of type `INVALID_DID_UPDATE`, the same shape as the deactivation guard of ADR 100. The error data carries `did` and, for a mismatch, the supplied document's id. Tests discriminate the typed error from the untyped resolution failures that the helper keeps.

**Null and undefined are both "not supplied".** The helper uses a loose null check for each field. The browser bundle serves untyped callers, and the old code already treated a null document as absent.

## Scope boundary

**The helper does not validate a supplied `sourceVersionId`.** A non-integer or non-finite number passes the pair check unchanged. The value reaches the layer beneath as before. Validation of the number is a separate, smaller change.

**The helper's own resolution failures stay untyped.** The three resolution-failure throws inside the helper predate this decision and remain plain `Error` instances. The typed-error sweep of the api package (ADR 085, residual) owns them. One of those messages changes. If a resolution returns no version number, the message now tells the caller to supply both fields. The old advice to supply only `sourceVersionId` is now a refused input.

**The cli does not consume these methods.** Its `update` and `deactivate` commands call `DidMethodApi.update()` directly with mandatory source flags. This change does not affect the cli.

**Documentation is part of the branch-wide sync.** The readme and the demo show the pair either omitted or complete, so nothing is stale. The branch's documentation pass adds nothing for this decision.

## Consequences

**Positive.** The facade signs an update only on a source state that one party holds whole: the caller or the resolver. A supplied document is always the document of the DID under update. The facade refuses both mistakes before it spends the beacon UTXO.

**Negative.** Behaviour changes for a caller who passed one field and relied on the facade to fill the other. That call produced an unreplayable update unless the two halves matched by chance. The change removes a way to lose funds, not a capability. The change is part of the api MINOR that this branch already takes. The changeset names the change.

**Neutral.** A caller who passes both fields or neither sees no change. The resolution path, the resolution-options passthrough of ADR 098, and the deactivation guard of ADR 100 are unchanged.

## Implementation

- `packages/api/src/api.ts`: `#resolveUpdateSource` refuses a half-supplied pair. Then it returns a whole pair after the id check, or it resolves and takes both values from the resolution. `updateDid` and `deactivateDid` document the rule.
- Tests: `updateDid` refuses a document without a version and a version without a document, each before resolution. `updateDid` refuses a document whose id is not the DID, before resolution and before the write. `deactivateDid` refuses a half-supplied pair and a mismatched document. The refusals carry the `INVALID_DID_UPDATE` type and the documented data. A null version with a document is refused, and a null pair resolves with both values from the resolution. One existing test now supplies a document with a matching id.

## References

- ADR 094 (deactivation as an ordinary update): introduced the shared source-resolution helper.
- ADR 098 (update source resolution accepts resolution options): the passthrough this decision keeps, and the "either field missing" wording this decision supersedes.
- ADR 100 (update path refuses a deactivated source): the typed-error shape this decision reuses, and the guard that now runs after the id check.
- ADR 085 (typed-error audit and lint guard): the sweep that owns the helper's remaining untyped throws.
- `docs/api-crud-review-2026-09-01.md`: the second-round review that surfaced this, as gap G13.

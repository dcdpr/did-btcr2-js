# ADR 123: updateDid and deactivateDid Follow the Signatures of the Specification

- **Status:** Accepted
- **Date:** 2026-09-24
- **Packages:** `@did-btcr2/api` (MINOR); `@did-btcr2/cli` (MINOR)

## Context

The specification defines the update and deactivate operations with short signatures:

```rust
fn update(didSourceDocument, jsonPatch, targetVersionId, verificationMethodId, signer) -> signedUpdate
fn deactivate(didSourceDocument, targetVersionId, verificationMethodId, signer) -> signedUpdate
```

The specification puts the beacon and the Bitcoin transaction in a separate section, "Announce DID Update". Spec PR 368 (2026-09-23) names the inputs of that transaction there: the prevouts, the fee rate, and the change address.

`DidBtcr2Api.updateDid` took one object with eleven fields: `did`, `patches`, `signer`, `verificationMethodId`, `beaconId`, `beaconSigner`, `sourceDocument`, `sourceVersionId`, `resolutionOptions`, `publishToCas`, and `broadcastOptions`. `deactivateDid` took ten. `DidMethodApi.update` took ten, with a per-call `bitcoin` connection. The fields mixed three concerns in one flat list:

1. The inputs of the specification.
2. The source of the update: a DID to resolve, or a document with its version.
3. The announcement: the beacon, the signer of the beacon input, the fee, the change address, and the CAS policy.

Three fields described one value, the source state. Because of this, the api needed two runtime checks. ADR 101 refuses a half-supplied pair. A second check refuses a `sourceDocument` whose `id` is not `did`. `UpdateBuilder` existed only to make the large call easier to read. It was a third way to do the same update.

## Decision

**The write methods take the inputs of the specification as positional arguments, and one options object.**

```ts
updateDid(source: UpdateSource, patch: PatchOperation[], signer: Signer, options?: DidUpdateOptions)
deactivateDid(source: UpdateSource, signer: Signer, options?: DidUpdateOptions)
```

**The source is one value.** `UpdateSource` is a DID or a `SourceState` `{ document, versionId }`. If the source is a DID, the facade resolves it with `options.resolutionOptions`. If the source is a state, the facade does not resolve. The type makes the pair whole, so the half-pair refusal of ADR 101 and the `id` check go away from the api. The cli keeps its own flag checks, because the cli takes the document and the version as two flags beside `-i`.

**`patch` replaces `patches`.** The specification input is one JSON Patch document, which is an array of operations.

**The options follow the specification sections.** `UpdateOptions` holds `verificationMethodId`, an input of the update operation, and `announce`. `AnnounceOptions` holds the fields of the announcement: `beaconId`, `signer` (the signer of the beacon input, ADR 119), `publishToCas`, `bitcoin`, and the fields of `BroadcastOptions` (`feeEstimator`, `changeAddress`). `DidUpdateOptions` adds `resolutionOptions` for the top facade.

**`DidMethodApi.update` and `DidMethodApi.deactivate` take the same shape.** Their source is a `SourceState`, because that layer does not resolve. The per-call connection moves to `announce.bitcoin`, because only the announcement reads the chain.

**`UpdateBuilder` and `DidMethodApi.buildUpdate` are removed.**

**The input is the resolved `versionId`, not `targetVersionId`.** The specification says that `targetVersionId` MUST come from the `versionId` of a fresh resolution, not from a local count. The api takes the resolved value and adds 1. So the caller cannot supply a local count by mistake.

## Scope boundary

- The method package does not change. `DidBtcr2.update` keeps its named object with `sourceVersionId` and `beaconId`.
- The cli flags do not change. Only the exported `UpdateCommandOptions` type changes shape.
- The fee input stays a `FeeEstimator`. Spec PR 368 names a fee rate. A change to the fee input is a separate decision.
- The refusals of ADR 100, ADR 102, and ADR 103 do not change.

## Consequences

**Positive.** A call reads like the specification: `api.updateDid(did, patch, signer)` and `api.deactivateDid(did, signer)`. The declared signature has four parameters, and three of them are required. A document without its version cannot occur. There is one way to call an update on each facade layer.

**Negative.** Each caller of `updateDid`, `deactivateDid`, `DidMethodApi.update`, `DidMethodApi.deactivate`, and `UpdateBuilder` must change. The cli exports `UpdateCommandOptions`, and its shape changes.

**Unchanged.** The derivation of an omitted verification method and beacon (ADR 104). The CAS publication policy (ADR 073). The deactivation patch (ADR 094). The result type `DidUpdateResult`.

## Implementation

- `packages/api/src/method.ts`: the types `SourceState`, `UpdateSource`, `AnnounceOptions`, `UpdateOptions`, and `DidUpdateOptions`; the new signatures of `update` and `deactivate`; `UpdateBuilder` and `buildUpdate` removed.
- `packages/api/src/api.ts`: the new signatures of `updateDid` and `deactivateDid`; `#resolveUpdateSource` takes an `UpdateSource`.
- `packages/cli/src/commands/write.ts`: `prepareWrite` builds the source, the signer, and the options; a check that `--source-document` describes the identifier.
- `packages/cli/src/types.ts`: `UpdateCommandOptions` is `{ source, signer, options }`.
- `packages/api/lib/e2e-update-builder.ts` renamed to `e2e-method-update.ts`, and it calls `api.btcr2.update`.
- `packages/api/README.md` and `packages/api/DEMO.md`: the update and deactivate examples.
- Tests: the api specs and `tests/support/update-fixtures.ts` use the new signatures; the builder cases and the source-pair cases are removed; the cli `update.spec.ts` asserts the new arguments.
- Versions: api 0.28.0 (MINOR); cli 0.25.0 (MINOR).

## References

- [Update](https://dcdpr.github.io/did-btcr2/operations/update.html) and [Deactivate](https://dcdpr.github.io/did-btcr2/operations/deactivate.html) in the specification.
- [ADR 094](094-deactivation-is-an-ordinary-update.md): `deactivate` as an update with a fixed patch.
- [ADR 098](098-update-source-resolution-accepts-resolution-options.md): the resolution options of the source resolution.
- [ADR 101](101-update-source-pair-accepted-whole-or-not-at-all.md): the source pair refusal that this ADR replaces with a type.
- [ADR 104](104-update-path-derives-omitted-verification-method-and-beacon.md): the derived ids.
- [ADR 119](119-api-takes-a-separate-signer-for-the-beacon-transaction-input.md): the signer of the beacon input, now `announce.signer`.

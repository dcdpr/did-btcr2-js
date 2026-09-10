# ADR 112: The Update Paths Check the Proof Fields and the Proof Time Window, Accept an Embedded Verification Method, Apply the JSON Patch Strictly, and Raise INVALID_DID_UPDATE

- **Status:** Accepted
- **Date:** 2026-09-10
- **Packages:** `@did-btcr2/common` (the `strict` patch option), `@did-btcr2/method`; dependency uptake and the `DEACTIVATION_PATCH` re-export in `@did-btcr2/api`; documentation only in `@did-btcr2/cli`

## Context

Four specification pull requests define the checks of the update read path and the update write path after ADR 109 and ADR 111:

- Pull request 345 (merged 2026-08-20) defines the patch failure rule. JSON Patch operations are evaluated in order. The first operation that fails, including a failed `test` operation, fails the whole patch. A patch that is malformed or fails to apply raises `INVALID_DID_UPDATE` on both paths. The patched document must conform to DID Core v1.1, and its `id` must equal the DID; otherwise `INVALID_DID_UPDATE`.
- Pull request 351 (merged 2026-09-01) hardens "Check `update.proof`". The resolver raises `INVALID_DID_UPDATE` unless `proofPurpose` equals `"capabilityInvocation"`, `capabilityAction` equals `"Write"`, and `capability` equals `urn:zcap:root:${encodeURIComponent(did)}`. The resolver finds the entry of `capabilityInvocation` that identifies `proof.verificationMethod`: a reference entry when the values are equal, an embedded verification method object when its `id` is equal. It reads `publicKeyMultibase` from the embedded object, or from the member of `verificationMethod` with the referenced `id`. Each miss raises `INVALID_DID_UPDATE`. When `created` or `expires` is present, the resolver checks each value against the block of the Beacon Signal: `created` after the header timestamp, `expires` before the block `mediantime`, or `expires` before `created` raises `INVALID_DID_UPDATE`. Footnote 5 explains the two references: a controller signs a short time before the block, so `created` uses the header timestamp; `expires` limits a replay, so it uses `mediantime`, which a single miner cannot change.
- Pull request 353 (merged 2026-08-28) replaces the private key input of the update operation with a signer. Implementations SHOULD verify `update.proof` before they announce the update, with the public key of the verification method. An announced update with an invalid proof permanently invalidates the DID.
- Pull request 354 (merged 2026-09-03) adds the `deactivate` operation signature. Deactivate is the update operation with a predetermined patch that adds `deactivated: true`.

The implementation at method 0.63.0 differed on every point:

- The read path derived a root capability from `proof.capability` with `Appendix.dereferenceZcapId` and compared its `controller` and `invocationTarget` with the DID. A `capability` with a different percent-encoding of the same DID passed. The length check of `dereferenceZcapId` counted the four destructured slots and could not fail. `proofPurpose` failed inside the cryptosuite as a `DataIntegrityProofError` of type `PROOF_VERIFICATION_ERROR`. `capabilityAction` was not checked: a proof that named `"Read"` passed. A wrong `type` or `cryptosuite` failed as a `MethodError` of type `PROOF_VERIFICATION_ERROR`.
- Both paths accepted an embedded entry of `capabilityInvocation` for the membership test (ADR 091), but the key lookup (`DidBtcr2.getSigningMethod`) searched `verificationMethod` only. A method that the document embeds and does not list in `verificationMethod` failed with a `DidError` of code `InternalError` on both paths. The write path raised `INVALID_DID_DOCUMENT` when no entry identified the method.
- `JSONPatch.apply` in the common package called fast-json-patch without operation validation. A `remove` or a `replace` of a missing path passed silently. An unknown `op` on the root path was ignored. A missing `value` wrote `undefined`, which JSON drops. Only a failed `test` failed the patch. A failure surfaced as a `MethodError` of type `JSON_PATCH_APPLY_ERROR` on both paths. The read path did not check the `id` after the patch, and a conformance failure surfaced as a `DidDocumentError` of type `INVALID_DID_DOCUMENT`.
- The read path did not check `created` or `expires`. `applyUpdate` received no block.
- `Updater.sign` did not verify the proof it made. The key comparison of ADR 051 refused a signer whose public key differs from the method, but a signer that returns a wrong signature for the right key passed.
- `deactivate` existed in the api only (ADR 094), with the patch constant `DidMethodApi.DEACTIVATION_PATCH`.
- `capability` and `capabilityAction` were optional in the `Btcr2DataIntegrityProof` and `Btcr2DataIntegrityConfig` types.
- `DidBtcr2.update` did not validate `sourceVersionId`: `Number(undefined)` is `NaN`, and `NaN + 1` became the `targetVersionId`.

## Decision

**The read path checks each proof field by string equality before it verifies the signature.** `applyUpdate` raises a `ResolveError` of type `INVALID_DID_UPDATE` unless `proof.type` equals `"DataIntegrityProof"`, `proof.cryptosuite` equals `"bip340-jcs-2025"`, `proof.proofPurpose` equals `"capabilityInvocation"`, `proof.capabilityAction` equals `"Write"`, and `proof.capability` equals `urn:zcap:root:${encodeURIComponent(currentDocument.id)}`. The checks run after the `@context` checks (ADR 109) and before the method lookup. The error message names the field. The root capability is not derived and not invoked: the specification makes the derivation optional, and string equality is the rule it states. `Appendix.dereferenceZcapId` stays as a public utility, with a length check that counts the components of the split.

**Both paths locate the verification method through the entry of `capabilityInvocation`.** Two helpers in `Appendix` implement the rule of the specification. `capabilityInvocationEntry(document, methodId)` returns the entry that identifies the method id, in the reference form or the embedded form, or `undefined`. `verificationMethodOfEntry(document, entry)` returns the embedded object, or the member of `verificationMethod` whose `id` equals the reference, or `undefined`. Both spellings of a DID URL match (ADR 091). The read path raises `INVALID_DID_UPDATE` with the message "not authorized for capabilityInvocation" when no entry identifies the method, and `INVALID_DID_UPDATE` with the message "not found" when a reference names no member. The write path (`DidBtcr2.update`) raises an `UpdateError` of type `INVALID_DID_UPDATE` for the same two conditions; before, the type was `INVALID_DID_DOCUMENT`. `DidBtcr2.getSigningMethod` also searches the embedded methods of the verification relationships, after `verificationMethod`; its error type does not change.

**The read path checks the proof time window against the block of the Beacon Signal.** `applyUpdate` takes the block metadata of the tuple. When `proof.created` is present, it must be an XML Datetime and must not be after the header `time` of the block. When `proof.expires` is present, it must be an XML Datetime and must not be before the block `mediantime`. When both are present, `expires` must not be before `created`. Each comparison is in milliseconds with no tolerance. Each failure raises `INVALID_DID_UPDATE`. The write path sets neither field; this decision does not add them.

**Both paths apply the JSON Patch strictly and raise `INVALID_DID_UPDATE`.** `JSONPatch.apply` in the common package takes a `strict` option. With `strict: true`, the operation validation of the common package requires an RFC 6902 `op`, a `value` for `add`, `replace`, and `test`, and a `from` for `move` and `copy`; and fast-json-patch validates each operation against the document, so a `remove` or a `replace` of a missing path, a `move` or a `copy` from a missing path, an `add` under a missing parent, and a failed `test` fail the patch at the first failing operation. The default stays `false`, so the other callers of the common package do not change; the default flips at the next major version of the common package. Both method paths pass `strict: true` and wrap the failure: `UpdateError` on the write path, `ResolveError` on the read path, both of type `INVALID_DID_UPDATE`, with the message of the failing operation. After the patch, both paths check that the `id` did not change and that the document conforms to DID Core; the read path now raises `ResolveError` of type `INVALID_DID_UPDATE` for both, as the write path did.

**Every failure of an update path that the specification names raises `INVALID_DID_UPDATE`.** The method package wraps the errors of the cryptosuite, the multikey, the hash decoder, and the common package inside `applyUpdate`, `Updater.construct`, and `Updater.sign`. The wrapped error carries the type and the message of the inner error in `data.cause`. The cryptosuite stays method-agnostic (ADR 054) and keeps its own error types. The typed-error policy of ADR 085 applies: no raw `Error` on either path.

**`Updater.sign` verifies the proof before it returns.** After `addProof`, the method builds a multikey from the verification method (the published `publicKeyMultibase`, not the signer) and verifies the signed update with the `capabilityInvocation` purpose. A failure raises an `UpdateError` of type `INVALID_DID_UPDATE` before the state machine emits `NeedFunding`, so a signer that returns a wrong signature spends no beacon UTXO.

**The method package exposes `deactivate`.** `DidBtcr2.deactivate({ sourceDocument, sourceVersionId, verificationMethodId, beaconId })` returns the `Updater` of `DidBtcr2.update` with the patch `[{ "op": "add", "path": "/deactivated", "value": true }]`. The method package exports the constant `DEACTIVATION_PATCH`, and `DidMethodApi.DEACTIVATION_PATCH` becomes a reference to it. The method-level operation does not refuse a deactivated source: ADR 100 keeps that product guard in the api, at the chokepoint that every api write path passes through.

**`capability` and `capabilityAction` are required in the update proof types.** `Btcr2DataIntegrityProof` and `Btcr2DataIntegrityConfig` require both fields, as the Data Integrity Config data structure does.

**`DidBtcr2.update` validates `sourceVersionId`.** The value must be an integer that is at least `1`. Every other value raises an `UpdateError` of type `INVALID_DID_UPDATE` before any other check.

## Scope boundary

- The root capability is not invoked per ZCAP-LD. The specification makes it optional.
- The `domain` and `challenge` proof options are not used by the update paths.
- The error type of `DidBtcr2.getSigningMethod` (a `DidError`) is a residual of the typed-error audit (ADR 085) and does not change here.
- The api and the cli add no flag and no command. The api `deactivate` keeps its signature and its guard (ADR 100).
- Footnote 2 of "Resolve" (the lowest block height of a duplicate) stays deferred (ADR 111).

## Consequences

**Positive.** The read path applies the rule of "Check `update.proof`" field by field: a proof that names the `"Read"` action, a `capability` in another spelling, or a wrong `type` fails with the typed error and a message that names the field. A document that embeds its update key in `capabilityInvocation` resolves and updates. A patch that a lenient library applies with no effect fails at construction, before it is signed and announced; before, such an update resolved here and failed on a strict resolver. A proof with a time window outside the block fails. A signer that returns a wrong signature is refused before funding. An api or cli consumer can match one error type, `INVALID_DID_UPDATE`, for every update failure that the specification names.

**Negative (breaking, method MINOR at 0.x).** The write path raises `INVALID_DID_UPDATE` where it raised `INVALID_DID_DOCUMENT` for a method that is not authorized or not found. The read path raises `ResolveError` of type `INVALID_DID_UPDATE` where it raised `MethodError` of type `JSON_PATCH_APPLY_ERROR`, `DidDocumentError` of type `INVALID_DID_DOCUMENT`, or a cryptosuite error. An update whose patch removes or replaces a missing path fails on both paths; before, it passed. An update whose proof carries `created` or `expires` outside the block window fails to resolve; the packages of this repository never emitted those fields. The proof types require `capability` and `capabilityAction`. A `sourceVersionId` that is not a positive integer is refused. The common package change is additive (MINOR): the `strict` option defaults to `false`.

**Unchanged.** The signed update format, the signal bytes, the proofs, and the test-suite vectors: this decision changes what the paths check, not what they emit. The `@context` pin (ADR 109). The membership rule and the relative DID URL matching (ADR 091). The signing-key comparison (ADR 051). The resolver loop and the resolution options (ADR 111). The api `deactivate` guard (ADR 100).

**Superseded.** The rule that ADR 088 quotes ("locate the method in `current_document.verificationMethod`") is superseded by pull request 351; the decision of ADR 088 (membership before signature verification) stands. The placement of the deactivation patch constant in the api (ADR 094) is superseded by the method export; the api operation and its guard stand.

## Implementation

- `packages/common/src/json-patch.ts`: the `strict` option of `JSONPatch.apply`; the tightened `validateOperations`.
- `packages/method/src/core/resolver.ts`: `applyUpdate(currentDocument, update, block)`: the field checks, the entry lookup, the time window, the strict patch, the `id` check, the error wrapping.
- `packages/method/src/core/updater.ts`: the strict patch in `construct`; the proof verification in `sign`.
- `packages/method/src/did-btcr2.ts`: the `sourceVersionId` guard; the entry lookup in `update`; `deactivate`; the embedded search in `getSigningMethod`.
- `packages/method/src/core/btcr2-update.ts`: `DEACTIVATION_PATCH`; the required proof fields.
- `packages/method/src/utils/appendix.ts`: `capabilityInvocationEntry`, `verificationMethodOfEntry`; the `dereferenceZcapId` length check.
- `packages/api/src/method.ts`: `DEACTIVATION_PATCH` from the method package.
- `packages/method/src/utils/error-cause.ts`: `errorCause` for the `data.cause` of a wrapping error.
- Tests: `packages/common/tests/json-patch.spec.ts`; `packages/method/tests/resolver.spec.ts`, `updater.spec.ts`, `relative-did-url.spec.ts`; `packages/api/tests/did-method-api.spec.ts`; the eight `@did-btcr2/aggregation` test helpers that sign a fixture cast the result to `SignedBTCR2Update` (the required proof fields).
- Docs: `packages/common/README.md`, `packages/method/README.md`, `packages/api/README.md`, `packages/cli/docs/update.md`, `packages/cli/docs/deactivate.md`.

## References

- Specification, "Resolve": "Apply `update`", "Check `update.proof`" (footnote 5).
- Specification, "Update": "Construct BTCR2 Unsigned Update", "Construct BTCR2 Signed Update".
- Specification, "Deactivate".
- Specification, "Data Structures": "BTCR2 Unsigned Update", "Data Integrity Config", "Root Capability".
- Specification pull requests 345 (2026-08-20), 351 (2026-09-01), 353 (2026-08-28), 354 (2026-09-03).
- RFC 6902, section 4 (operations) and section 5 (error handling).
- ADR 051 (the signing-key comparison in `Updater.sign`).
- ADR 054 (the method-agnostic cryptosuite).
- ADR 085 (the typed-error policy).
- ADR 088 (membership before signature verification).
- ADR 091 (relative DID URLs on both paths).
- ADR 094 and ADR 100 (deactivation in the api; the deactivated-source guard).
- ADR 109 (the `@context` pin).
- ADR 111 (the resolver loop; the scope boundary that named the proof window).

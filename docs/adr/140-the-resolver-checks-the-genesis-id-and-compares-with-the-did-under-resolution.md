# ADR 140: The Resolver Checks the Genesis Id and Compares With the DID Under Resolution

- **Status:** Accepted
- **Date:** 2026-10-07
- **Packages:** `@did-btcr2/method` (MINOR: a genesis document whose id is not the placeholder fails with `INVALID_DID_DOCUMENT`; the error data of the patched-id check changes); `@did-btcr2/api` (MINOR: the browser bundle holds the method package, and `resolve` and `getInitialDocument` refuse the same genesis document); `@did-btcr2/cli` (PATCH: dependency uptake)

## Context

The specification (Data Structures, Genesis Document) says: "A Genesis Document is a DID document (data structure) with the identifier set to the placeholder value (`did:btcr2:_`)." The specification (Resolve, Establish `current_document`) replaces the placeholder with `did` to make `current_document`. The specification uses `did`, the DID under resolution, in each later step:

1. Check `update.proof`: "`update.proof.capability` equals the `capability` URN that Data Integrity Config (data structure) specifies for `did`" and "`update.proof.invocationTarget` equals `did`".
2. Apply `update`: "Verify that `current_document` conforms to DID Core v1.1 and that `current_document.id` equals `did`."
3. Process CAS Beacon: "Read `update_hash` from the announcement entry keyed by `did`."
4. SMT Proof Verification: "`hash(did)` denotes `hash()` over the UTF-8 bytes of the DID string."

`Resolver.external` checked the hash of the genesis document and replaced the placeholder. It did not check the id of the genesis document. Thus a genesis document with the id of another DID made a `current_document` whose id was not `did`. The resolver then used `current_document.id` where the specification uses `did`:

- `applyUpdate` compared `proof.capability` and `proof.invocationTarget` with `current_document.id`.
- `applyUpdate` compared the id of the patched document with the id before the patch, not with `did`.
- The `BeaconProcess` phase gave `current_document.id` to `BeaconFactory.establish`. The CAS beacon read the announcement entry of that id, and the SMT beacon verified the proof at the index of that id ([ADR 091](091-inject-did-into-beacons-and-relative-did-urls.md)).

An example: the controller of an `x1` DID copies the initial document of a `k1` DID as the genesis document. The `x1` DID resolves to a document whose id is the `k1` DID. An update that the `k1` DID signed also applies to the `x1` DID. The result breaks DID Resolution v1: "The value of id in the resolved DID document MUST be string equal to the DID that was resolved."

## Decision

### 1. The genesis document must have the placeholder id

`Resolver.external` refuses a genesis document whose `id` is not `did:btcr2:_`. The check runs after the hash check, in the order of the specification: Process Sidecar Data checks the hash, and Establish `current_document` replaces the placeholder. The check looks at the top-level `id` only. A document that has the placeholder as its `id` gets the DID as its `id` from the replacement.

### 2. The error is `INVALID_DID_DOCUMENT`

The specification names no error code for this step. The resolver raises a `ResolveError` of type `INVALID_DID_DOCUMENT`, with the data `{ id }`. The message is `Invalid genesis document: the id must be "did:btcr2:_", got <id>`. The same step raises `INVALID_DID_DOCUMENT` if the result is not a conformant DID document. The DID is well formed, and the hash of the document matches its genesis bytes. Thus the fault is in the document, not in the DID.

### 3. The resolver compares with the DID under resolution

The `Resolver` constructor encodes the DID once from the DID components and keeps it as `#did`. The value is the same string that `Resolver.external` and `Resolver.deterministic` write as the document id. The resolver uses `#did` in each place where the specification uses `did`:

- `applyUpdate` gets `did` as a new first parameter. It compares `proof.capability` with `urn:zcap:root:${encodeURIComponent(did)}`, and `proof.invocationTarget` with `did`.
- `applyUpdate` compares the id of the patched document with `did`. The message is `Invalid update: the patched document id is not the DID (expected <did>, got <id>)`, and the data is `{ did, id }`. Before, the data was `{ sourceId, targetId }` and the message said "the patch changes the document id". That text is false if the document id before the patch is not the DID.
- The `BeaconProcess` phase gives `#did` to `BeaconFactory.establish`. Thus the CAS beacon reads the announcement entry of `did`, and the SMT beacon verifies the proof at `hash(did)`. This decision replaces the source of the DID in [ADR 091](091-inject-did-into-beacons-and-relative-did-urls.md) ("The `Resolver` supplies `currentDocument.id`"). The injection of the DID into the beacon stays.

### 4. Two uses of `current_document.id` stay

`applyUpdate` still gives `currentDocument.id` to `Appendix.absoluteDidUrl` for the verification method id and to `Appendix.capabilityInvocationEntry`. These lookups find a verification method in `current_document`. A relative DID URL in the document is relative to the document id. After the checks of this ADR, the id equals `did` on each path of `DidBtcr2.resolve`, so the change has no effect there. A test that changed the `absoluteDidUrl` argument to `did` found no difference.

## Alternatives

- **The error `INVALID_DID`.** Rejected. The audit proposed it. `INVALID_DID` tells the caller that the DID is not well formed or that its genesis bytes do not match the document. Neither is true here.
- **Only the genesis check.** Rejected. After the genesis check, `current_document.id` equals `did` on each path of `DidBtcr2.resolve`. But the specification names `did` in the four steps, and the code now reads as the specification. The `Resolver` constructor also takes a `currentDocument`, and the tests use it to show that each check uses `did`.
- **A check of the result id after the replacement.** Rejected as the only check. A genesis document with the id of another DID and no placeholder gives a result whose id is not `did`, so this check also refuses it. But the error then names the result, not the genesis document that the controller wrote. The check on the genesis id is the rule of the specification.

## Consequences

- A genesis document whose `id` is not `did:btcr2:_` fails to resolve. Before, it resolved to a document for another DID. The api create path (`createExternalFromDocument`, `assertGenesisDocument`) and `Identifier.validate` already refused such a document. Thus a DID that this library created does not change.
- An update signed for another DID fails at the `capability` check, also if the document id is that other DID.
- A caller that reads `data.sourceId` or `data.targetId` of the patched-id error must read `data.did` and `data.id`.
- Each test vector has `did:btcr2:_` as the id of its genesis document (241 genesis documents in `packages/api/lib/data`). The vectors do not change.

## Implementation

- `packages/method/src/core/resolver.ts`: `#did` and the constructor; `Resolver.external` (the placeholder check); `applyUpdate` (the `did` parameter, the proof fields, the patched-id check); the `BeaconProcess` and `ProcessUpdate` phases.
- `packages/method/tests/resolve-external.spec.ts`: the test "rejects a genesis document whose id is not the placeholder with INVALID_DID_DOCUMENT".
- `packages/method/tests/resolver.spec.ts`: the tests "the DID under resolution (ADR 140)", and the new message of the patched-id test.

## References

- [did:btcr2 specification, Genesis Document](https://dcdpr.github.io/did-btcr2/data-structures.html#genesis-document) and [DID Document](https://dcdpr.github.io/did-btcr2/data-structures.html#did-document).
- [did:btcr2 specification, Establish `current_document`](https://dcdpr.github.io/did-btcr2/operations/resolve.html#establish-current-document), [Apply `update`](https://dcdpr.github.io/did-btcr2/operations/resolve.html#apply-update), [Check `update.proof`](https://dcdpr.github.io/did-btcr2/operations/resolve.html#check-update-proof), and [Process CAS Beacon](https://dcdpr.github.io/did-btcr2/operations/resolve.html#process-cas-beacon).
- [did:btcr2 specification, SMT Proof Verification](https://dcdpr.github.io/did-btcr2/algorithms.html#smt-proof-verification).
- [DID Resolution v1](https://www.w3.org/TR/did-resolution/).
- [ADR 091](091-inject-did-into-beacons-and-relative-did-urls.md): the injection of the DID into the beacons.
- [ADR 112](112-update-paths-check-the-proof-fields-and-apply-the-patch-strictly.md): the proof field checks of the read path.

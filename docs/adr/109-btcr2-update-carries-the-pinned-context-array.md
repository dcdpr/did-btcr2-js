# ADR 109: A BTCR2 Update carries the pinned `@context` array, and the resolver rejects any other array

- **Status:** Accepted
- **Date:** 2026-09-09
- **Packages:** `@did-btcr2/method`; dependency uptake in `@did-btcr2/api` and `@did-btcr2/cli`; README only in `@did-btcr2/cryptosuite`

## Context

Specification pull request 351 (merged 2026-09-01) pins the `@context` array of a BTCR2 Update. The section "BTCR2 Unsigned Update (data structure)" says that the array MUST contain exactly four context URLs, in this order: `https://w3id.org/json-ld-patch/v1`, `https://w3id.org/zcap/v1`, `https://w3id.org/security/data-integrity/v2`, `https://btcr2.dev/context/v1`. The section "Data Integrity Config (data structure)" says that the proof `@context` MUST contain the same URLs in the same order. The step "Check update.proof" of the resolve operation raises `INVALID_DID_UPDATE` if the update `@context` is not that array, or if the proof `@context` is not equal to it. Two arrays are equal when they contain the same URLs in the same order.

The array is part of the bytes that the JSON Document Hashing algorithm hashes and that the Data Integrity proof signs. The hash of the signed update is the value that a beacon signal announces on chain. The hash of the unsigned update is the value that the resolver keeps in its update hash history. An update with a different array is a different update. No party can change the array of an announced update.

`Updater.construct` in the method package emitted a different array since the first release: `https://w3id.org/security/v2`, `https://w3id.org/zcap/v1`, `https://w3id.org/json-ld-patch/v1`, `https://btcr2.dev/context/v1`. One member was wrong (`security/v2` in place of `security/data-integrity/v2`), and the order was different. The cryptosuite copies the document `@context` into the proof, so every proof carried the same wrong array. The resolver checked no `@context` on the read path. A resolver that follows the specification rejects every update that this implementation announced. The example corpus of the specification is built with the published packages of this repository, and its generator records this difference as a known gap.

This decision lands alone, before the other changes that align the method package with the specification. Every update that a controller announces with the old array stays non-conformant on chain. For this reason the change to the emitted array cannot wait for the rest of the read-path work.

## Decision

**The method package exports the pinned array.** `BTCR2_UPDATE_CONTEXT` is a frozen array with the four URLs in the order of the specification. `Updater.construct` writes a copy of it into every unsigned update. `Updater.sign` passes a copy in the proof configuration. The cryptosuite copies the document `@context` into the proof when the document has one, so the proof `@context` equals the update `@context` by construction. The `@context` type of `UnsignedBTCR2Update` stays `string[]`: the wire value is a JSON array, and the read path validates it at run time.

**The resolver rejects any other array.** `Resolver.applyUpdate` checks two conditions before the capability checks and before signature verification:

1. The update `@context` is an array with the same members as `BTCR2_UPDATE_CONTEXT`, in the same order, and with no other member.
2. The proof `@context` is equal to the update `@context` by the same rule.

A failure raises a `ResolveError` of type `INVALID_DID_UPDATE`. The message names the array, not the signature: a wrong array also invalidates the signature, but the array is the cause. The exported guard `isBtcr2UpdateContext(value, expected?)` implements the equality rule.

**The duplicate path does not run the check.** The resolver confirms a re-announcement of an applied update by its hash against the update hash history (ADR 067). The hash covers the array, so a duplicate with a different array fails as a false duplicate. The `provide()` shape guard for a signed update stays a shape guard: the specification places the check in "Check update.proof".

## Scope boundary

- The other conditions of "Check update.proof" (`proofPurpose`, `capabilityAction`, string equality of `capability`, embedded verification methods, `created` and `expires`) do not change here. A later decision covers them.
- The cryptosuite stays method-agnostic (ADR 054). It copies and signs the `@context` and does not know the pinned value. The check lives in the method package.
- The api and the cli change no code. They take the new method version.
- The aggregation package tests hash fake updates with the old array and never resolve them. They do not change.

## Consequences

**Positive.** An update that this implementation announces from this version on conforms to the specification, and a conformant resolver of another implementation accepts it. The resolver of this implementation enforces the rule on an update from any source. The example corpus generator of the specification can drop its workaround for the array when the specification pins the new package version.

**Negative.** Every update signed with method 0.60.0 or earlier fails on this version with `INVALID_DID_UPDATE`. There is no migration: the array is inside the signed bytes, so no party can re-label an announced update. The affected identifiers are test identifiers on regtest and mutinynet; no mainnet deployment exists. The test-suite vectors under `packages/method/lib/data`, the Danubetech vectors under `packages/method/lib/debug`, and the api scripts `lib/test-api.ts` and `lib/test-fullnode.ts` carry the old array and stop resolving until they are regenerated. The Danubetech interop harness result changes from 16 of 16 to 0 of 16 until Danubetech adopts the pinned array; their vectors carry a third order.

**Neutral.** The printed output of the cli `update` command shows the new array inside the signed update. The README examples of the cryptosuite package show the new array.

## Implementation

- `packages/method/src/core/btcr2-update.ts`: `BTCR2_UPDATE_CONTEXT`, `isBtcr2UpdateContext`; the `@context` JSDoc of `UnsignedBTCR2Update` and `Btcr2DataIntegrityConfig`.
- `packages/method/src/core/updater.ts`: `construct` and `sign` use the constant.
- `packages/method/src/core/resolver.ts`: the two checks at the top of `applyUpdate`.
- `packages/method/src/utils/appendix.ts`: the JSDoc example array of `dereferenceZcapId`.
- Tests: `packages/method/tests/updater.spec.ts` (the emitted array, a fresh copy per update, the proof array); `packages/method/tests/resolver.spec.ts` (the old array, a permuted array, a missing member, an extra member, an empty array, a string, a proof array that differs, a proof with no array, the check order, a duplicate).
- Docs: `packages/method/README.md`, `packages/cryptosuite/README.md`.

## References

- Specification, "Data Structures", "BTCR2 Unsigned Update (data structure)": the pinned array, and the note that a change to the membership or the order changes the hash.
- Specification, "Data Structures", "Data Integrity Config (data structure)": the proof `@context` rule.
- Specification, "Resolve", "Check update.proof": the two `INVALID_DID_UPDATE` conditions.
- Specification pull request 351, "Pin the update `@context`, harden the resolve-path proof checks, regenerate the examples" (merged 2026-09-01).
- ADR 054 (the cryptosuite is method-agnostic): the reason the check lives in the method package.
- ADR 067 (duplicate confirmation by hash): the reason the duplicate path does not run the check.
- ADR 085 (typed errors): the `ResolveError` type of the failure.
- ADR 088 (read-path authorization): the check order in `applyUpdate`; the array checks now run first.

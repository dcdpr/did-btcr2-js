---
title: "ADR 010: did:btcr2 v0.2 Spec Alignment and Spec-Tracking Policy"
---

# ADR 010: did:btcr2 v0.2 Spec Alignment and Spec-Tracking Policy

**Status:** Accepted

**Date:** 2026-02-13

**Commits:** [`5578915`](https://github.com/dcdpr/did-btcr2-js/commit/5578915), [`fd33387`](https://github.com/dcdpr/did-btcr2-js/commit/fd33387), [`2f56b5c`](https://github.com/dcdpr/did-btcr2-js/commit/2f56b5c)

## Context

The [did:btcr2 specification](https://dcdpr.github.io/did-btcr2/) is developed in the open at DCDPR and versioned. The reference implementation (this repo) exists to track that spec as closely as the test suite and codebase can afford to. Between August 2025 and February 2026 the spec moved from v0.1 to v0.2, touching:

- **Terminology.** Several names in the spec were renamed for clarity and to align with the broader W3C DID ecosystem. Notably: the CRUD-verb "read" became "resolve" to match W3C resolution vocabulary; update-flow types gained the `BTCR2` prefix and a consistent singular shape (`SignedBTCR2Update`, `UnsignedBTCR2Update`); the identifier/components naming was tightened (`identifier` to `did`, `identifierComponents` to `didComponents`).
- **Beacon model.** The v0.1 beacon design used a stateful `AggregateBeacon` base class that held mutable signals, sidecar data, and a Bitcoin client reference on the instance. v0.2 specifies beacons as lightweight, stateless handlers: one instance = one configured service; signals and sidecar data are passed in as method parameters.
- **Update flow.** v0.2 restructures `DidBtcr2.update()` to take a named-parameter object (`{ sourceDocument, patches, sourceVersionId, verificationMethodId, beaconId, signingMaterial, bitcoin }`) rather than a long positional argument list. Single-beacon announcements replace multi-beacon (`beaconIds: Array<string>`) everywhere.
- **Resolution flow.** Signal discovery is factored into a dedicated class rather than being a method on the resolver. Parallelization of beacon-signal processing (`Promise.all`) lands here. The `fullBlockchainTraversal` flag is removed: the resolver always walks forward through block history, with no branching.
- **Spec references.** Section numbering shifted (old §4.x to new §7.x). Every code-side `@see` link needed updating.

This wasn't a small diff. Three commits spanning ~3 weeks landed the v0.2 alignment: `5578915` / `fd33387` (2026-01-21) for terminology and initial renames, `2f56b5c` (2026-02-13) for the beacon and update architectural changes.

The larger question this work surfaced: and the reason it deserves an ADR rather than just a PR description: is **what the project's stance is toward spec revisions**. Two answers were possible.

## Options considered

1. **Track the latest spec version unconditionally, accepting breaking changes as they come.** The reference implementation stays canonical. Consumers pin to specific library versions to stay on older spec versions if they must. The library never pretends to implement both v0.1 and v0.2 simultaneously.
2. **Support multiple spec versions simultaneously behind a configuration flag or a discriminator.** The library exposes both v0.1 and v0.2 code paths; callers pick. This matches what some other DID-method reference implementations do, and smooths the adoption curve for downstream consumers.

## Decision

**Option 1.** The implementation tracks the current spec. When the spec makes a breaking change, the library makes a breaking release. There is no dual-path support for older spec versions, no "compatibility mode" flag, no feature gating.

The v0.2 migration is the first exercise of this policy. Concretely:

**Terminology (BREAKING, across multiple packages):**
- `Read` to `Resolve` throughout (class names, directory names, types, error classes).
- `identifierComponents` to `didComponents`; `identifier` to `did`; `BTCR2SignedUpdate` to `SignedBTCR2Update`; `BTCR2UnsignedUpdate` to `UnsignedBTCR2Update`.
- `CIDAggregateBeaconError` to `CASBeaconError`; `SMTAggregateBeaconError` to `SMTBeaconError`.
- `MethodError` to `ResolveError` (in resolve), `MethodError` to `UpdateError` (in update): error types specialized per operation.
- `IDidDocument` to `Btcr2DidDocument`; `IDidVerificationMethod` to `Btcr2VerificationMethod`; `IIDidDocument` to `W3CDidDocument`.
- `SchnorrMultikey.fromPrivateKey` to `fromSecretKey`; `fromPublicKeyMultibase` to `fromVerificationMethod`.
- `Secp256k1SecretKey.fromEntropy` / `SchnorrKeyPair.fromEntropy` to `fromBigInt`: the "entropy" vocabulary implied a specific seed-handling contract the API didn't actually guarantee.
- `Signer.signEcdsa` to `sign`; `Signer.sign` to `signSchnorr`: to align with the PSBT signer interface that expects `sign` to be the ECDSA path. (Note: `Signer` itself is later removed by [ADR 012](012-kms-dual-signing-urn-identifiers.md); the rename applied during v0.2 but was short-lived.)
- `Update.construct` / `Update.invoke` to `Update.construct` / `Update.sign`. `Resolve.processSidecarData` to `sidecarData`; `establishCurrentDocument` to `currentDocument`; `processBeaconSignals` to `beaconSignals`; `processUpdatesArray` to `updates`; `confirmDuplicateUpdate` to `confirmDuplicate`; `applyDidUpdate` to `applyUpdate`. (Process-prefix removed: "process" added nothing to names that were already verbs.)

**Beacon architectural change:**
The v0.1 `AggregateBeacon` base class held mutable state: signals, sidecar, bitcoin client: on the instance. The v0.2 `Beacon` base class holds only the beacon's `service`. Signals, sidecar, and any transport are passed in as method parameters. `BeaconFactory.establish(service)` returns a `Beacon` typed by the service's beacon type; callers then invoke `beacon.processSignals(signals, sidecar, ...)` with data they already have. This change is what makes the later sans-I/O refactor possible: stateless beacons are a prerequisite for the state-machine design in [ADR 016](016-sans-io-resolver.md) and [ADR 025](025-sans-io-updater.md).

Related concrete fixes that came along:
- Replace `process.exit(1)` calls in beacon utilities with proper `BeaconError` exceptions.
- Hoist the beacon-services map outside the inner loop in signal discovery (performance; O(services × signals) to O(signals)).
- Fetch block count once before the loop rather than per-iteration.

**Update flow:**
- `DidBtcr2.update()` takes a single named-params object. No more 7 positional arguments.
- Signing material validation and hex-to-bytes conversion moved up to the top-level `DidBtcr2.update()`: validation once at the public boundary, not repeated internally.
- `Update.sign` requires `secretKey: KeyBytes` directly. No more optional `privateKey` with internal-to-bytes conversion. One path.
- `capabilityInvocation` now validated against the source document for the supplied `verificationMethodId`. Previously a missing capability slipped through; now it throws at the factory call.
- Capability URI (`urn:zcap:root:...`) inlined in `Update.sign`. The `Appendix.deriveRootCapability()` indirection added no value; one line of code is clearer than a named helper.
- Return type is `SignedBTCR2Update`, not `SidecarData`. The two concepts were being conflated.
- Multi-beacon (`beaconIds: Array<string>`) removed everywhere. Single-beacon (`beaconId: string`) is the only shape. The spec defines beacons as the per-controller authorization boundary; multi-beacon per-update never had a clear semantic.

**Spec links:** Every `@see https://dcdpr.github.io/did-btcr2/algorithms.html#...` link updated from the v0.1 §4.x anchors to v0.2 §7.x anchors.

**Version bumps:** api 0.1.1 to 0.2.0, cli 0.2.0 to 0.3.0, common 3.1.0, cryptosuite 4.0.0 to 5.0.0, keypair 0.8.0 to 0.9.0, kms 0.1.1 to 0.2.0, method 0.19.0 to 0.20.0. Coordinated breaking release across the graph.

## Consequences

**Positive**
- The reference implementation remains the authoritative answer to "what does the spec mean in code." There is no ambiguity about which version of the spec a particular library version implements: it's always the latest at time of release.
- Consumer integration code reads the current spec and matches the current library 1:1. No translation layer, no "this name in the library, that name in the spec" cross-reference table.
- The spec-alignment pressure forced out architectural cleanups that had been pending: the stateful `AggregateBeacon` being the biggest. Holding spec-compliance as the forcing function produced better code than a pure refactor would have, because the spec's stateless-beacon model was the right model and the code had drifted from it.
- Renames exposed inconsistencies (`fromEntropy` implying a contract the code didn't honor, `processXxx` adding noise without meaning) that were worth fixing even apart from spec alignment.

**Negative**
- Every release that tracks a breaking spec revision is a breaking library release. Downstream consumers on active development update imports; consumers pinning to older versions diverge from the spec over time. This is an accepted burden of being a reference implementation; the documentation is explicit about the policy so consumers know the contract.
- Rename storms are noisy in `git log` and `git blame`. Cross-commit history-walking over the January-February 2026 window requires recognizing that the rename waves happened at `5578915` and `2f56b5c`.
- Some of the renames in this wave were themselves reverted or replaced later (see [ADR 012](012-kms-dual-signing-urn-identifiers.md), which removes `Signer` entirely: making the `signEcdsa` / `signSchnorr` rename moot). That's a natural consequence of an actively-iterating spec and a young reference implementation; it is not a failure of the policy.

**Explicitly accepted trade-offs**
- **No semver-based spec-version mapping.** The library's major version does not track the spec's major version. This is deliberate: the library has its own API-stability concerns separate from spec versioning (internal refactors that don't change spec behavior but do break consumer imports, for example), and coupling the two would make every internal refactor a "spec break" in versioning terms. Consumers who need to map library-to-spec versions consult the `CHANGELOG.md` and the "Spec version" note in each release.
- **No long-lived deprecation window.** When the spec renames something, the library does too, and the old name is deleted in the same release. A deprecation-then-removal cycle would double the work for every spec revision and provide little benefit: consumers always have the prior pinned version.
- **No codegen from the spec.** The spec is a human-readable document; the library is a hand-written TypeScript implementation. Generating interfaces or test vectors from the spec would be a nice future project but is not today's mechanism.
- **v0.1 stays supported only at version pin.** There is no backport branch, no LTS for v0.1. Consumers on v0.1 either upgrade to match the current spec or stay on a pinned library version and accept that they're using a deprecated spec.

## References

- [did:btcr2 specification](https://dcdpr.github.io/did-btcr2/): the spec this reference implementation tracks.
- Commit `5578915` (2026-01-21): initial v0.2 terminology pass.
- Commit `fd33387` (2026-01-21): continued terminology alignment.
- Commit `2f56b5c` (2026-02-13): beacon architectural refactor and update-flow named-parameter reshape.
- [ADR 018](018-beacon-hierarchy.md): the final beacon-hierarchy shape that rests on the stateless-beacon decision made here.
- [ADR 025](025-sans-io-updater.md): the sans-I/O Updater that builds on the update-flow reshape from this wave.
- [ADR 012](012-kms-dual-signing-urn-identifiers.md): later KMS refactor that removed `Signer` entirely, superseding the `signEcdsa` / `signSchnorr` rename made during this wave.

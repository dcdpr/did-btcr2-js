---
title: "ADR 054: Make the bip340-jcs-2025 Cryptosuite Method-Agnostic"
---

# ADR 054: Make the bip340-jcs-2025 Cryptosuite Method-Agnostic

**Status:** Accepted

**Date:** 2026-06-27

**Branch / PR:** `refactor/cryptosuite-method-agnostic` (resolves [#92](https://github.com/dcdpr/did-btcr2-js/issues/92))

**References:** [ADR 002](002-jcs-canonicalization-and-cryptosuite.md), [ADR 025](025-sans-io-updater.md), [ADR 046](046-extract-aggregation-package.md), [ADR 050](050-split-aggregation-packages.md)

## Context

The `@did-btcr2/cryptosuite` package implements the `bip340-jcs-2025` Data Integrity proof suite ([ADR 002](002-jcs-canonicalization-and-cryptosuite.md)). The {@link https://dcdpr.github.io/data-integrity-schnorr-secp256k1/ | Data Integrity BIP340 Cryptosuites spec} defines a method-agnostic suite: it secures any JSON document (a Verifiable Credential, a DID document, anything) with a Multikey verification method and a BIP340 Schnorr signature over a JCS-canonicalized hash. Nothing in the suite is did:btcr2-specific.

The package's API said otherwise. `addProof` took an `UnsignedBTCR2Update` and returned a `SignedBTCR2Update`; the proof configuration (`DataIntegrityConfig`) carried the ZCAP `capability` and `capabilityAction` fields a did:btcr2 update proof uses; the cryptosuite and data-integrity-proof interfaces threaded these did:btcr2 types throughout. The cryptography was already generic, only the types were did:btcr2-shaped. As issue [#92](https://github.com/dcdpr/did-btcr2-js/issues/92) put it, the suite "should be generic, rather than BTCR2 specific," so any DID method, or a Verifiable Credential issuer, could sign a JSON document with it.

A consequence of the did:btcr2 typing: a consumer that only wanted a signed JSON document still had to reach for a did:btcr2 update type. The aggregation package, for example, imported `SignedBTCR2Update` from the cryptosuite purely to type the opaque signed blobs it shuttles into CAS announcements and SMT leaves; it never reads a single did:btcr2 field of them.

## Decision

### 1. Generic cryptosuite types

`addProof`, `createProof`, `verifyProof`, and `transformDocument` become generic over an unsecured document (a JSON record). The suite gains `UnsecuredDocument`, `SecuredDocument<T>` (`= T & { proof }`), `DataIntegrityProofOptions` (the standard proof options, with an index signature so a cryptosuite or application can carry extra proof properties), and `DataIntegrityProofObject` (options plus `proofValue`). `addProof<T>(document, options)` returns `SecuredDocument<T>`. The did:btcr2 types (`UnsignedBTCR2Update`, `SignedBTCR2Update`, `BTCR2Update`) and the ZCAP config fields leave the cryptosuite. Signing, canonicalization, and signature encoding are unchanged: this is a type-level generalization, not a behavior change.

### 2. did:btcr2 types live in the method package

The did:btcr2 update data structures and the did:btcr2 proof configuration (the standard options plus `capability`/`capabilityAction`) move to `@did-btcr2/method`, the package that owns did:btcr2 specifics. `method`, and the `api` and `cli` that depend on it, source them from there. They are declared as type aliases rather than interfaces, so they satisfy the suite's generic `UnsecuredDocument` (a `Record`) constraint.

### 3. The SDK crypto facade goes generic too

The SDK's Data Integrity facade (the `api` crypto sub-facade) mirrors the now-generic suite: `signDocument`, `addProof`, and `verifyDocument` are generic over the document. The SDK therefore exposes the suite's headline capability, signing any JSON document such as a Verifiable Credential, rather than only did:btcr2 updates.

### 4. Aggregation uses the generic secured-document type

Aggregation treats a signed update as an opaque secured document: it stores it, canonicalizes and hashes it for a CAS announcement or an SMT leaf, and never reads a did:btcr2 field. It now types those blobs as the cryptosuite's generic `SecuredDocument`. This repoints aggregation's one dependency on the moved type without adding a `method` dependency, keeping the package method-independent as it was extracted ([ADR 046](046-extract-aggregation-package.md), [ADR 050](050-split-aggregation-packages.md)).

## Consequences

- The cryptosuite is what the spec describes: a method-agnostic Data Integrity suite. A Verifiable Credential issuer, or another DID method, can sign and verify with it directly.
- Breaking change to `@did-btcr2/cryptosuite`: `UnsignedBTCR2Update`/`SignedBTCR2Update`/`BTCR2Update` and `DataIntegrityConfig` are gone, replaced by the generic types, and `addProof` is generic. Pre-1.0, this is a minor bump.
- `@did-btcr2/method` gains the did:btcr2 update types it always owned conceptually; `api` and `cli` source them from `method`. method's public surface grows by that re-export; the api and cli surfaces are otherwise unchanged.
- The breaking low-level bump cascades dependency-uptake bumps to the cryptosuite's dependents.
- Aggregation's public types that named `SignedBTCR2Update` now name `SecuredDocument`: a behavior-equivalent type-name change, a minor bump for aggregation.

## Rejected alternatives

- **Land the did:btcr2 types in `@did-btcr2/common`** so every consumer, aggregation included, keeps importing them unchanged. Rejected: `common` is the lowest shared layer, and pushing did:btcr2 update structures into it spreads method specifics downward, the opposite of what [#92](https://github.com/dcdpr/did-btcr2-js/issues/92) asks. The method package is the right owner.
- **Make aggregation depend on `method`** to keep importing `SignedBTCR2Update`. Rejected: it re-couples a deliberately method-independent package ([ADR 046](046-extract-aggregation-package.md), [ADR 050](050-split-aggregation-packages.md)) to `method`, for a type aggregation only ever uses opaquely. The generic `SecuredDocument` fits what aggregation actually does.
- **Leave the SDK crypto facade did:btcr2-typed.** Rejected: it would expose a generic suite through a did:btcr2-shaped door, defeating the Verifiable Credential use case [#92](https://github.com/dcdpr/did-btcr2-js/issues/92) calls out.
- **Declare the method did:btcr2 types as interfaces.** Rejected: TypeScript does not treat an interface as assignable to `Record<string, unknown>` (the suite's generic document constraint), so the generic `addProof` could not accept them. Type aliases carry the implicit index signature that makes them assignable.

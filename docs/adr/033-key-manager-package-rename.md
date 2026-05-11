---
title: "ADR 033: Rename `@did-btcr2/kms` to `@did-btcr2/key-manager`; `Kms` to `LocalKeyManager`; `KmsSigner` to `KeyManagerSigner`"
---

# ADR 033: Rename `@did-btcr2/kms` to `@did-btcr2/key-manager`; `Kms` to `LocalKeyManager`; `KmsSigner` to `KeyManagerSigner`

**Status:** Accepted

**Date:** 2026-05-18

**Branch / PR:** `refactor/kms-signing-flow`
**References:** [ADR 007](007-kms-package-boundary.md), [ADR 012](012-kms-dual-signing-urn-identifiers.md)

## Context

The package previously named `@did-btcr2/kms` (established by ADR 007 on 2025-10-28) provides the `KeyManager` interface, a default in-process implementation, and a `Signer` adapter that wraps any KeyManager. Three concrete naming choices in that package conflate "interface contract" with "this particular reference implementation":

- The class `Kms` reads as "this object IS a KMS." In industry usage, "KMS" connotes a managed cryptographic service: keys held in HSM-backed storage, network-dispatched APIs, audit logging, policy controls, no key export (AWS KMS, GCP KMS, Azure Key Vault, HashiCorp Vault Transit). The current class is an in-process `Map` of key entries holding raw secret bytes in the JS heap, with `exportKey()` available. It is the reference / dev implementation of a `KeyManager`, not a KMS.

- The class `KmsSigner` reads as "Signer adapter for the Kms class." The adapter actually wraps the `KeyManager` interface and works with any implementation. The current name implies coupling to one concrete class.

- The package name `@did-btcr2/kms` reinforces both inversions: it suggests the package *is* a KMS, when its role is to define the interface and ship a reference implementation. Long-term direction is to encourage users of `@did-btcr2/api` to bring their own KMS adapter (AWS, Vault, HSM, hardware wallet) by implementing the `KeyManager` interface; the package should make that posture obvious in its name.

The keypair package already establishes the right naming pattern: `Signer` is the contract; `LocalSigner` says "in-process implementation." The kms package broke that pattern by calling its in-process implementation `Kms`.

## Options considered

1. **Keep all names.** Status quo. Preserves prior ADR-007/012 surface but cements the overclaim.

2. **Rename only the classes; keep the package name.** Cleaner classes but the package label still over-promises.

3. **Rename the classes AND the package.** Surfaces the long-term direction (pluggable external KMS adapters) at every layer.

4. **Rename to `@did-btcr2/keystore`.** Accurate ("a store of keys") but loses the connection to "key management" which the interface covers (lifecycle, IDs, watch-only, active-key state). `keystore` reads as storage-only.

## Decision

**Option 3.** Three renames land together:

| Before | After |
|---|---|
| `@did-btcr2/kms` (package) | `@did-btcr2/key-manager` |
| `Kms` (class) | `LocalKeyManager` |
| `KmsSigner` (class) | `KeyManagerSigner` |

The interface name `KeyManager` (and `KeyManagerError` in `common`) was already correct and is preserved.

Internal package category labels are unaffected:
- The URN scheme stays `urn:kms:secp256k1:<fingerprint>` — that string is part of the data model, may appear in stored sidecar data, and consumers may already hold it. Decoupling the URN namespace from the package name keeps interop stable.
- The field name `KeyManagerApi.kms` is preserved as a category label callers use conversationally ("plug in your KMS"); the type is `KeyManager`.

The renamed classes and file paths:
- `packages/key-manager/src/local-key-manager.ts` (was `packages/kms/src/kms.ts`)
- `packages/key-manager/src/key-manager-signer.ts` (was `packages/kms/src/signer.ts`)

## Consequences

**Positive**
- Naming pattern is consistent with `keypair` (`Signer` + `LocalSigner`).
- `LocalKeyManager` accurately names what the class is — an in-process reference implementation, not a KMS.
- `KeyManagerSigner` makes the adapter's relationship to the interface explicit, leaving room for any concrete implementation to be wrapped.
- Package name signals the contract (`key-manager`) rather than one possible deployment (`kms`).
- Forward direction for `@did-btcr2/api`: callers supply their own `KeyManager` implementation against AWS KMS, GCP KMS, Azure Key Vault, HashiCorp Vault Transit, AWS CloudHSM, YubiHSM, etc. The bundled `LocalKeyManager` is for tests, scripts, and reference, not for production.

**Negative**
- Published `@did-btcr2/kms@0.5.0` consumers must rename imports and the workspace dependency. Concrete migration:
  - `import { Kms, KmsSigner } from '@did-btcr2/kms'`
  - becomes
  - `import { LocalKeyManager, KeyManagerSigner } from '@did-btcr2/key-manager'`
- Prior ADRs (007, 012) reference the old names. Per the project's forward-only ADR policy, those documents are not edited; this ADR is the canonical record going forward.
- `KeyManagerApi.kms` field name now diverges slightly from the type it holds. Acceptable: `kms` is the conversational category, `KeyManager` is the precise type.

## Forward direction

`@did-btcr2/api` is the intended public entry point for did:btcr2 consumers. ADR-006 (api package boundary) established the facade. This rename clarifies the next step:

1. **Today:** `LocalKeyManager` ships with the package as the default. `new KeyManagerApi()` constructs one automatically. `new KeyManagerApi(myCustomKm)` accepts any `KeyManager` implementation.

2. **Near-term:** users implement adapters against AWS KMS / GCP KMS / Azure Key Vault / HashiCorp Vault Transit by satisfying the `KeyManager` interface. The adapter handles network dispatch, IAM-style permissions, audit emission, etc. The api package and `Beacon` broadcast paths see only the abstract `Signer` view via `KeyManagerSigner`.

3. **Encouragement:** documentation will explicitly recommend external KMS adapters for production. `LocalKeyManager` is positioned as a dev / test / reference implementation, not a production target.

This direction does not require changes to the `KeyManager` interface itself; it requires the *naming* to stop implying that the bundled implementation is the intended endpoint. ADR-033 completes that re-framing.

## Files updated

- Package: `packages/kms` → `packages/key-manager` (directory rename; `package.json` `name`, `homepage`, `repository.directory`)
- Workspace: `pnpm-workspace.yaml`, root `package.json` `workspaces` + scripts
- Build: root `tsconfig.json` references, `typedoc.json` entryPoints, `did-btcr2-js.code-workspace`
- Source: `packages/key-manager/src/{local-key-manager,key-manager-signer,index}.ts`
- Tests: `packages/key-manager/tests/{local-key-manager,key-manager-signer}.spec.ts`
- Lib scripts: `packages/key-manager/lib/{local-key-manager,sign-verify}.ts`
- Downstream: `packages/api/src/{api,crypto,kms,method,types}.ts`, `packages/api/tests/key-manager-api.spec.ts`, `packages/api/package.json` + `tsconfig.json`, `packages/api/lib/e2e-key-manager-signer-update.ts` (was `e2e-kms-signer-update.ts`)
- Docs (contributor-facing): `README.md`, `docs/contributing/release-process.md`, `docs/contributing/build-system.md`
- JSDoc references in `packages/keypair/src/signer.ts`, `packages/method/src/core/updater.ts`, `packages/method/lib/operations/signer/e2e-custom-signer-update.ts`

Lockfile is regenerated by `pnpm install`.

## References

- [ADR 007: KMS Package Boundary](007-kms-package-boundary.md) — established the `kms` package boundary and `KeyManager` interface. Not superseded; this ADR refines the naming and forward direction.
- [ADR 012: Dual Signing and URN Identifiers](012-kms-dual-signing-urn-identifiers.md) — established URN-style key IDs, dual-signing (Schnorr + ECDSA) contract, and watch-only entries. Not superseded; the URN namespace `urn:kms:secp256k1:` is intentionally preserved as a stable identifier surface.
- [ADR 006: API Package Boundary](006-api-package-boundary.md) — frames `KeyManagerApi` as a sub-facade over a pluggable `KeyManager`.

---
title: "ADR 034: `KeyManager.canExport` capability and optional `exportKey`"
---

# ADR 034: `KeyManager.canExport` capability and optional `exportKey`

**Status:** Accepted

**Date:** 2026-05-21

**Branch / PR:** `refactor/kms-signing-flow`

**References:** [ADR 007](007-kms-package-boundary.md), [ADR 012](012-kms-dual-signing-urn-identifiers.md), [ADR 033](033-key-manager-package-rename.md)

## Context

`@did-btcr2/api`'s key-management facade (`KeyManagerApi`) exposes an `export(id)` method that returns a full `SchnorrKeyPair` from the backing `KeyManager`. The bundled `LocalKeyManager` supports this because it holds raw secret bytes in the JS heap. External `KeyManager` adapters that we want to encourage (AWS KMS, GCP KMS, Azure Key Vault, HashiCorp Vault Transit, hardware wallets, HSMs) typically forbid key export by design: that is the whole point of using such a service.

Before this ADR, the facade reached for `instanceof LocalKeyManager` to gate export support:

```ts
export(id: KeyIdentifier): SchnorrKeyPair {
  if (!(this.kms instanceof LocalKeyManager)) {
    throw new Error('Key export is not supported by the current KeyManager implementation.');
  }
  return this.kms.exportKey(id);
}
```

That gate has three problems:

1. It hardcodes a relationship to one concrete class. A third-party in-process adapter (e.g. a `FileBackedKeyManager` that does support export with the same security model) would be rejected for the wrong reason.
2. It encodes the capability in a structural check (class identity) rather than in the interface contract. Adapter authors have to read the api code to learn the rule.
3. `KeyManager.exportKey` is currently a method on `LocalKeyManager` only, not on the interface, so calling code that holds a `KeyManager` reference cannot ask "can I export?" without an `instanceof` jump.

## Decision

Add two members to the `KeyManager` interface:

- `readonly canExport?: boolean`: capability probe. Default-undefined is treated as `false` (fail-closed if the adapter does not opt in).
- `exportKey?(id: KeyIdentifier): SchnorrKeyPair`: optional export method. Adapters that advertise `canExport: true` must implement it.

`KeyManagerApi.export` checks both before delegating:

```ts
export(id: KeyIdentifier): SchnorrKeyPair {
  if (!this.kms.canExport || !this.kms.exportKey) {
    throw new Error(
      'Key export is not supported by the current KeyManager implementation. '
      + 'The adapter must advertise `canExport: true` and provide an `exportKey` method.'
    );
  }
  return this.kms.exportKey(id);
}
```

The bundled `LocalKeyManager` declares `readonly canExport = true` and continues to expose `exportKey` as before (no behavior change for in-process callers).

## Consequences

- External KeyManager adapters can opt into export (e.g., for migration or backup tooling) without forking the facade. Most production adapters will simply omit both members and inherit the fail-closed default.
- Removes the `instanceof LocalKeyManager` check, decoupling the api package from the key-manager package's concrete class.
- The capability is discoverable on the interface: an adapter author reads `KeyManager` and sees what optional surface they may implement.
- Backwards-compatible for existing code: `LocalKeyManager` declares both members, so callers continue to work; adapters that omit them inherit the fail-closed behavior they already had under the `instanceof` check.

## Pattern

Optional interface members + capability flags are a lightweight alternative to a parallel `Exportable` interface or a `KeyManager & Exportable` mixin. We pick this because (a) the capability is a single boolean and a single method, (b) we already have a stable `KeyManager` interface and do not want to fragment it across multiple "shapes," and (c) the pattern composes cleanly if future capabilities are added (e.g., `canRotate`, `rotateKey?(id)`).

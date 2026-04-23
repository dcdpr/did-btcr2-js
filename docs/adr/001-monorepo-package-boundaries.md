---
title: "ADR 001: Monorepo Package Boundaries"
---

# ADR 001: Monorepo Structure and Package Boundaries

**Status:** Accepted

**Date:** 2025-02-19

**Commit:** [`ce4da8d`](https://github.com/dcdpr/did-btcr2-js/commit/ce4da8d)

## Context

The TypeScript reference implementation of did:btcr2 composes several distinct concerns: cryptographic primitives, DID-document canonicalization, Bitcoin-transaction construction, Sparse Merkle Tree logic, key management, the protocol layer itself, a high-level SDK facade, and a CLI. Packaging all of those as a single flat library had three obvious problems:

1. **Installable surface.** Consumers that only need to *resolve* a did:btcr2 DID (e.g. a wallet verifying a counterparty's identity) shouldn't have to pull in Bitcoin-transaction signing code, a Helia IPFS node, or the CLI's commander dependency.
2. **Dependency discipline.** Without hard package boundaries, lower layers (canonicalization, crypto) would accumulate upward imports from higher layers and become impossible to untangle later.
3. **Parallel iteration.** Spec implementers in other languages need to compare against small, focused modules (cryptosuite, identifier codec, SMT). A monolith makes cross-implementation alignment harder than it needs to be.

## Options considered

1. **Single flat package.** One `did-btcr2` package with everything inside. Simplest to publish; worst for consumer surface and dependency discipline.
2. **Two packages** (library + CLI). Better than flat but still conflates crypto, canonicalization, Bitcoin logic, and protocol in one.
3. **Layered monorepo with one package per architectural layer.**

## Decision

**Option 3.** The repo is a pnpm workspace with nine packages under the `@did-btcr2/` npm scope, organized by architectural layer:

```
common      : types, canonicalization, hashing, JSON patch, errors
├── keypair     : secp256k1 key pairs, BIP340 Schnorr signatures
│   ├── cryptosuite : Data Integrity BIP340 proof creation/verification
│   ├── bitcoin     : Bitcoin Core RPC/REST, sans-I/O protocol layers
│   └── kms         : key management (generate/import/sign/verify, URN IDs)
├── smt         : Optimized Sparse Merkle Tree (no workspace deps)
│
└── method      : core did:btcr2: create, resolve, update, beacons
    └── api         : high-level SDK facade
        └── cli         : commander.js CLI binary
```

Inter-package references use the workspace protocol (`workspace:^`). Dependencies flow strictly downward in the layer graph: no upward imports are permitted.

## Consequences

**Positive**
- Consumers install only what they use. A wallet resolver takes `common`, `keypair`, `cryptosuite`, `method`; no Bitcoin or CLI surface.
- Each package has a focused test scope, a narrow security review surface, and a small public API that spec implementers in other languages can compare against one at a time.
- Dependency discipline is enforced by pnpm: attempting an upward import produces a lint error before review.
- Node ≥ 22 requirement and strict TypeScript settings are shared through root `tsconfig.base.*` files so no package can silently relax them.

**Negative**
- More `package.json` files to maintain. Version bumps need coordination across packages when they co-evolve (addressed by `workspace:^` semver ranges, see [ADR 021](021-tsconfig-normalization.md)).
- Nine packages means nine release processes. A single mistake in one package's config can break the chain.
- New contributors need to learn the layer graph before they know which package owns a change. Mitigated by this ADR.

**Explicitly accepted trade-offs**
- We tolerate the per-package overhead for the sake of the consumer-surface and dependency-discipline wins.
- We do not use Lerna, Rush, or Nx: pnpm workspaces are sufficient and keep the toolchain small.

## References

- [`pnpm-workspace.yaml`](../../pnpm-workspace.yaml): workspace package list.
- [`tsconfig.base.json`](../../tsconfig.base.json): shared TypeScript compiler defaults.
- [ADR 021](021-tsconfig-normalization.md): tsconfig normalization + project references that make the multi-package build work incrementally.

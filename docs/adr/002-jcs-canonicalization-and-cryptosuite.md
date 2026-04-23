---
title: "ADR 002: JCS Canonicalization and bip340-jcs-2025 Cryptosuite"
---

# ADR 002: JCS Canonicalization and the bip340-jcs-2025 Data Integrity Cryptosuite

**Status:** Accepted

**Date:** 2025-03-14

**Commit:** [`ce4da8d`](https://github.com/dcdpr/did-btcr2-js/commit/ce4da8d)

## Context

did:btcr2 requires a way to hash and sign DID documents (and updates to them) deterministically: two implementations producing different byte sequences for the same logical JSON object would break every signature verification across the ecosystem. Several canonicalization choices exist:

- **JCS (RFC 8785: JSON Canonicalization Scheme).** Stays in JSON. Lexicographic key ordering, integer normalization, Unicode escapes pinned. Fast, simple, implementable in any JSON-capable runtime.
- **RDFC / URDNA2015 (JSON-LD canonicalization).** Works on the RDF graph derived from JSON-LD. Powerful but heavyweight: requires a JSON-LD processor, context resolution, quad generation.
- **Deterministic CBOR.** Binary-first. Compact on the wire but obscures human debugging.
- **Deterministic Protobuf.** Schema-first; imposes a schema registry the protocol doesn't otherwise need.

Separately, the signature layer needs to match W3C Verifiable Credentials Data Integrity conventions so that did:btcr2 DID documents can be consumed by existing VC verifiers. The cryptosuite choice pins the `type` of proof that gets attached to documents and updates.

## Options considered

1. **RDFC + eddsa-rdfc-2022.** Canonical VC-DM path. Requires Ed25519, not secp256k1: conflicts with Bitcoin-native key reuse.
2. **RDFC + a Bitcoin-friendly signature.** No standard suite fits; we'd be inventing.
3. **JCS + BIP340 Schnorr, with a custom `bip340-jcs-2025` suite name.** Stays in JSON, reuses Bitcoin keys directly, matches W3C Data Integrity proof structure.

## Decision

**Option 3.**

- **Canonicalization:** JCS (RFC 8785). Implemented in `@did-btcr2/common` via the `canonicalize()` / `hash()` / `canonicalHashBytes()` / `canonicalHash()` pipeline. A `JSON.parse(JSON.stringify(object))` round-trip normalizes class instances (via their `toJSON` methods) before JCS so that class-vs-POJO callers produce the same canonical form.
- **Cryptosuite:** `bip340-jcs-2025`: Data Integrity proof type using BIP340 Schnorr signatures over JCS-canonicalized document bytes. Implemented in `@did-btcr2/cryptosuite`.
- **Hash function:** SHA-256.
- **Encoding for wire transport of hashes:** `base64urlnopad` by default (see [ADR 003](003-bech32m-did-encoding.md) for the identifier encoding, which is separate).

Messages across the aggregation subsystem, beacon signals, and signed updates all hash via `canonicalHashBytes(document)`: canonicalize to SHA-256 to raw bytes.

## Consequences

**Positive**
- Pure-JSON pipeline. No JSON-LD processor, no RDF quad generation, no context resolution: any runtime that can parse JSON and hash bytes can verify a did:btcr2 signature.
- Bitcoin-native keys. BIP340 Schnorr signatures over JCS bytes means the same key material that controls UTXOs also signs DID updates. No dual-key-management burden.
- The cryptosuite name (`bip340-jcs-2025`) is self-describing and collision-free with other VC Data Integrity suites.
- Implementations in other languages (Rust, Python, Go) are small. JCS has reference implementations; BIP340 is well-known.

**Negative**
- We leave the mainstream W3C-VC JSON-LD ecosystem. Consumers using off-the-shelf VC verifiers (expecting eddsa-rdfc-2022 or bbs-2023) need did:btcr2-aware tooling.
- `bip340-jcs-2025` is our own suite identifier; it's not registered with any standards body. If W3C ever standardizes a JSON+Schnorr suite, we may need to add a second identifier for compatibility.
- JCS's `JSON.parse(JSON.stringify(...))` round-trip has a well-known interaction with `Uint8Array` values (they serialize to index-keyed objects). The HTTP transport works around this with an explicit `__bytes` wire convention (see [ADR 029](029-tls-only-confidentiality.md)).

**Explicitly accepted trade-offs**
- We are not aiming for compatibility with VC-DM JSON-LD tooling. The did:btcr2 ecosystem provides its own resolver and signature verifier.
- We do not carry a secondary canonicalization fallback. If a did:btcr2 implementation disagrees about bytes, it's wrong.

## References

- [`packages/common/src/canonicalization.ts`](../../packages/common/src/canonicalization.ts): canonicalize / hash / canonicalHashBytes pipeline.
- `packages/cryptosuite/src/`: `bip340-jcs-2025` proof creation + verification.
- [RFC 8785: JCS](https://datatracker.ietf.org/doc/html/rfc8785).
- [ADR 003](003-bech32m-did-encoding.md): DID identifier encoding, which uses the hash from this pipeline in the EXTERNAL case.

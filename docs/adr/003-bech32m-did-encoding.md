---
title: "ADR 003: Bech32m DID Identifier Encoding"
---

# ADR 003: Bech32m Encoding for did:btcr2 Identifiers

**Status:** Accepted

**Date:** 2025-03-14

**Commit:** [`ce4da8d`](https://github.com/dcdpr/did-btcr2-js/commit/ce4da8d)

## Context

did:btcr2 DIDs need a compact, unambiguous, human-readable-ish identifier encoding that carries three pieces of information in a single string:

- **A type discriminator**: KEY (the identifier *is* a secp256k1 pubkey) vs. EXTERNAL (the identifier is a hash of a genesis DID document).
- **A version**: future protocol revisions need to be distinguishable.
- **A network hint**: which Bitcoin network this DID lives on (mainnet, signet, regtest, testnet3, testnet4).

A DID like `did:btcr2:k1q5pvrqxrtmu8d...` must encode all three plus the 33-byte compressed pubkey (KEY case) or 32-byte SHA-256 hash (EXTERNAL case), with strong error detection so a typo'd DID fails loud instead of dereferencing the wrong entity.

## Options considered

1. **Base58check (Bitcoin legacy addresses).** Familiar, but weaker error detection than BCH codes and no HRP concept.
2. **Base64url.** Compact, but zero error detection and visually ambiguous characters (1/l, 0/O).
3. **Bech32 (BIP173).** BCH-code error detection, HRP convention, battle-tested via SegWit addresses. Has a known `*q*` mutation weakness.
4. **Bech32m (BIP350).** Bech32 with the constant changed to eliminate the mutation weakness. Native format for Taproot addresses.

The did:btcr2 spec itself mandates Bech32m for the identifier portion (see the [did:btcr2 spec §3.2](https://dcdpr.github.io/did-btcr2/#didbtcr2-identifier-encoding)). This ADR captures our implementation's adherence to that choice and the two HRP values we assign.

## Decision

**Bech32m encoding** for the entire identifier payload, with two HRPs:

- **`k`**: KEY identifier. Payload = version nibble + network nibble + 33-byte compressed secp256k1 pubkey.
- **`x`**: EXTERNAL identifier. Payload = version nibble + network nibble + 32-byte SHA-256 hash of the canonicalized genesis DID document ([ADR 002](002-jcs-canonicalization-and-cryptosuite.md)).

The full DID is `did:btcr2:<bech32m-string>`. Implementation lives in the `Identifier.encode()` and `Identifier.decode()` methods of the `@did-btcr2/method` package, using the Bech32m codec from `@scure/base`.

## Consequences

**Positive**
- Strong typo detection. Bech32m's BCH code catches every substitution-and-insertion error up to 4 characters and detects more with high probability. A copy-paste DID that's off by one character won't silently dereference the wrong entity.
- No legacy Bech32 mutation weakness.
- Same codec as Taproot addresses. Consumers that already handle `bc1p...` strings handle `did:btcr2:k1p...` with the same library.
- HRP-based type discrimination (`k` vs `x`) means the type of identifier is readable without decoding the payload.
- Resolution is deterministic from a KEY identifier: decode to pubkey to synthesize initial DID document to resolve. No genesis document sidecar required in the KEY case (see [ADR 016](016-sans-io-resolver.md) for the read-path details).

**Negative**
- Bech32m strings are case-sensitive by spec (lowercase or all-uppercase; mixed case is invalid). Human-typed DIDs must respect this.
- The 33-byte pubkey + version + network exceeds what fits in a short identifier (~62 chars for the KEY case). DIDs are long; acceptable but not print-friendly.
- EXTERNAL identifiers depend on genesis-document canonicalization byte-stability. If JCS ([ADR 002](002-jcs-canonicalization-and-cryptosuite.md)) ever changes, every existing EXTERNAL DID's identity would shift. JCS is RFC-frozen so this is a theoretical concern.

**Explicitly accepted trade-offs**
- We do not support legacy Bech32 or base58check. A did:btcr2 DID that isn't valid Bech32m is invalid, full stop.
- Mixed-case input is rejected on decode. Clients displaying DIDs in case-preserving contexts (e.g. web URLs) must preserve lowercase.

## References

- [`packages/method/src/core/identifier.ts`](../../packages/method/src/core/identifier.ts): `Identifier.encode()` / `Identifier.decode()`.
- [BIP350: Bech32m](https://github.com/bitcoin/bips/blob/master/bip-0350.mediawiki).
- [did:btcr2 spec §3.2: Identifier Encoding](https://dcdpr.github.io/did-btcr2/#didbtcr2-identifier-encoding).
- [ADR 002](002-jcs-canonicalization-and-cryptosuite.md): provides the canonicalization whose hash becomes the EXTERNAL payload.

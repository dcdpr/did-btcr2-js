---
title: "ADR 062: Harden did:btcr2 Identifier Encoding and Decoding"
---

# ADR 062: Harden did:btcr2 Identifier Encoding and Decoding

**Status:** Accepted

**Date:** 2026-06-30

**Branch / PR:** `fix/identifier-encoding-hardening`

**References:** [ADR 003](003-bech32m-did-encoding.md), [ADR 055](055-resolver-provide-trust-boundary.md), [ADR 057](057-did-document-validation-standards.md)

## Context

`Identifier.encode` / `Identifier.decode` (`packages/method/src/core/identifier.ts`) implement
the Bech32m identifier encoding from [ADR 003](003-bech32m-did-encoding.md), following the
[did:btcr2 specification](https://dcdpr.github.io/did-btcr2/) `algorithms` section. The first
data byte packs two 4-bit fields: the high nibble is `btcr2_version` and the low nibble is
`network_value`. For a v1 identifier the only valid `btcr2_version` is `0` (the spec defines
`version_number = btcr2_version + 1`, and only version 1 exists). The remaining data bytes are
the genesis bytes: a 33-byte compressed secp256k1 public key for a KEY identifier (hrp `k`), or
a 32-byte hash for an EXTERNAL identifier (hrp `x`).

An audit of the decode path found that the version guard was unreachable for the cases that
matter. The decoder read the version with a loop:

```ts
let versionNibble = currentByte >>> 4;
while (versionNibble === 0xF) {
  version += 15;
  // ...advance to the next nibble...
  if (version > 1) {
    throw new IdentifierError(`Invalid version: ${version}`, INVALID_DID, { identifier });
  }
}
version += versionNibble;
```

The spec reserves a leading nibble of `0xF` for a future multi-byte version-extension scheme.
The loop body, including the `version > 1` rejection, runs only when the leading nibble is
exactly `0xF`. For a leading nibble of `0x1` through `0xE` the loop never executes, so the guard
never fires: the decoder fell through to `version += versionNibble` and silently accepted the
identifier with `version` set to 2 through 15. A forged first byte of `0x10` decoded as version 2,
`0x20` as version 3, and so on. Because the genesis bytes still parsed as a valid public key, the
forged identifier was accepted as a well-formed DID with a version this implementation does not
define. This is the central defect: an identifier the encoder can never produce, and that the spec
does not define, was treated as valid.

Three smaller gaps accompanied it:

1. **Decode network table.** The decoder mapped `network_value` 8 through 15 to `network_value - 11`
   (yielding negative numbers and zero for 8 through 11, and 4 for 15), accepting reserved and
   out-of-range values as if they were custom networks.
2. **EXTERNAL genesis length was unchecked on both paths.** `encode` enforced a length only for KEY
   (via the public-key constructor) and `decode` enforced none for EXTERNAL, so an EXTERNAL DID could
   be minted or parsed with a hash of any length, producing an unresolvable identifier.
3. **Encoder version and numeric-network handling.** `encode` rejected only `version > 1` (accepting
   0 and negatives, which corrupt the version nibble) and carried a numeric-network branch that
   appended `network + 11`; for a numeric network of 5 or more this overflows the 4-bit field and
   corrupts the version nibble. It also retained a dead `NOT_IMPLEMENTED` branch from the
   never-completed version-extension scheme.

The defects and a regression test net for them originate from an internal audit commit
(`c76a07e5`, branch `refactor/method-audit`) that was never merged. This decision re-expresses the
fixes against the current code and reconciles the network boundary against the specification rather
than porting the audit verbatim.

### Specification facts grounding this decision

- `version_number` is 1; `btcr2_version` is `version_number - 1`, which is `0`.
- The first byte's high nibble is `btcr2_version` and its low nibble is `network_value`. This nibble
  order was confirmed against the specification's worked decode example (a mutinynet identifier whose
  `network_value` of 5 appears as a first byte of `0x05`).
- `network_value` mapping: bitcoin 0, signet 1, regtest 2, testnet3 3, testnet4 4, mutinynet 5;
  values 6 through 11 are reserved; values 12 through 14 are custom networks; 15 is out of range.

## Decision

### Read btcr2_version as a single flat nibble and require it to be 0

Decode reads `btcr2_version = dataBytes[0] >>> 4` directly and rejects any non-zero value. The
version-extension loop is removed. A leading nibble of `0x1` through `0xF` is now rejected, which
closes the forged-version acceptance: `0xF` is the reserved extension marker that v1 does not
implement, and `0x1` through `0xE` are versions this implementation does not define. `version` is
fixed at 1 for every accepted identifier.

### Enforce the strict network table on decode

`network_value` 0 through 5 map to their named networks. Values 12 through 14 are custom networks and
decode to the numeric values 1 through 3 (preserving the prior numeric-custom-network behavior).
Values 6 through 11 and 15 are rejected as reserved or out of range.

### Drop the numeric-network branch from encode; mint only named networks

The public option type (`DidCreateOptions.network`) is a string, `DidBtcr2.create` defaults it to
`"bitcoin"`, and there are no numeric-network callers in the monorepo. The encoder therefore accepts
only known network names and resolves them through `BitcoinNetworkNames`. Removing the numeric branch
removes the nibble-overflow corruption it could cause. Custom networks remain decode-only: an existing
identifier that encodes a custom network can still be parsed, but this implementation does not mint
new ones. The dead `NOT_IMPLEMENTED` version-extension branch is removed with it.

### Enforce genesis-byte length for both identifier types on both paths

KEY genesis bytes are validated by constructing a `CompressedSecp256k1PublicKey` (33 bytes, valid
point), as before. EXTERNAL genesis bytes must be exactly 32 bytes, checked on both `encode` and
`decode`. An EXTERNAL identifier with any other hash length is rejected rather than minted or parsed
into an unresolvable DID.

### Require version to be exactly 1 on encode

`encode` rejects any `version` that is not strictly equal to 1, which also rejects `NaN` and
non-number inputs. This replaces the prior `version > 1` check that accepted 0 and negatives.

### Keep the encoder's network default at "bitcoin"

`encode` continues to default an omitted `network` to `"bitcoin"`, matching `DidBtcr2.create`, so the
two layers agree on the default rather than disagreeing about whether an omitted network is an error.
A `null` or empty-string network is still rejected; only an omitted (`undefined`) network takes the
default.

### Treat the change as a breaking, minor-version change

The decoder now rejects identifiers it previously accepted (forged versions, reserved networks,
mis-sized EXTERNAL hashes), and the encoder rejects inputs it previously tolerated. Per 0.x semantics
(breaking changes signalled by a minor bump) and the precedent of prior validation-tightening ADRs,
`@did-btcr2/method` takes a minor bump and this ADR serves as the release note.

## Consequences

- A forged identifier with a non-zero `btcr2_version` is rejected at decode. Any consumer relying on
  the previous silent acceptance of versions 2 through 15 will now see an `INVALID_DID` error, which
  is the intended behavior: those identifiers are not valid v1 DIDs.
- Reserved and out-of-range `network_value`s (6 through 11, 15) are rejected. Custom networks
  (12 through 14) continue to decode to numeric 1 through 3.
- EXTERNAL identifiers are well-formed by construction: a 32-byte hash is required to mint one and to
  parse one. All in-tree EXTERNAL fixtures and vectors are already 32 bytes and are unaffected.
- The encoder no longer mints custom/numeric networks. No in-tree caller did so; `DidBtcr2.create`
  and the API facade pass named networks only.
- The identifier round-trips for every existing fixture: a valid v1 identifier decodes to the same
  components and re-encodes to the same string. The decode change is behavior-preserving for valid v1
  identifiers (the leading nibble is 0, the network nibble is the low nibble, and the genesis bytes are
  the remainder), and only tightens the rejection of malformed input.
- The package ships a regression net covering forged versions (`0x10`, `0x20`, `0xE0`, `0xF0`), the
  network boundary (6, 7, 8, 11, 15 rejected; 12 through 14 accepted; 0 through 5 via fixtures), and
  EXTERNAL length on both paths.

## Rejected alternatives

- **Keep the version-extension loop and add a separate guard.** The loop implements a multi-byte
  version scheme this version of the method does not define, and its presence is exactly what hid the
  defect. A flat single-nibble read is both correct for v1 and impossible to misread.
- **Preserve the lenient decode network table.** Mapping 8 through 15 to `network_value - 11` accepts
  reserved values and produces negative network numbers. Rejecting reserved and out-of-range values
  matches the specification's network table and prevents a reserved value from being silently
  reinterpreted.
- **Reject an omitted network in encode.** Treating `undefined` as an error would make the low-level
  encoder stricter than `DidBtcr2.create`, which defaults to `"bitcoin"`. Defaulting in both places
  keeps the two layers consistent and avoids a surprising failure for a caller that omits an optional
  field. `null` and empty-string networks are still rejected.
- **Keep the numeric-network encode branch.** It is unused, and its `network + 11` arithmetic overflows
  the 4-bit network field for numeric networks of 5 or more, corrupting the version nibble. Removing it
  eliminates a latent corruption path while leaving custom-network decoding intact.

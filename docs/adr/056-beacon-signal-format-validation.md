---
title: "ADR 056: Validate the Beacon Signal Output Format and Document the CAS Announcement Hash Chain"
---

# ADR 056: Validate the Beacon Signal Output Format and Document the CAS Announcement Hash Chain

**Status:** Accepted

**Date:** 2026-06-27

**Branch / PR:** `fix/beacon-signal-validation`

**References:** [ADR 016](016-sans-io-resolver.md), [ADR 037](037-single-party-beacon-and-two-axis-model.md), [ADR 055](055-resolver-provide-trust-boundary.md)

## Context

Beacon signal discovery is the entry point of the resolver's read path: it scans the Bitcoin transactions at each beacon address and extracts the 32-byte update or announcement hash that each signal commits to. A beacon signal is a single `OP_RETURN` data push, on the wire `0x6a 0x20 <32 bytes>`, whose asm form is exactly `OP_RETURN OP_PUSHBYTES_32 <64-hex>`. The encode side is already pinned (`opReturnScript` produces precisely that 34-byte NULL_DATA script).

The decode side was lax. Both discovery paths (the Esplora REST `indexer` and the Bitcoin Core `fullnode` traversal) checked only that the output's `scriptpubkey_asm` *contained* the substring `OP_RETURN`, then took the *last* whitespace-delimited asm token as the signal hash, with an empty-string check as the only guard. Two failure modes followed:

1. **Phantom signals from malformed outputs.** A bare `OP_RETURN` with no push yields the literal token `OP_RETURN` as the "hash". A push of the wrong size, or a non-hex payload, yields a short or non-hex "hash". Either way a value that is not a 32-byte commitment flows downstream as if it were a real signal, producing a sidecar-map miss and an opaque, far-from-source failure (or, with adversarial sidecar data, a lookup against an attacker-chosen key).

2. **Substring false positives.** Because the check was `includes('OP_RETURN')` rather than "the output *is* an OP_RETURN data push," any script whose asm merely mentioned the keyword could be misread as a signal.

Separately, the CAS beacon's resolution path links an on-chain signal to a signed update through two hashes with an encoding transition at each hop (hex on-chain and for map keys, base64urlnopad for announcement values). [ADR 055](055-resolver-provide-trust-boundary.md) made `provide()` enforce those hashes, and pre-loaded sidecar maps enforce them structurally by keying on `canonicalHash`. But the chain itself, and specifically its hex/base64url transitions, was undocumented and had no regression guard, so a future change to a default encoding could silently break resolution: every lookup would simply miss.

## Decision

### 1. Strictly parse the beacon signal output

A single shared decoder, `extractOpReturnSignal(asm)`, returns the 32-byte hash if and only if the asm is exactly three tokens, `OP_RETURN`, then `OP_PUSHBYTES_32`, then a 64-character hex payload, and returns `null` for everything else (empty input, a bare `OP_RETURN`, a wrong-size push opcode, a payload that is not exactly 32 bytes of hex, a multi-push output, or a script where `OP_RETURN` is not the leading opcode). The payload is lowercased so it matches the hex-keyed sidecar maps. Both the REST and fullnode discovery paths now route through this one function and drop any output it rejects.

### 2. Document and regression-test the CAS announcement hash chain

The two-hop chain and its encoding transitions are documented inline on `CASBeacon` (the signal hop: on-chain `signalBytes` in hex equals `canonicalHash(announcement, hex)`, the `casMap` key; the update hop: each announcement value, base64urlnopad, decodes to hex to equal `canonicalHash(signedUpdate, hex)`, the `updateMap` key). A regression test pins both identities directly and drives a broadcast-shaped announcement through `processSignals` end-to-end, so a drift in any default encoding fails loudly at that test rather than silently breaking resolution.

## Consequences

- A beacon address output that is not a well-formed 32-byte `OP_RETURN` push is ignored during discovery, so it can no longer surface as a phantom signal. Only genuine 32-byte commitments enter the resolver.
- The two discovery paths share one decoder, so the REST and fullnode reads cannot drift in how they recognize a signal, and the recognition rule has direct unit coverage instead of being exercised only against a live chain.
- The behavior change is narrow: a correctly-formed signal is parsed exactly as before (now lowercased, a no-op for the lowercase hex that Esplora and Bitcoin Core already emit). Only previously-malformed outputs change outcome, from a downstream miss to being dropped at the source.
- The CAS hash chain's encoding contract is documented and guarded, so a future change to `canonicalHash`'s default encoding or to the announcement-value encoding fails a fast, local test rather than silently producing empty resolutions.

## Rejected alternatives

- **Keep the substring check and tolerate odd shapes.** The substring match is what admits phantom signals; "is exactly an `OP_RETURN OP_PUSHBYTES_32 <32-byte>` push" is the real predicate the read path needs, and is what the encode side already produces.
- **Accept any push length and validate downstream.** The 32-byte size is part of the signal definition; enforcing it at extraction keeps the invalid value out of the sidecar-lookup machinery entirely, consistent with [ADR 055](055-resolver-provide-trust-boundary.md)'s fail-fast-at-the-boundary stance.
- **Add a runtime re-check of the CAS chain inside `processSignals`.** Redundant: `provide()` already validates supplied data against the need's hash, and pre-loaded maps are keyed by `canonicalHash`, so a mismatched entry simply misses the lookup. The remaining gap was documentation and a regression guard, not another runtime check.

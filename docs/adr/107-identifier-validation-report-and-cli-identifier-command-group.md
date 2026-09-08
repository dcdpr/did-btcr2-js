# ADR 107: Identifier validation returns a report, and the cli exposes it as `identifier decode` and `identifier validate`

- **Status:** Accepted
- **Date:** 2026-09-08
- **Packages:** `@did-btcr2/method`, `@did-btcr2/api`, `@did-btcr2/cli`

## Context

The specification's identifier decoding algorithm says: "The `method-specific-id` MUST be lowercase." `Identifier.decode` did not check the case. A Bech32m decoder accepts an all-uppercase string, so an uppercase identifier decoded and `Identifier.isValid` returned `true` for it.

The specification says a custom network value (12 to 15) "SHOULD be rejected when the implementation does not support a custom network". ADR 062 kept `decode` permissive for the values 12 to 14: they decoded to the numbers 1 to 3. `encode` refuses a numeric network, so the round trip failed for them, and the cli refused them at `deriveNetwork` with a message about the network, not about the identifier.

`Identifier.decode` throws at the first failure. `Identifier.isValid` returns a boolean. Neither says which rule failed. An operator who builds an external identifier by hand, and an implementer who checks a test vector from another implementation, need the rule. A raw Bech32m failure surfaces as a `TypeError` with a stack, not as a typed error with a message.

An operator who created an identifier from genesis bytes (`create -t k -b <public key>`, `create -t x -b <hash>`) has no command that confirms the identifier encodes those bytes. The cli has no command that prints the components of an identifier. `api.did.decode` declared the return type `IdentifierComponents`; the value at runtime is `DidComponents`, which adds the `hrp`.

## Decision

**`Identifier.decode` refuses a method-specific id that is not lowercase.** The check runs before the Bech32m step and throws an `IdentifierError` of type `INVALID_DID`, as the specification requires. `isValid` follows.

**`Identifier.decode` refuses a reserved and a custom network value.** This implementation supports no custom network: `encode` cannot mint one and the cli cannot connect to one. The decoder rejects the values 6 to 15 with an `IdentifierError` of type `INVALID_DID` that names the reason (`reserved`, or `custom network not supported`). This replaces the numeric custom networks of ADR 062. `DidComponents.network` is always a network name.

**`Identifier.validate(did, options?)` returns a report and never throws on an invalid identifier.** The name is `validate`, not `verify`: in this code base `verify` checks a signature, and `validate` checks a structure (`DidDocument.validate`, `validateGenesis`, `config validate`). The report is `{ did, valid, idType?, network?, checks }`. The checks run in this order, and the run stops at the first failed check:

1. `prefix`: the value is a string of the form `did:btcr2:<method-specific-id>` with a non-empty id.
2. `lowercase`: the id is lowercase.
3. `bech32m`: the id decodes, the hrp is `k` or `x`, and the data bytes are not empty.
4. `version`: `btcr2_version` is 0.
5. `network`: `network_value` names a network (0 to 5). A reserved value (6 to 11) fails. A custom value (12 to 15) fails with the detail "not supported by this implementation".
6. `genesisBytes`: a 33-byte SEC compressed secp256k1 public key for `k`, a 32-byte SHA-256 hash for `x`.
7. `roundTrip`: encoding the decoded components reproduces the identifier, the last sentence of the specification's algorithm.
8. `genesisBytesMatch`: only if the caller supplies `options.genesisBytes`. The supplied bytes equal the genesis bytes of the identifier: the public key of a `k` identifier, the genesis document hash of an `x` identifier. A length mismatch names the expected length.
9. `genesisDocument`: only if the caller supplies `options.genesisDocument`. For an `x` identifier: the document id is `did:btcr2:_`, the document is a valid Genesis Document, and its canonical SHA-256 hash equals the genesis bytes. For a `k` identifier the check fails: a KEY identifier has no genesis document.

Each check is `{ name, ok, detail? }`. `idType` is present after the `bech32m` check, `network` after the `network` check. The method lives in `method`, the home of the specification's algorithm, so that a test-suite harness and other consumers can use it without the api.

**The api passes the report through.** `DidApi.decode` declares `DidComponents`. `DidApi.validate(did, options?)` delegates to `Identifier.validate`. The api exports the report types.

**The cli adds the `identifier` command group.** The identifier is a positional argument on both subcommands. `identifier decode <did>` prints `{ did, idType, hrp, version, network, genesisBytes }` with the genesis bytes as hex. `--initial-document` adds the initial DID document with no I/O (ADR 095); an `x` identifier needs `--genesis-document <path>` for it, and the flag is refused for a `k` identifier and without `--initial-document`. An invalid identifier fails `decode` with one message line that names the first failed check, so that a raw Bech32m error never prints a stack. `identifier validate <did> [-b <hex>] [--genesis-document <path>]` prints the report and sets exit code 1 if `valid` is false; the report goes to stdout and stderr stays empty. `-b, --bytes` takes the same value as `create -b` and adds the `genesisBytesMatch` check for a `k` or an `x` identifier; a wrong length is a failed check, not an argument error. The cli refuses `--genesis-document` for a valid `k` identifier before it reads the file. Both subcommands are offline and keystore-free.

## Scope boundary

- `create` and `resolve` do not change. `resolve` keeps its `-i` flag.
- No network I/O in any of the three packages for this feature.
- The shell completion list gains `identifier` only.

## Consequences

**Positive.** An uppercase identifier and a custom-network identifier no longer decode, as the specification requires and recommends. `decode` and `validate` agree on every rule. An operator sees which rule an identifier breaks, can confirm that an identifier encodes the genesis bytes it was created from, and can confirm the genesis document of an external identifier before the first update. The demo can show the parts of an identifier. The Danubetech vector harness and other cross-implementation checks can report the failed rule.

**Negative.** Breaking on a 0.x MINOR of `method`: an uppercase or mixed-case identifier, and an identifier with a network value from 12 to 15, decoded before and now fail with `INVALID_DID`. The `DidApi.decode` declared type widens by `hrp`; a caller that spreads the result into a narrower type sees a new field. The cli printed-output surface grows by two actions.

**Neutral.** `Identifier.validate` runs the same rules as `decode` plus the round trip and the optional checks. The two are kept in step by the method tests, which run `validate` over every decode fixture.

## Implementation

- `packages/method/src/core/identifier.ts`: the lowercase step and the network rejection in `decode`; `validate`; the types `IdentifierCheckName`, `IdentifierCheck`, `IdentifierValidateOptions`, `IdentifierReport`. The module imports `GenesisDocument` from `did-document.js`, which imports `Identifier`; both uses are inside method bodies, so the cycle is safe.
- `packages/api/src/did.ts`: `decode` declares `DidComponents`; `validate`. `packages/api/src/index.ts`: the type exports.
- `packages/cli/src/commands/identifier.ts` (new): `registerIdentifierCommand`. `cli.ts`, `commands/index.ts`, `types.ts` (`IdentifierDecodeData`, two `CommandResult` actions), `commands/completion.ts`.
- Tests: `method/tests/validate-identifier.spec.ts` (new), the lowercase and custom-network cases in `decode-identifier.spec.ts`; `api/tests/did-api.spec.ts`, `index-exports.spec.ts`; `cli/tests/identifier-commands.spec.ts` (new).
- Docs: `packages/cli/docs/identifier.md` (new), the command tables in the cli README and `docs/README.md`, `docs/completion.md`, `docs/resolve.md`, the api README.

## References

- Specification, "DID-BTCR2 Identifier Decoding": the lowercase rule, the network value table, and the round-trip sentence.
- ADR 003 (Bech32m DID encoding): the encoding that `validate` inverts.
- ADR 062 (identifier encoding hardening): the version nibble guard, and the decode-only custom networks that this ADR removes.
- ADR 095 (offline initial document and beacon addresses): the derivation that `decode --initial-document` prints.
- ADR 106 (the cli write commands take the identifier): the command shape this group sits beside.

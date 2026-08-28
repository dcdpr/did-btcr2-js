# ADR 099: A facade with no Bitcoin connection mints regtest identifiers

- **Status:** Accepted
- **Date:** 2026-09-02
- **Packages:** `@did-btcr2/api`

## Context

ADR 093 made a DID minted through the api inherit the network of the configured Bitcoin connection, and deliberately left the no-connection case alone: with no `btc` config, `createDid` and the two `DidMethodApi` create methods still fell through to `DidBtcr2.create`'s `network = 'bitcoin'`, while `generateDid` landed on `Identifier.generate()`'s hardcoded `'regtest'`. The reasoning was that changing a no-config default alters behaviour for callers who never configured a connection, which is a product decision rather than a defect fix, and it recommended `regtest` for a future api MINOR.

That MINOR is this one. The same release already changes behaviour on purpose: network inheritance itself, the shape of resolution failures, a first-class deactivation, signer production from the facade. The reason to defer has gone, and the defect it deferred is the most consequential default a first-time user can hit. `createApi()` with no arguments is the zero-configuration, offline construction the package readme opens with. Its most discoverable create verb handed back a mainnet identifier, whose initial document names a mainnet beacon address the user is then told to fund.

| Call on `createApi()` with no `btc` | Before | After |
|---|---|---|
| `api.generateDid()` | `regtest` | `regtest` |
| `api.createDid('deterministic', pk)` | `bitcoin` | `regtest` |
| `api.createDid('external', bytes)` | `bitcoin` | `regtest` |
| `api.btcr2.createDeterministic(pk)` | `bitcoin` | `regtest` |

## Decision

**A facade with no Bitcoin connection mints identifiers for regtest when the caller names no network.** The value lives in one place, `DidMethodApi.FALLBACK_NETWORK`, and every creation path on the api reads it: the two `DidMethodApi` create methods through `defaultNetwork`, and `DidBtcr2Api.generateDid` directly. The four paths agree because they share a constant, not because two upstream defaults happen to coincide.

**`defaultNetwork` always reports a network.** It was `NetworkName | undefined`; it is now `NetworkName`, the connection's network or the fallback. The network option handed to `DidBtcr2.create` is likewise always named, which also closes the `{ network: undefined }` case ADR 093 could only document: an explicit `undefined` wins a spread and would have reached the upstream mainnet default, and the facade now spreads a named network over it.

**Regtest, not a refusal and not another test network.** Throwing when no network can be determined was rejected: it would break the zero-configuration construction every example starts from, and it is a limit the specification does not mandate, which this project ships off by default. Mutinynet, the cli's product default, was rejected because the api is network-neutral and the cli always names its network explicitly; regtest is what `generateDid` and `DidApi.generate` already promised, and it is the one network on which a misdirected beacon address cannot lose funds. Keeping mainnet was rejected for the reason above.

**The constant is a static on `DidMethodApi`.** `generateDid` lives on `DidBtcr2Api` and must not reach the constant through the lazy `btcr2` getter, which would instantiate the Bitcoin and CAS facades just to read a string (ADR 024, ADR 093). A static on an already-exported class, beside `DEACTIVATION_PATCH` (ADR 094), gives both call sites one name without adding an export.

## Scope boundary

**`DidApi.generate()` is unchanged.** It is the low-level surface with no connection context (ADR 093), and its own default is already regtest.

**The cli is unaffected.** Every cli creation path passes `network` explicitly, resolved from its flag or profile, so the api fallback is never consulted from the cli.

**Documentation that states the old default rides the branch-wide doc sync.** The api demo currently warns that `createDid` defaults to mainnet and notes that `generateDid` differs; both statements are refreshed in this branch's documentation pass, not here.

## Consequences

**Positive.** No creation path on the api reaches mainnet by omission. A caller who wants a mainnet identifier writes `network: 'bitcoin'` and gets exactly that; a caller who writes nothing gets an identifier for the one chain where the mistake costs nothing. The four paths report the same network and `defaultNetwork` tells the truth in every configuration.

**Negative.** Behaviour changes for a caller with no Bitcoin connection who omitted `network` and relied on receiving a mainnet identifier. That caller was minting for a chain the facade could not read, and the change rides the api MINOR this branch already takes, but it is a change and the changeset names it.

**Neutral.** `defaultNetwork` narrows from `NetworkName | undefined` to `NetworkName`, which is source-compatible for every reader. `generateDid` now hands `DidApi.generate` an explicit network and takes its encode branch rather than `Identifier.generate()`; the identifier produced is the same.

## Implementation

- `packages/api/src/method.ts`: `DidMethodApi.FALLBACK_NETWORK`; `defaultNetwork` returns it when no connection is configured; the network option always carries a named network.
- `packages/api/src/api.ts`: `generateDid` falls back to the same constant; `createDid` documents the rule.
- Tests: the two pins of the old contract are rewritten (`defaultNetwork` is `'regtest'`, an offline deterministic DID is regtest); the external twin and the `{ network: undefined }` case with no connection are added; a facade-level test checks all three creation calls on a bare `createApi()` decode to regtest.

## References

- ADR 093 (network inheritance): the scope boundary this decision reverses, and the `{ network: undefined }` hazard it now closes structurally.
- ADR 024 (facade lazy initialization) and ADR 094 (deactivation as an ordinary update): the constraint on reaching the constant, and the precedent for a static on `DidMethodApi`.
- `docs/api-crud-review-2026-09-01.md`: the second-round review that surfaced this, as gap G9.

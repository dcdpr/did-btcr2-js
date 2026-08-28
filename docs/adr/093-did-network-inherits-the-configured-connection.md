# ADR 093: A new DID inherits the network of the configured Bitcoin connection

- **Status:** Accepted
- **Date:** 2026-08-27
- **Packages:** `@did-btcr2/api`

## Context

`@did-btcr2/api` mints identifiers through three entry points on one facade. None of them consulted the Bitcoin connection the caller configured, so each fell through to whatever its upstream happened to default to:

| Entry point | Falls through to | Upstream default |
|---|---|---|
| `DidBtcr2Api.createDid`, `DidMethodApi.createDeterministic`, `DidMethodApi.createExternal` | `DidBtcr2.create` | `network = 'bitcoin'` |
| `DidBtcr2Api.generateDid`, `DidApi.generate` | `Identifier.generate()` | hardcoded `'regtest'` |

On an api built as `createApi({ btc: { network: 'mutinynet' } })`, the observed result was:

```
api.generateDid()                   -> regtest
api.createDid('deterministic', pk)  -> bitcoin
api.btcr2.createDeterministic(pk)   -> bitcoin
api.did.generate()                  -> regtest
```

Both upstream defaults are reasonable where they live. `@did-btcr2/method` is sans-I/O and has no notion of "the connection you configured"; a library that mints identifiers without a network parameter has to pick something. The defect was that the api layer, which does hold that context, declined to apply it.

The consequences are asymmetric in a way that matters:

- **Wrong-network DIDs fail late and opaquely.** Creation is offline and always succeeds. `Resolver.deterministic` derives beacon addresses from *the DID's* network, and the api then queries them against *the connection's* network. A `bcrt1…` address queried against a mutinynet indexer returns nothing, and the resulting error names neither network. Nothing points back at a `create` call several steps earlier.
- **The mainnet default is a funds hazard.** `createDid` is the most discoverable creation method on the facade. Defaulting it to `bitcoin` means a caller who omits `network` can be handed a mainnet beacon address and instructed to fund it.

No test covered this: `did-btcr2-api.spec.ts` asserted only `idType` on a `createDid` call that named no network.

## Decision

**A DID created through the api facade is minted for the network of the configured Bitcoin connection unless the caller names a network explicitly.**

Precedence, in order:

1. `options.network`, when the caller supplied one.
2. The configured Bitcoin connection's network.
3. The upstream default, untouched, when no Bitcoin connection is configured.

Three supporting points:

**`BitcoinApi` exposes `network`.** `BitcoinConnection` already carried it as `.name`; the facade simply did not surface it. `DidMethodApi.defaultNetwork` reads through to it and is `undefined` with no connection.

**The network option is omitted, never set to `undefined`.** `DidMethodApi.#networkOption` returns `{}` rather than `{ network: undefined }`. This is load-bearing rather than stylistic: an explicit `undefined` still wins a spread, and `DidBtcr2.create` destructures with `const { network = 'bitcoin' }`, so a caller passing `{ network: undefined }` would land on mainnet, which is exactly the outcome the rule exists to prevent.

**`generateDid` reads the config, not the getter.** It consults `#btcConfig?.network` rather than `this.btc.network`. Touching the getter would instantiate the lazy `BitcoinApi` just to read a string, defeating ADR 024's lazy initialization, and would throw outright when no Bitcoin connection was configured.

## Scope boundary

**The no-connection defaults are deliberately left split.** With no `btc` config at all, `createDid` still yields `bitcoin` and `generateDid` still yields `regtest`. That inconsistency is real, and a mainnet default on a create call is hard to defend, but changing it alters behaviour for callers who never configured a connection. That is a product decision rather than a defect fix and does not belong in the same change. Recommended for a future api MINOR: make both `regtest`.

**`DidApi.generate()` is unchanged.** `DidApi` is the low-level encode/decode/generate surface with no connection context, constructed as `new DidApi()`. Threading a default network into it would widen the change and make `generateDid`'s fallback redundant for no benefit at the level callers actually work at. `api.did.generate()` therefore still returns a regtest DID; callers wanting connection-aware minting use `generateDid` or `createDid`.

**No cross-check between a DID's network and the connection's.** Resolving a regtest DID through a mutinynet connection still fails opaquely. A guard belongs here eventually, but as a warning through the injected `Logger` rather than a throw: a hard failure would be breaking and would block legitimate custom-network setups, and per the project convention any limit the specification does not mandate ships off by default.

## Consequences

**Positive.** The common path is correct without ceremony: configure a network once at `createApi` and every DID minted through the facade targets it. The mainnet footgun closes for every caller who configured a connection. `BitcoinApi.network` and `DidMethodApi.defaultNetwork` make the effective network inspectable rather than implicit.

**Negative.** Behaviour changes for callers who configured a Bitcoin connection, omitted `network`, and relied on the old default. Any such caller was minting DIDs for a chain the api was not reading, so the change corrects them rather than breaking them, but it is a behaviour change and rides an api MINOR under the 0.x convention.

**Neutral.** The split no-connection defaults persist, now documented rather than accidental. Callers who pass an explicit network are unaffected on every path.

## Implementation

- `packages/api/src/bitcoin.ts`: `BitcoinApi.network` getter over `BitcoinConnection.name`.
- `packages/api/src/method.ts`: `DidMethodApi.defaultNetwork` getter; `#networkOption` helper; `createDeterministic` and `createExternal` apply it.
- `packages/api/src/api.ts`: `generateDid` falls back to `#btcConfig?.network`; JSDoc corrected (it claimed a flat `'regtest'` default).
- Tests: 11 added across `did-method-api.spec.ts` and `did-btcr2-api.spec.ts`, covering inheritance on all four paths, explicit-network precedence, the `{ network: undefined }` case, the untouched no-connection default, and that `generateDid` does not force the lazy `BitcoinApi` into existence.

## References

- ADR 024: API facade lazy initialization and layered config (the lazy-getter constraint on `generateDid`).
- ADR 082: Per-network presets (`NETWORK_PRESETS` sits beside the endpoint config; this ADR keeps identifier minting on the same axis).
- `docs/api-crud-review.md`: the review that surfaced this, as gap G1.

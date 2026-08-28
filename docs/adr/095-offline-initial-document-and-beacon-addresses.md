# ADR 095: Derive the initial document and beacon addresses offline at the facade

- **Status:** Accepted
- **Date:** 2026-08-28
- **Packages:** `@did-btcr2/api`

## Context

Before a DID's first update can be broadcast, its beacon address must hold a spendable UTXO. The controller therefore needs that address at the very start of the lifecycle: create, fund, and only then is there anything on-chain to read. For a KEY (`k`) DID the address is not chain state at all; the entire initial document, beacon services included, is a pure function of the public key inside the identifier (`Resolver.deterministic`, synchronous, zero I/O).

The facade inverted that dependency. Its only path to the initial document was `resolveDid`, which drives the `Resolver` state machine to `NeedBeaconSignals` and so demands a configured, reachable Bitcoin connection. An api constructed with no `btc` config fails with "Bitcoin connection required to fetch beacon signals" for a document that derives offline in microseconds. The user needs the beacon address in order to fund it, and funding is what makes the chain worth querying in the first place: a bootstrapping deadlock on the documented happy path.

Two things compounded it. `Resolver` and `BeaconUtils` were not re-exported from the api, so even the workaround meant taking a direct dependency on `@did-btcr2/method`. And with no helper on the facade, every consumer reimplemented the same extraction: the README, `DEMO.md`, and `lib/e2e-full-lifecycle.ts` each independently wrote `service.find(...)` plus `String(serviceEndpoint).replace('bitcoin:', '')`, a hand-rolled BIP-21 parse that, unlike `BeaconUtils.parseBitcoinAddress`, does not strip a `?`-query suffix.

## Decision

**The initial document and the beacon addresses it names are exposed on `DidMethodApi` as zero-I/O derivations.**

**`getInitialDocument(did, genesisDocument?)` returns the document a DID resolves to before any update has been announced.** KEY identifiers derive via `Resolver.deterministic(Identifier.decode(did))`: pure, synchronous, no Bitcoin connection, no CAS. A genesis document supplied alongside a KEY DID is ignored, because a `k` document is deterministic regardless of what the caller passes. EXTERNAL (`x`) identifiers are the caller's own input by construction, so the genesis document must be supplied as the second argument; `Resolver.external` validates it against the hash inside the identifier before use. Without one, the method throws and names both escape hatches: pass the genesis document, or use `resolve()` with a CAS configured.

**`getBeacons(document)` reduces a document's beacon services to what a funding caller needs.** It filters services through `BeaconUtils.getBeaconServices` and maps each to a new exported `BeaconInfo { id, type, address }`, where `address` is the bare Bitcoin address with the `bitcoin:` URI scheme (and any query suffix) stripped by `BeaconUtils.parseBitcoinAddress`. The canonical BIP-21 parse replaces the three hand-rolled copies as the documented route.

**No top-level `DidBtcr2Api` counterparts.** Both methods live on `api.btcr2` only. The main facade's surface is held to the minimum for the CRUD cycle; a duplicate entry point would add surface without adding capability.

## Scope boundary

**No change to the `method` package.** `Resolver.deterministic` and `Resolver.external` predate this ADR and are called as-is; the api adds composition and shape, not derivation logic.

**`getBeacons` reads whatever document it is given.** Handed a resolved document rather than an initial one, it reports the beacon services of that version, which is the useful behaviour for funding a beacon added by an update. It does not check that the document belongs to any particular DID or version.

## Consequences

**Positive.** The lifecycle's real ordering (create, fund, resolve) is expressible through the facade with no chain round-trip before funding. Offline and air-gapped creation flows learn their funding address without a connection. The `?`-query parsing gap in the hand-rolled extraction is closed by routing through `BeaconUtils`.

**Negative.** Two more public members and one interface on a facade meant to stay minimal. The missing-genesis-document error is a bare `Error`, consistent with its neighbours in the same file but adding to the api package's typed-error debt (ADR 085 covers other packages; the api sweep is future work).

**Neutral.** Nothing here was impossible before; `@did-btcr2/method` exposed the same statics to anyone who imported it directly. The change removes the second dependency and the reimplementation, not a capability gap.

## Implementation

- `packages/api/src/method.ts`: `BeaconInfo` interface; `getInitialDocument` and `getBeacons` on `DidMethodApi`. `BeaconInfo` reaches the package root through the existing `export * from './method.js'`.
- Tests: KEY derivation with zero connections configured; the three derived beacon services paired with scheme-stripped fundable addresses; a KEY DID ignoring a supplied genesis document; EXTERNAL refusal without a genesis document; EXTERNAL derivation from a matching one; rejection of a mismatched genesis document and of an empty DID string.

## References

- ADR 093: DID network inheritance; ADR 094: deactivation as an ordinary update. The same api CRUD review produced all three findings.
- `docs/api-crud-review.md`: the review that surfaced this, as gap G3.

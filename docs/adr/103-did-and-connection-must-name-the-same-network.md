# ADR 103: A DID and its Bitcoin connection must name the same network

- **Status:** Accepted
- **Date:** 2026-09-03
- **Packages:** `@did-btcr2/api`

## Context

A did:btcr2 identifier encodes the Bitcoin network it lives on. A `BitcoinApi` targets one network. Nothing in the api compares the two. ADR 093 removed the way the two diverged by accident: a DID minted through a configured api now inherits the connection's network. The remaining sources are a DID pasted in from elsewhere, an explicit `network` option that differs from the connection, a DID minted offline and later used on a different api, and endpoint overrides that point one network name at another backend.

The failure is not always visible. Mainnet and regtest use their own address encodings, so a mismatch that involves either of them produces an HTTP error from the backend. The four test networks (testnet3, testnet4, signet, mutinynet) share one address encoding. A testnet4 DID resolved through a mutinynet connection derives beacon addresses that the mutinynet backend accepts. The backend returns empty listings, and the resolver completes with the version-1 document and no error. The updates of that DID exist on testnet4, and this resolution can never find them. On the write side, the funding guard reads the right-looking address on the wrong chain. If that address is unfunded there, the guard tells a user who funded it that it is unfunded. If it is funded there, the update spends a beacon UTXO on an announcement that no resolver of the DID reads.

The cli does not meet this case for `resolve`, `update`, and `deactivate`, because it derives the network from the DID and builds one api for that network. Every other api consumer has no protection at all.

## Decision

**The api refuses the pair.** `DidMethodApi.resolve` and `DidMethodApi.update` decode the DID and compare its network to the connection's network. If the two names differ, `resolve` throws a `ResolveError` before any chain read, and `update` throws an `UpdateError` of type `INVALID_DID_UPDATE` before any I/O. Both errors carry the DID, the DID's network, and the connection's network in their data. `deactivate` passes through `update` and inherits the check. The facade's `updateDid` and `deactivateDid` resolve the source first, so a mismatch there is refused once, at resolution. A caller who supplies the source pair and skips resolution is refused by `update`.

**A warning is rejected.** The default logger is a no-op, and the cli injects none, so a warning reaches nobody by default. A mismatched pair of named networks has no correct outcome: resolution reads the wrong chain and cannot find the updates, and an update announces where no resolver reads. There is nothing for a consumer to decide, so the api does not ask.

**Silent fallback to default endpoints is rejected.** The api could derive the network from the DID and, on a mismatch, build a connection from the SDK's per-network defaults. That fallback would route a private resolution through a public endpoint the user never configured, broadcast a mainnet update through an endpoint the user never chose, and drop a `fullnode` discovery mode for which no default RPC exists. A network-adaptive api that selects among the connections the user configured is a design of its own, and this refusal is its miss branch.

**Three cases stay silent.** A facade with no Bitcoin connection has nothing to compare. A DID that does not decode is reported by the calling path itself, so the check adds no second message. A DID on a custom network decodes to a number, not a name, and has no name to compare.

**A bypass option is rejected.** An option to skip the check adds surface for a problem whose fix is one word in the connection configuration.

## Scope boundary

**The rule that decodes the network is unchanged.** `Identifier.decode` owns the mapping from the network nibble to a name or a custom number. The check reads that result and compares it. It does not interpret the nibble itself.

**The error type on the read side carries no code.** `MethodErrorCode` has no entry for a configuration mismatch, and `INVALID_DID` would be false: the DID is valid. The read-side error is a `ResolveError` with its default type. A code can be added in the common package if a second consumer needs to branch on it.

**The cli inherits the refusal.** Its `update` and `deactivate` commands call `DidMethodApi.update()` directly. They derive the network from the DID, so they do not meet the refusal in normal use.

**Documentation is part of the branch-wide sync.** The api readme and demo state that the DID's network must match the connection's, and the troubleshooting table gains the new message.

## Consequences

**Positive.** A consumer sees the cause of an empty resolution or an "unfunded" refusal on a shared-encoding test network, at the call that went wrong and before any chain read or spend. The message names both networks and the fix.

**Negative.** A mislabeled setup that worked by accident now fails: a connection labeled `signet` that points at a mutinynet backend, used with mutinynet DIDs. The fix is the network label. The change is part of the api MINOR that this branch already takes, and the changeset names it with the other refusals.

**Neutral.** A matched pair, an offline facade, a custom network, and an undecodable DID see no difference. The check costs one identifier decode per resolution and per update.

## Implementation

- `packages/api/src/method.ts`: a private `#networkMismatch(did, connectionNetwork)` helper returns the two network names if they differ, else null. `resolve()` calls it after the resolver is constructed and throws a `ResolveError` inside its existing wrapper. `update()` calls it after the connection is chosen and throws an `UpdateError` before the `Updater` is constructed.
- Tests: a testnet4 DID resolved through a mutinynet connection is refused with no chain read, and the cause carries the two networks. A facade with no connection fails on the missing connection, not on the network. An update through a mutinynet connection is refused before the funding lookup, with the documented type and data. A source document whose id does not decode reaches the update path's own error.

## References

- ADR 093 (a new DID inherits the network of the configured Bitcoin connection): removed the accidental mismatch; this decision covers the deliberate and pasted-in cases.
- ADR 097 (resolution failures carry their root cause): the wrapper that carries the read-side refusal to `tryResolveDid`.
- ADR 099 (a facade with no Bitcoin connection mints regtest identifiers): a DID minted offline and later used on a test-network api is one of the remaining sources.
- ADR 100 (the update path refuses a deactivated source): the same harm on the write side, an announcement no resolver reads, refused at the same chokepoint.
- ADR 102 (the funding guard applies the beacon's spendability rule): the guard whose "unfunded" refusal a mismatch would otherwise trigger on a shared-encoding network.
- `docs/api-crud-review-2026-09-01.md`: the second-round review that carried this as gap G8.

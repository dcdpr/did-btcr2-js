# ADR 138: Indexer Signal Discovery Reads the Full History of a Beacon Address With an Overlap Cursor

- **Status:** Accepted. It replaces one sentence of [ADR 086](086-beacon-signal-recognition.md) decision 2: "discovery only ever examines one page of address history".
- **Date:** 2026-10-07
- **Packages:** `@did-btcr2/bitcoin` (PATCH: the export `ESPLORA_CHAIN_PAGE_SIZE`; the chain listing request sets `max_txs`); `@did-btcr2/method` (MINOR: `BeaconSignalDiscovery.indexer` reads the full history and needs the chain listing); `@did-btcr2/api` (MINOR: dependency uptake, the same resolve behavior)

## Context

The `indexer` signal discovery of `@did-btcr2/method` (`BeaconSignalDiscovery.indexer`) reads the beacon signals of a beacon address from an Esplora REST API. It made one call to `address.getTxs`, which is `GET /address/:address/txs`. That listing holds the mempool transactions and only the first page of the confirmed history: the newest 25 confirmed transactions. Discovery read no other page.

The specification (Resolve, Find Beacon Signals) tells the resolver to "Find the Bitcoin transactions" that spend from the beacon address and carry Signal Bytes. Then it tells the resolver what to do "For each transaction found". The specification sets no limit on the history.

Any person can pay a beacon address. Thus any person can push an old signal off the first page with 25 payments to the beacon address. Then the resolver does not see that signal. It returns the DID document before that update, with no error. If the update rotated or removed a key, the old key still reads as valid.

### The Esplora facts

Esplora pages the confirmed history with `GET /address/:address/txs/chain[/:last_seen_txid]`. The facts below come from the source of Blockstream electrs and mempool-electrs, and from live probes.

1. **The page size.** Blockstream electrs sends 25 transactions in each page and ignores the query parameter `max_txs`. mempool-electrs uses an operator setting (default 25), and the query parameter `max_txs` overrides it.
2. **An unknown cursor gives an empty page.** Both servers send `[]` with HTTP 200 if the serving state does not know the `last_seen_txid` transaction. A block reorganization makes a cursor unknown. A load-balanced server with an instance that is some blocks behind also does this. Thus an empty page does not prove the end of the history.
3. **A check with a separate request is not sound.** Examples are a lookup of the last transaction after the walk, or a check of `chain_stats.tx_count`. The separate request can go to a different instance, with a different state.
4. **The order.** Blockstream electrs and mempool-electrs v3.2.0 and later send the newest block first, in a fixed order in each block. mempool-electrs v3.0.1 and v3.1.0 send the correct 25 transactions of a page in an arbitrary order.
5. **No chain listing in electrum mode.** A mempool instance with `MEMPOOL_BACKEND` other than `esplora` has no chain listing. It sends HTTP 404. Electrum mode is the default of the mempool Docker image.
6. **The reorganization window.** For some seconds in a block reorganization, the index holds only the blocks below the fork height. The state in that window is consistent, but it does not hold the newest blocks.

## Decision

### 1. Discovery reads the full confirmed history of each beacon address

`BeaconSignalDiscovery.indexer` calls `addressSignals` for each beacon address. `addressSignals` reads the history one page after the other with `address.getConfirmedTxs` (the chain listing), newest first. It reads each transaction one time. The signal rules of [ADR 086](086-beacon-signal-recognition.md) apply to each transaction with no change. The method returns the signals of the full history, or it throws. It never returns a part of the history.

The chain listing holds no mempool transaction, so discovery does not use `/address/:address/txs` any more. The check of `status.confirmed` stays as a guard.

### 2. The overlap cursor

The walk has four rules:

1. After a full page, the cursor of the next page is the second-to-last transaction of the raw page. Thus the next page must start again with the last transaction of the full page, the overlap transaction. The cursor comes from the raw page, not from the signals: a full page of payments to the beacon address holds no signal, and the walk must go past it.
2. A page with fewer than `ESPLORA_CHAIN_PAGE_SIZE` (25) transactions is the last page.
3. After a full page, the next page must start with the overlap transaction, and that transaction must have the same `block_hash` on both pages. Else discovery throws `INTERNAL_ERROR`.
4. A full page must hold a transaction that the walk did not read. Else discovery throws `INTERNAL_ERROR`, because the walk does not advance. An example is a server that ignores the cursor and sends page 1 again.

Rule 3 proves that the two pages come from the same chain. The same block hash at one height means the same chain at that height and below. Thus the rest of the history is the same. The proof is in the page data, so it is sound if the two pages come from different instances. An empty page after a full page breaks rule 3, so an unknown cursor never ends the walk.

A history of exactly 25 transactions needs two requests. The second page holds only the overlap transaction.

### 3. The request sets the page size

`EsploraProtocol.getAddressTxsChain` adds `?max_txs=25` to the request. The new export `ESPLORA_CHAIN_PAGE_SIZE` of `@did-btcr2/bitcoin` holds the value. Rule 2 needs a known page size. A mempool-electrs server with a different default sends 25 transactions because of the query parameter.

Discovery does not check `chain_stats.tx_count`. These are the reasons:

- No known server sends fewer than 25 transactions in a page and also ignores `max_txs`.
- The check costs one more request for each beacon address in each resolve.
- A lagging instance reports a lower count, so the check is not sound behind a load balancer (fact 3).

The 25-per-page requirement goes into the documentation (decision 5).

### 4. Discovery does not walk the history again after a stop

If rule 3 or rule 4 stops the walk, discovery throws `INTERNAL_ERROR` with the data `{ address }`. The message tells the caller to resolve again later. Discovery does not start a second walk.

A second walk directly after the stop usually starts in the reorganization window (fact 6). The state in the window is consistent, so the second walk ends with no stop. Then the resolve returns the DID document at the fork height, with no error. That is the defect that this ADR removes. A resolve that the caller starts later usually comes after the window.

### 5. The server requirements are in the documentation

The new section "Esplora server requirements" in `packages/bitcoin/README.md` holds a warning with three requirements:

1. The server serves the chain listing. A mempool instance needs `MEMPOOL_BACKEND=esplora`.
2. The server lists the history in a stable order.
3. The server sends 25 transactions in each full page.

The `btc.rest` row of `packages/cli/docs/config-file.md` links to the section.

A server that breaks requirement 1 or 2 fails closed. An HTTP 404 on the chain listing becomes an `INTERNAL_ERROR` that names the requirement and the `fullnode` signal discovery. Other HTTP errors propagate with no change. A server with an arbitrary order breaks rule 3 at the second page, so each resolve of an address with 25 or more transactions throws `INTERNAL_ERROR`.

## Alternatives

- **Stop the walk at an empty page.** Rejected. An unknown cursor gives an empty page (fact 2). Then the walk ends with most of the history unread and with no error.
- **Use the last transaction of a page as the cursor, and check the end with a separate request.** This was the first design. A review found that the separate request can see a different state from the last page (fact 3), so a stale page passes the check. The overlap cursor puts the proof in the page data.
- **Walk the history a second time after a stop.** Rejected (decision 4). A second walk in the reorganization window returns an old document with no error.
- **Walk a second time, and require the overlap transaction of the first walk.** Rejected. Directly after a stop, the second walk usually stops too. If the overlap transaction left the chain, it stops on each try. It adds code and a test, and it gives nothing more than "resolve again later".
- **Check `chain_stats.tx_count` after the walk.** Rejected (decision 3).
- **Sort each page on the client, to accept mempool-electrs v3.0.1 and v3.1.0.** Rejected. The listing does not give the position of a transaction in its block, so the client cannot restore the server order.

## Consequences

- The `indexer` discovery finds each signal of a beacon address, also if the address has more than 25 confirmed transactions. 25 payments to a beacon address do not hide a signal any more.
- Discovery makes about one request for each 24 transactions of the history, plus one request at the end. A beacon address with a long history costs many requests. `packages/bitcoin` has no retry for HTTP 429, so a public server with a rate limit can make such a resolve fail.
- `INTERNAL_ERROR` occurs more frequently for a short time: in a block reorganization, or if a load-balanced instance is some blocks behind when discovery reads page 2. The caller resolves again later. Only an address with 25 or more confirmed transactions needs a second page, so only such an address gets this error.
- A person who pays a beacon address 25 times in one block can make a resolve fail with `INTERNAL_ERROR` for some seconds after that block, on a load-balanced server. The resolve never returns a wrong document.
- A mempool instance in electrum mode does not work with the `indexer` discovery any more. Before this change, it served the first page. This is the reason for the MINOR bump of `method` and `api`. The `fullnode` discovery and the default REST endpoints of `@did-btcr2/api` are not affected.
- Discovery does not read the mempool part of `/address/:address/txs` any more. Discovery skipped those transactions before, so it loses no signal.
- ADR 086 decision 2 bounds the prevout fetches by the page size. The bound is now the length of the history. A prevout fetch still occurs only for a transaction that passes the script check.

### Follow-up work

- An opt-in cap on the number of pages: off by default, with a `RECOMMENDED_*` value, as [ADR 059](059-unbounded-beacon-discovery-default.md) does for the discovery rounds.
- A retry with backoff for HTTP 429 and 5xx in `packages/bitcoin`.

## Implementation

- `packages/bitcoin/src/client/rest/protocol.ts`: `ESPLORA_CHAIN_PAGE_SIZE`; `getAddressTxsChain` adds `?max_txs=25`.
- `packages/bitcoin/src/index.ts`: the export. `packages/bitcoin/src/client/rest/address.ts`: the JSDoc of `getConfirmedTxs`.
- `packages/bitcoin/tests/rest-client.spec.ts`: the request URLs.
- `packages/method/src/core/beacon/signal-discovery.ts`: `addressSignals` (the walk), `historyPage` (the HTTP 404 error), `continuesAfter` (rule 3), `indexerSignal` (the old loop body), `IndexerRun`, `walkStopped`, `isNotFound`.
- `packages/method/tests/signal-discovery.spec.ts`: the "history walk" tests.
- `packages/api/tests/did-method-api.spec.ts`, `packages/api/tests/did-method-api-cas-policy.spec.ts`: the test REST backends serve the chain listing.
- `packages/bitcoin/README.md`: the section "Esplora server requirements". `packages/cli/docs/config-file.md`: the link in the `btc.rest` row.

## References

- [did:btcr2 specification, Find Beacon Signals](https://dcdpr.github.io/did-btcr2/operations/resolve.html#find-beacon-signals).
- [Esplora HTTP API](https://github.com/Blockstream/esplora/blob/master/API.md): `GET /address/:address/txs/chain[/:last_seen_txid]`.
- [Blockstream electrs `schema.rs`](https://github.com/Blockstream/electrs/blob/new-index/src/new_index/schema.rs) and [mempool-electrs `schema.rs`](https://github.com/mempool/electrs/blob/mempool/src/new_index/schema.rs): the history listing.
- [ADR 059](059-unbounded-beacon-discovery-default.md): an opt-in limit for a limit that the specification does not mandate.
- [ADR 086](086-beacon-signal-recognition.md): the signal rules.

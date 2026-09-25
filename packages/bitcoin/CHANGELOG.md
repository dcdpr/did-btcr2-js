# @did-btcr2/bitcoin

## 0.11.3

### Patch Changes

- The default config works in a browser with no proxy and no custom executor (ADR 124).

  - bitcoin: a GET request carries no `Content-Type`, so a browser sends no CORS preflight. `POST /tx` sends `text/plain` and the `RestConfig` headers, and the protocol ignores a `Content-Type` entry in `RestConfig.headers`. `HttpRequest` gets the optional field `fresh`, which `EsploraProtocol` sets on each endpoint whose response can change. The new export `createFetchExecutor({ timeoutMs? })` sends a fresh request with `cache: 'no-store'` and a random `_` query parameter. `defaultHttpExecutor` is `createFetchExecutor()`.
  - api: `BitcoinApi` uses `createFetchExecutor` for the default executor and for the `timeoutMs` executor. `DEFAULT_CAS_GATEWAY` is `https://trustless-gateway.link`, because `ipfs.io` redirects a raw-block read there with no CORS header.
  - cli: the docs and the config file example name the new default CAS gateway.
  - method, aggregation: dependency uptake.

## 0.11.2

### Patch Changes

- The REST client returns the block height as a number.

  - bitcoin: `BitcoinBlock.count()` converts the `text/plain` body of the Esplora tip height to a number. Before, it returned the body as a string, for example `'601'`. A body that is not a non-negative integer raises `BitcoinRestError`.
  - method, aggregation, api, cli: dependency uptake.

## 0.11.1

### Patch Changes

- The resolver keys the processed beacon signals by beacon address (ADR 118).

  - method: the processed set of BeaconProcess is keyed by beacon address, not by service id. A rotated beacon whose old address carried a signal now resolves past the rotation. `Identifier.encode` rejects a numeric-string network such as `'5'`, which the numeric enum read as a network name and minted as a mainnet identifier.
  - bitcoin: the REST client reads the status before it parses the body. A non-OK status raises `FAILED_HTTP_REQUEST` with the status, the URL, and the body. An OK status with a body that is not JSON raises `INVALID_HTTP_RESPONSE`.
  - aggregation, api, cli: dependency uptake.

## 0.11.0

### Minor Changes

- Make `TransactionStatus` a discriminated union. The confirmed arm carries `block_height`, `block_hash`, and `block_time`. The unconfirmed arm is `{ confirmed: false }` with the block fields typed as absent, as Esplora returns a mempool transaction. A read of a block field must narrow on `confirmed` first. This is a breaking type change for code that read a block field without the check.

### Patch Changes

- Updated dependencies []:
  - @did-btcr2/common@9.4.0

## 0.10.0

### Minor Changes

- Bind JSON-RPC responses to the ids the request actually sent, and type `Vin.prevout` to the shape Esplora returns.

  - **BREAKING:** `JsonRpcProtocol.parseBatchResponse` takes the batch's ids as a required third parameter. They cannot be recomputed at parse time from the protocol's id counter: it is shared and mutable, so any `buildRequest` or `buildBatchRequest` issued while a batch is in flight shifts the window and every response is matched to the wrong call, silently returning one transaction's data as another's. `buildBatchRequest` returns them on the descriptor as `JsonRpcBatchHttpRequest.ids`.
  - **BREAKING:** `Vin.prevout` is typed `Vout | null`, the shape Esplora embeds in an address or transaction listing (`scriptpubkey*` fields, `null` for a coinbase input), replacing the incorrect `TxInPrevout`. Code reading `prevout.scriptPubKey` or `prevout.value` off a REST `Vin` was reading fields that never arrive.
  - Added `JsonRpcHttpRequest` and `JsonRpcBatchHttpRequest`, the request descriptors returned by `buildRequest` and `buildBatchRequest`, carrying the assigned `id` and `ids`.
  - `parseResponse` accepts an optional `expectedId` and throws `BitcoinRpcError` when a numeric response id does not match it. A payload with no id, or a null one (what Bitcoin Core sends when it could not parse the request), is still accepted: an endpoint able to fabricate ids can fabricate `result` just as easily, so the check guards against responses crossed in transit rather than against a dishonest node.

### Patch Changes

- Updated dependencies []:
  - @did-btcr2/common@9.3.0

## 0.9.0

### Minor Changes

- Wire the previously-dead `RpcConfig.wallet` and `RpcConfig.headers` fields in `JsonRpcProtocol` (ADR 078). A configured `wallet` appends `/wallet/<name>` (URL-encoded) to the RPC URL so per-wallet Bitcoin Core RPCs are reachable; configured `headers` are merged into the request headers, while the derived Basic `Authorization` and the fixed `Content-Type` still take precedence. The unused `RpcConfig.allowDefaultWallet` field is removed.

# @did-btcr2/bitcoin

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

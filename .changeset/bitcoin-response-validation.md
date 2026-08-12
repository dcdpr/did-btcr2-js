---
'@did-btcr2/bitcoin': minor
---

Validate everything a Bitcoin endpoint returns, cap response sizes, and keep credentials out of logs and argv-visible surfaces.

BREAKING:

- `JsonRpcProtocol.parseBatchResponse` now requires the request IDs captured on the `BatchHttpRequest` at build time (new required third parameter). Batch results are matched to calls by those IDs, so interleaved `buildRequest`/`buildBatchRequest` calls between build and parse can no longer shift the ID mapping.
- REST and RPC responses are structurally validated on the read path: malformed transactions, blocks, UTXOs, address info, tip heights, and broadcast results throw typed `BitcoinRestError`/`BitcoinRpcError` instead of propagating as corrupt data.
- `BitcoinBlock.get` never resolves to `undefined`: it resolves with validated block data or throws (`BitcoinRestError`).
- `Vin.prevout` is typed to the real Esplora shape (a `Vout` with `scriptpubkey*` fields), replacing the incorrect `TxInPrevout` type.
- RPC result validation is verbosity-aware: `getblock` and `getrawtransaction` results are checked against the verbosity of the request, so a response that does not match what was asked for is rejected up front.

Added:

- Response body size caps on the REST and RPC clients (`maxResponseBytes`, default 32 MiB); over-limit or unparsable bodies throw typed errors, and HTTP error bodies are capped before being embedded in thrown error messages.
- A startup warning when configured credentials (basic auth, URL userinfo, or an Authorization header) would be sent over cleartext HTTP to a non-loopback host, and userinfo redaction for URLs appearing in logs and error messages.

Fixed:

- `btcToSats` rejects non-finite and out-of-range BTC values instead of silently corrupting them through exponential notation.
- The Esplora tip-height endpoint no longer accepts an empty or non-numeric body as height 0.

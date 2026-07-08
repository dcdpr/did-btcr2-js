# @did-btcr2/bitcoin

## 0.9.0

### Minor Changes

- Wire the previously-dead `RpcConfig.wallet` and `RpcConfig.headers` fields in `JsonRpcProtocol` (ADR 078). A configured `wallet` appends `/wallet/<name>` (URL-encoded) to the RPC URL so per-wallet Bitcoin Core RPCs are reachable; configured `headers` are merged into the request headers, while the derived Basic `Authorization` and the fixed `Content-Type` still take precedence. The unused `RpcConfig.allowDefaultWallet` field is removed.

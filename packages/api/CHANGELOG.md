# @did-btcr2/api

## 0.14.0

### Minor Changes

- Drop the `helia` production dependency in favor of fetch-based CAS executors (ADR 069). `BlockstoreCasExecutor` (structurally typed, accepts any in-process blockstore or blockstore provider, e.g. a Helia node) replaces `IpfsCasExecutor`; the new `IpfsRpcCasExecutor` publishes and retrieves raw blocks via the IPFS HTTP RPC API with local CID verification. `CasConfig` replaces `helia` with `blockstore` and adds `rpcUrl`; backend priority is `executor` > `blockstore` > `rpcUrl` > `gateway`. Consumers no longer install the libp2p subtree (436 lockfile packages removed).

## 0.13.12

### Patch Changes

- Updated dependencies []:
  - @did-btcr2/method@0.53.0

## 0.13.11

### Patch Changes

- Updated dependencies []:
  - @did-btcr2/method@0.52.0

## 0.13.10

### Patch Changes

- Updated dependencies []:
  - @did-btcr2/method@0.51.0

---
title: "ADR 069: Fetch-Based CAS Executors Replace the In-Process IPFS Dependency"
---

# ADR 069: Fetch-Based CAS Executors Replace the In-Process IPFS Dependency

**Status:** Accepted

**Date:** 2026-07-06

**Branch / PR:** `refactor/cas-drop-helia`

**References:** [ADR 023](023-cas-read-path.md), [ADR 058](058-remove-legacy-helia-cas-path.md), [ADR 064](064-foss-coverage-and-dependency-audit-gate.md)

## Context

The SDK's content-addressed storage layer (`CasApi`, ADR 023) selects a `CasExecutor` backend from its configuration. Until now the api package offered two executors: a read-only HTTP executor speaking the IPFS Trustless Gateway protocol, and `IpfsCasExecutor`, which wrapped a caller-supplied Helia (in-process IPFS node) instance and was typed against the `Helia` interface. That typing made `helia` a production dependency of the api package, even though:

- The import was type-only. The Helia instance was always supplied by the caller; no shipped code path ever constructed one. The type erased at build time, so no bundle contained Helia code.
- The only runtime `createHelia()` calls in the workspace were two one-off latency-measurement scripts under the api package's `lib/` dev-tooling directory.
- ADR 058 had already removed the method package's Helia dependency; the api package's type-only dependency was the last one in the workspace.

The cost of that one declaration was carried by every consumer and by CI:

- `helia` pulls the full libp2p subtree (436 packages in this workspace's lockfile), inflating installs for every api/cli consumer.
- Essentially the whole production-audit finding set (roughly 28 high advisories plus one critical) entered through that subtree (libp2p, react-native-webrtc, undici). The dependency-audit gate (ADR 064) therefore had to run at `critical`-only severity and allowlist GHSA-w7jw-789q-3m8p, an unreachable shell-quote advisory five hops inside the Helia tree.
- Publishing to IPFS from a plain HTTP endpoint was impossible through the shipped executors: the gateway executor is read-only by protocol, so the only write path required embedding an IPFS node in-process.

## Decision

Drop the `helia` dependency entirely and restructure the executor set around plain `fetch` and structural typing:

1. **`BlockstoreCasExecutor` replaces `IpfsCasExecutor`.** It is typed against two local structural interfaces, `BlockstoreLike` (`get`/`put` of raw blocks by CID) and `BlockstoreProviderLike` (anything exposing a `blockstore` property). A Helia instance satisfies `BlockstoreProviderLike` unchanged, so in-process IPFS nodes still plug in with the same one-argument construction, without this package declaring any IPFS implementation as a dependency.
2. **`IpfsRpcCasExecutor` is added as the fetch-based read-write backend.** It speaks the IPFS HTTP RPC API (the interface a Kubo node exposes): `block/put` with the raw codec, SHA-256 multihash, and pinning for publishes; `block/get` for retrieval. `publish` derives the expected CID locally from the content hash and rejects if the node reports a different CID, so a misconfigured node cannot silently store content under a different address.
3. **`CasConfig` selects among four backends** with the priority `executor` > `blockstore` > `rpcUrl` > `gateway`. The `helia` field is replaced by `blockstore`; `rpcUrl` is new; the read-only `gateway` default is unchanged.
4. **The `helia` production dependency is removed** from the api package, and the two Helia-based dev scripts are replaced by one that exercises the RPC executor against a real node. Helia leaves the workspace lockfile entirely.
5. **The dependency-audit gate is tightened from `critical` to `high` and scoped to production dependencies** (`skip-dev`), with its allowlist emptied, as the gate's own configuration comment had planned once the Helia surface was gone. Dev-tooling chains (eslint, mocha, rollup, esbuild, browser-polyfill shims) still carry transitive advisories pinned by their parents; those never ship, and a plain `pnpm audit` still surfaces them.

## Consequences

- The workspace lockfile shrinks by 436 packages. Consumers installing `@did-btcr2/api` or `@did-btcr2/cli` no longer download the libp2p subtree.
- A clean production audit at `high` severity becomes a hard CI gate; any new high advisory in a published package's runtime tree now blocks merges instead of scrolling past. Dev-dependency advisories no longer block at all (previously they did at `critical`), a deliberate narrowing: they do not ship to consumers.
- Publishing to IPFS no longer requires an in-process node: any Kubo-compatible RPC endpoint works over plain `fetch`, in both Node and browser builds, symmetric with the existing gateway read path.
- The api package's public surface changes: `IpfsCasExecutor` and `CasConfig.helia` are removed in favor of `BlockstoreCasExecutor`, `CasConfig.blockstore`, `IpfsRpcCasExecutor`, and `CasConfig.rpcUrl`. This is a breaking change to a 0.x package and is released as a minor version bump. Code that passed a Helia instance migrates by renaming the config key (`helia:` to `blockstore:`); the value it passes is unchanged.
- CAS read behavior, hash-to-CID derivation (CIDv1, raw codec, SHA-256), and the `CasApi` facade contract are unchanged; the write path gains its first HTTP-reachable implementation.

## Rejected alternatives

- **Keep `helia` as a devDependency for the dev scripts.** The production audit would come clean, but the lockfile would still carry the libp2p subtree, `pnpm audit` (unfiltered) would still drown signal in ~28 unfixable advisories, and the scripts themselves duplicated what the RPC executor script now measures against a real node.
- **Remove the in-process executor outright.** Deleting `IpfsCasExecutor` without a structural replacement would strand SDK users who already run an embedded IPFS node. The structural `BlockstoreLike` typing keeps that door open at the cost of about ten lines, with zero dependency weight.
- **Depend on `kubo-rpc-client` for the RPC executor.** The client library covers the whole RPC surface; the executor needs exactly two endpoints with fixed query parameters. A dependency-free `fetch` implementation is smaller than the import it would replace and keeps the browser bundle unchanged.
- **Publish through a pinning-service SDK (Pinata, web3.storage).** Vendor SDKs would reintroduce exactly the kind of heavyweight, vendor-specific dependency this change removes; the pluggable `CasExecutor` interface already lets applications integrate those services themselves.

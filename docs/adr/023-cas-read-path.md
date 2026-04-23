---
title: "ADR 023: CAS Read Path: Helia vs HTTP Gateway"
---

# ADR 023: CAS Read Path: Helia vs HTTP Gateway

**Status:** Accepted

**Date:** 2026-04-10

**Commit:** [`8fe1404`](https://github.com/dcdpr/did-btcr2-js/commit/8fe1404)

## Context

The CAS beacon announces off-chain `Announcement` objects keyed by their SHA-256 content hash. Resolvers must retrieve those announcements to process the beacon signal. Two sensible transport choices exist:

- **Helia (embedded IPFS node).** A full libp2p/IPFS node running inside the consumer's process. Content is fetched via the IPFS DHT. Strong: decentralized, no reliance on a single gateway operator. Weak: heavyweight (hundreds of KB bundle size, significant memory), slow to bootstrap, browser-hostile in practice (WebRTC/WebSocket relays, NAT traversal).
- **HTTP gateway (e.g. `https://ipfs.io`, `https://dweb.link`).** An HTTP request to a public IPFS gateway that returns the content. Strong: trivial implementation, works in any browser, zero boot time, minimal bundle. Weak: trust-a-gateway, single-point-of-failure, gateways can censor.

Wallet webapps and interactive resolvers need fast, lightweight retrieval. Long-running CLIs and service operators might prefer a full Helia node. Both use cases must be supportable without forcing either.

## Options considered

1. **Helia-only.** Strong decentralization story; unusable in most browser contexts.
2. **HTTP-gateway-only.** Trivial implementation; loses the decentralized narrative completely.
3. **Pluggable `CasExecutor` interface: two default implementations (Helia, HTTP gateway): consumer picks.**

## Decision

**Option 3.** Introduce `CasExecutor` interface in `@did-btcr2/api/src/cas.ts`:

```ts
interface CasExecutor {
  retrieve(hash: string): Promise<Uint8Array | null>;
  publish(data: Uint8Array): Promise<string>;
}
```

Two default implementations ship:

- **`IpfsCasExecutor`**: backed by a caller-provided Helia instance. Deterministic CID derivation from base64url-nopad SHA-256.
- **`HttpGatewayCasExecutor`** (implied by default): reads via the public IPFS gateway at `https://ipfs.io` unless the caller overrides with `DEFAULT_CAS_GATEWAY`.

Consumer chooses by constructing the appropriate executor and passing it into `Api.cas`. The resolver doesn't know or care which implementation is in use.

Default fallback when no CAS is configured: HTTP gateway (the lightweight default fits the wallet / browser scenario and degrades gracefully if the gateway is down: the error is visible).

## Consequences

**Positive**
- Wallets and browser resolvers get trivial CAS retrieval with zero IPFS-bundle weight.
- Service operators running full nodes can plug in Helia without touching the resolver code path.
- The `CasExecutor` interface is a natural place for additional backends (S3-compatible, local blockstore, cache layer, bucket-of-mirrors).
- Publishing (not just reading) is part of the interface so both use cases: announce and resolve: work symmetrically.

**Negative**
- HTTP gateway is a trust-a-third-party read path. A censoring gateway can selectively withhold specific CIDs. Documentation must call this out so users hosting sensitive DIDs know to run their own gateway or use Helia.
- Two default implementations mean two code paths to keep tested. Helia tests require a running kubo node or in-memory Helia; HTTP gateway tests are straightforward `fetch`-mock style.

**Explicitly accepted trade-offs**
- Public gateway outage affects the default configuration. Users who care about availability set their own gateway URL or plug in Helia.
- "Content-addressed" is preserved on both paths: the hash still pins what's retrieved, so a malicious gateway cannot silently swap content without the resolver detecting it. Censorship (dropping content) is the only remaining gateway attack.

## References

- [`packages/api/src/cas.ts`](../../packages/api/src/cas.ts): `CasExecutor`, `IpfsCasExecutor`, `DEFAULT_CAS_GATEWAY`.
- [`packages/method/src/core/beacon/cas-beacon.ts`](../../packages/method/src/core/beacon/cas-beacon.ts): consumer of the CAS retrieval path via `NeedCASAnnouncement`.
- [ADR 018](018-beacon-hierarchy.md): where CAS fits in the beacon hierarchy.

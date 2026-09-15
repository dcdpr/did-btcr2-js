# ADR 117: The Regtest Vectors Publish the CAS Objects to a Kubo Node in the Polar Stack, and the Public Networks Use an External IPFS Node

- **Status:** Accepted
- **Date:** 2026-09-15
- **Packages:** development scripts under `lib/` in `@did-btcr2/api`. No shipped package changes.

## Context

The test-vector pipeline routes some objects of a scenario out of the resolution sidecar into a Content-Addressed Store (ADR 113): a genesis document, a signed update, or a CAS Announcement Map. The publish step pins each object as a raw block under the CID that the resolver derives from the content hash (ADR 023). The step needs a Kubo-compatible RPC endpoint. The repository records no endpoint. The api reads a CAS object through an HTTP gateway. The default gateway is a public one.

The regtest vectors ship with an export of the Polar network that holds the chain and the Esplora index. A consumer of the regtest vectors runs that stack on the own machine. Until now the CAS objects of the regtest vectors had no home. A pin on a public IPFS node adds a third party to the regtest corpus. The node can drop the pins. A public gateway can be slow, rate limited, or blocked. An offline consumer cannot reach it at all.

The public test networks (mutinynet, testnet4, signet) are different. Their chains are public, and a consumer reads them through public services. The CAS objects of those networks belong on a public IPFS node as well.

## Decision

**Regtest publishes to a Kubo node in the Polar stack.** The compose file of the Polar network gets a Kubo service, next to the Esplora service. The daemon runs offline: no swarm, no DHT, no bootstrap traffic. The RPC API and the gateway bind to the loopback of the host, because the RPC API has no authentication. The Kubo repository lives in `volumes/ipfs`, inside the network folder, so the Polar export carries the pinned blocks.

**The regtest defaults name the stack.** On regtest, `scenario:publish --publish` pins to `http://127.0.0.1:5001`, and `scenario:verify:live` reads through `http://127.0.0.1:8080`. `IPFS_RPC_URL` and `CAS_GATEWAY` override the defaults. A consumer of the regtest vectors configures the resolver with the same gateway.

**The public networks use an external node.** On mutinynet, testnet4, and signet, the publish step needs `IPFS_RPC_URL`. The maintainer names a node that gave permission for the pins. The repository records no public endpoint. The live verify reads through the default gateway of the api, or through `CAS_GATEWAY`.

## Scope boundary

- No shipped package changes. The default gateway of the api does not change.
- The compose service belongs to the Polar network, not to the repository. The pipeline documentation shows the service block. The export of the network carries the file.
- The Kubo repository in the export holds a node identity key. The key is a throwaway. The node runs offline, so the identity reaches no peer.
- The regtest export grows by the Kubo repository. The repository holds a few kilobytes of blocks.

## Consequences

**Positive.** The regtest corpus is self-contained: the chain, the index, and the CAS objects come from one export, and a consumer runs the whole stack offline. No third party holds the regtest pins. A missing object fails fast, because an offline daemon does not search the network.

**Negative.** A consumer of the regtest vectors runs one more container. Polar can drop the added services from the compose file on import. The README of the regtest corpus tells the consumer to copy them back. The regtest defaults differ from the public networks in two settings.

**Unchanged.** The publish manifest and the CID manifest (ADR 113). The CID derivation (ADR 023). The one-pass rule and the anchor rounds (ADR 116).

## Implementation

- `packages/api/lib/_e2e-helpers.ts`: `REGTEST_IPFS`, the RPC and gateway URLs of the stack.
- `packages/api/lib/publish-scenarios.ts`: the regtest default of the RPC endpoint.
- `packages/api/lib/verify-live.ts`: the regtest default of the gateway.
- `packages/api/docs/test-vectors.md`: the service block, the ports, and the publish step.
- `packages/api/lib/scenarios/regtest/README.head.md`: the gateway for a consumer of the regtest vectors.
- No package version change.

## References

- [ADR 023](023-cas-read-path.md): the CID derivation of a CAS object.
- [ADR 073](073-cas-publication-is-opt-in.md): the CAS publication policy of the api.
- [ADR 113](113-test-vector-pipeline-and-submodule-live-in-the-api-package.md): the route and publish steps of the pipeline.
- [ADR 116](116-anchor-step-broadcasts-one-round-per-command-and-no-script-mines.md): the regtest network with auto-mine.

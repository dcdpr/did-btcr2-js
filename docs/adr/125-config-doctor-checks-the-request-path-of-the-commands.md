# ADR 125: config doctor Checks the Request Path of the Commands

- **Status:** Accepted
- **Date:** 2026-09-25
- **Packages:** `@did-btcr2/api` (PATCH, adds `CasApi.probe` and the optional `CasExecutor.probe`); `@did-btcr2/cli` (PATCH)

## Context

`btcr2 config doctor` and the probe step of `btcr2 quickstart` reported `ok` for an endpoint if the host answered with a 2xx status. The checks did not send the request of a command, and they did not test the answer:

- `btc-rest`: `GET <rest-host>/blocks/tip/height`, with a status test only.
- `btc-rpc`: `getblockchaininfo`, with no test of the chain.
- `cas`: `GET` on the base URL of the gateway, or `POST /api/v0/version` on a CAS RPC endpoint.

On 2026-09-25, these checks gave a false `ok` in three cases:

1. **A gateway base URL.** `https://ipfs.io/` and `https://trustless-gateway.link/` redirect to a documentation page that answers 200. With ipfs.io as the default, the check passed, but a browser could not read a block (ADR 124).
2. **A web app at the root of a host.** `https://mutinynet.jintek.co` answers each path with the page of its block explorer (200, `text/html`). Its Esplora API is at `/api`. As `--btc-rest` without `/api`, and as `--cas-gateway`, the host passed both checks. A `resolve` then fails.
3. **An endpoint of another chain.** `--btc-rest https://mempool.space/api` for `testnet4`, and the signet endpoint for `mutinynet`, passed the check.

Also, the RPC check stopped its wait at the timeout but did not abort the request. So a hung host kept the process open after the report.

## Decision

**Each check sends a request of the commands through the same client, and tests the answer.** `runDoctor` builds the api from the resolved config, as the commands do, with a 5-second timeout for Bitcoin and for CAS. The Bitcoin timeout aborts the request through `createFetchExecutor` (ADR 124). The CAS check aborts through an `AbortSignal`. The doctor has no fetch call of its own.

**`btc-rest` and `btc-rpc` read the hash of a chain marker block.** The check reads the block hash at a fixed height and compares it with a constant for the network:

| Network | Height | Reason |
|---|---|---|
| `bitcoin`, `testnet3`, `testnet4`, `regtest` | 0 | Each genesis block is different. |
| `signet`, `mutinynet` | 1 | All signets share one genesis block. Block 1 is different. |

The REST check calls `BitcoinRestClient.block.getHash(height)` (`GET /block-height/:height`, a fresh request). The RPC check calls `getblockhash`. A pass proves an Esplora or a Bitcoin Core endpoint for the chain of the network. A web page fails at the JSON parse. An endpoint of another chain fails at the compare.

**`cas` reads a fixed identity block through the executor of the commands.** `CasExecutor` gets the optional method `probe(signal?)`. `CasApi.probe()` calls it with an abort signal at the CAS timeout. The block is the identity CID `bafkqaclenfsduytumnzde`: the raw codec, with the bytes `did:btcr2` in the digest. A gateway or a Kubo node answers an identity CID from the CID itself. So the check does not depend on content in the IPFS network, and it writes nothing.

`HttpGatewayCasExecutor.probe` and `IpfsRpcCasExecutor.probe` send the request of `retrieve` through one private method, and compare the bytes. The executors select the same endpoint as the commands: the RPC endpoint if one is set, else the gateway. `BlockstoreCasExecutor` has no probe, because a generic blockstore does not always hold identity blocks.

## Alternatives

- **A test of the status and the content type.** It passes a server that sends the correct type with wrong content, and it needs a list of types for each endpoint. A compare of the bytes or the hash tests the content itself.
- **A real content block (a SHA-256 CID).** The answer then depends on the providers in the IPFS network. The first read of an uncached block on trustless-gateway.link took 21 seconds (ADR 124). A missing block does not prove a broken gateway.
- **A `block/put` for the RPC check.** It proves the write path, but the doctor must not write. The check reads with `block/get` only, and the documentation says that the check does not prove a write.
- **The chain tip for `btc-rest`.** It proves an Esplora endpoint, but not the chain.
- **The request of the CAS check in the cli.** A copy of the URL and the headers in the doctor can differ from the executor after a later change. The probe is next to `retrieve`, and the two use one private method.

## Consequences

**Positive.** The doctor fails each of the three false cases, and the `detail` names the cause: `returned a body that is not JSON`, `not the probe block`, or `the endpoint serves another chain`. The defaults of the five public networks pass. A hung host fails at 5 seconds, and the process ends after the report.

**Negative.** A CAS RPC check does not prove that `block/put` works. The chain marker table is a constant, so a new network needs a row. A custom `CasExecutor` with no `probe` fails the `cas` check with `The CAS executor has no probe method.` The cli does not use a custom executor.

**Unchanged.** The report shape `{ checks: [{ endpoint, target, ok, detail? }], coherence? }`, the exit code, the coherence warning, and the limit of 5 seconds for each check. The quickstart warning text changes from "endpoints were unreachable" to "endpoint checks failed".

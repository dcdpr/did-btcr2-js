# ADR 170: The api Aborts a CAS Operation at the Timeout and Reads From an Ordered List of Gateways

- **Status:** Accepted
- **Date:** 2026-11-01
- **Packages:** `@did-btcr2/api` (MINOR: `CasConfig.gateways` replaces `CasConfig.gateway`; `CasApi.retrieve` reads from each gateway of the list in order; at the CAS timeout, `CasApi` aborts the operation; `CasExecutor` and `BlockstoreLike` take an optional abort signal; `CasApi.probe` checks each gateway of the list, and a probe that times out rejects with the message of the CAS timeout); `@did-btcr2/cli` (PATCH: the cli passes its one gateway to the api as a list of one; dependency uptake through api)

## Context

### The specification

BTCR2 Update Data Distribution, section "Content Addressable Storage (CAS)", says: "For each retrieval from CAS, the resolver MUST compute the SHA-256 hash of the retrieved content. The resolver MUST compare the computed hash to the hash that was used for the retrieval. If the hashes do not match, the resolver MUST NOT use the content."

The same section says: "If the CAS mechanism is not provided, the resolver MAY iterate through all supported CAS mechanisms to find the files or it MAY return with an error indicating that the CAS mechanism is required." The IPFS section says: "A resolver retrieves a file associated with a SHA-256 hash by constructing the IPFS CIDv1 and requesting the file from an IPFS node."

The Resolve operation says:

- For a signed update: "Raise a `MISSING_UPDATE_DATA` error if the update is not available from either source."
- For a CAS Announcement: "The announcement is not available from CAS if the hash of the retrieved content is not equal to `map_update_hash` (BTCR2 Update Data Distribution)."

The specification has no text about the number of IPFS nodes, about a timeout, or about the end of a request.

### `CasApi` did not stop the read at the timeout

`CasApi` limits each operation with `timeoutMs` (ADR 076, decision 4). The default is 30000. If `timeoutMs` is `0`, no timeout applies.

The private method `#withTimeout` raced the promise of the executor against a timer. At the timeout, `CasApi.retrieve` rejected with a `ResolveError` of type `MISSING_UPDATE_DATA` (ADR 164, decision 3). The executor read stayed open. ADR 164 lists this as a residual: "The timeout of `CasApi` does not stop the read of the executor."

`CasExecutor.retrieve(hash)` and `CasExecutor.publish(data)` took no signal. The private request methods of `IpfsRpcCasExecutor` and `HttpGatewayCasExecutor` took a signal, but `retrieve` passed them no signal. `CasExecutor.probe(signal?)` took a signal (ADR 125), and `CasApi.probe` passed it `AbortSignal.timeout(timeoutMs)`.

### The config took one gateway

`CasConfig.gateway` took one URL. An app could not name a second gateway for a read that failed on the first. ADR 124 says that trustless-gateway.link, ipfs.io, and dweb.link share one pool of servers and one rate limit. It also says that a high-volume app must configure its own gateway. With one URL, such an app could not use a public gateway if its own gateway failed.

The vector pipeline had its own executor for this purpose: `GatewayChainCasExecutor` in `packages/api/lib/_e2e-helpers.ts`. It read from each gateway in order and took the first block that it found. It gave each gateway 20 seconds through a race, so a gateway request also stayed open. It counted a gateway that did not answer in 20 seconds as a gateway with no content.

The executor gave `CasApi` the first bytes that it found, also if the bytes had a different hash. `CasApi.retrieve` then refused them (ADR 110), and the executor did not read from the next gateway.

### Examples

| Case | Before | After |
|---|---|---|
| A local gateway answers after 3 seconds, and `timeoutMs` is 500. | `CasApi.retrieve` rejects at 0.5 seconds. The server sees no abort of the request. The request ends after 3 seconds. | `CasApi.retrieve` rejects at 0.5 seconds. The server sees the abort of the request at 531 ms. |
| `btcr2 resolve --cas-timeout 300`, and the gateway does not answer (ADR 164). | The cli prints the error after 0.5 seconds. It exits after 7.6 seconds, when the gateway closes the request. | The api aborts the request at the timeout. The cli prints the error and exits. It does not wait for the gateway. |
| A browser app. The gateway answers after the timeout with an error status and no CORS header. | The browser console shows a CORS error for a request that the app no longer uses. | The api aborts the request at the timeout. The browser does not process a late answer. |
| Gateway A gives bytes with a different hash. Gateway B has the content. | The config cannot name B: `CasConfig.gateway` takes one URL. | With `cas: { gateways: [A, B] }`, the api reads from A, then from B. It returns the content of B. |

## Decision

### 1. `CasConfig.gateways` replaces `CasConfig.gateway`

`CasConfig.gateways` is an ordered list of the URLs of IPFS HTTP gateways: `gateways?: readonly string[]`. `CasApi` makes one `HttpGatewayCasExecutor` for each URL. This change removes `CasConfig.gateway` and adds no alias.

The priority does not change: `executor` > `blockstore` > `rpcUrl` > `gateways`. An empty list is not a backend. If a config has an empty list and no other backend, the constructor throws the error of a config with no backend. That message starts with `CAS configuration requires an executor, blockstore, RPC URL, or gateway URL.`

The default config of `DidBtcr2Api.cas` is `{ gateways: [DEFAULT_CAS_GATEWAY] }`. `DEFAULT_CAS_GATEWAY` stays `https://trustless-gateway.link` (ADR 124).

### 2. `CasApi.retrieve` reads from each gateway in the order of the list

`CasApi.retrieve` reads from the first gateway. It reads from the next gateway if the read of a gateway has one of these results:

1. No content: the executor returns `null`. `HttpGatewayCasExecutor` also returns `null` if the gateway answers with an error status, or if the request fails before the timeout (ADR 164).
2. A timeout (decision 4).
3. Bytes that do not hash to the requested hash.

`CasApi.retrieve` stops at the first bytes with the requested hash. Then it decodes and parses the bytes. If the bytes are not UTF-8 JSON text of an object, it rejects with a `ResolveError` of type `MISSING_UPDATE_DATA` (ADRs 110 and 164). It then reads from no other gateway. Each gateway that gives bytes with the requested hash gives the same bytes. So no other gateway can give JSON text for this hash.

Each of `executor`, `blockstore`, and `rpcUrl` gives a list of one source. `CasApi.publish` uses the first source. A gateway cannot publish, so a list of gateways is not writable.

### 3. The result if no source gives bytes with the requested hash

If no source gives bytes with the requested hash, `CasApi.retrieve` has one of these results:

- `null`, if each source returns `null`.
- Else a rejection with a `ResolveError` of type `MISSING_UPDATE_DATA`.

For a list of gateways, only a timeout or bytes with a different hash cause the rejection. `HttpGatewayCasExecutor` returns `null` for each other failure (decision 2). With one source, the result is also a rejection if the executor throws or rejects.

With one source, the message and the `data` do not change (ADR 110, ADR 164 decision 3):

- `CAS content for <hash> cannot be retrieved: <cause>` with `{ hash, cause }`, for a failure or a timeout.
- `CAS content for <hash> hashes to <actual>; the resolver must not use it.` with `{ hash, actual }`, for bytes with a different hash.

With two or more gateways, the message names each gateway and its result, in the order of the list: `CAS content for <hash> cannot be retrieved from the gateways: <url>: <result>; <url>: <result>.` A result is `no content`, `the content hashes to <actual>`, or the text of the cause (ADR 156). For a cause with no text, the result is `the read fails`. The `data` is `{ hash, gateways }`. `gateways` has one entry per gateway: `{ gateway, cause?, actual? }`.

### 4. At the CAS timeout, `CasApi` aborts the operation

`CasExecutor.retrieve(hash, signal?)` and `CasExecutor.publish(data, signal?)` take an optional `AbortSignal`. `BlockstoreLike.get(cid, options?)` and `BlockstoreLike.put(cid, block, options?)` take an optional `{ signal }`, the form of the Helia blockstore.

`#withTimeout` makes an `AbortController` for each operation and passes its signal to the executor. At the timeout, it aborts the signal and rejects with `CAS operation timed out after <n>ms`. The built-in executors pass the signal to `fetch` or to the blockstore, so `fetch` or the blockstore aborts the request at the timeout. The race stays: `CasApi` also rejects at the timeout if a custom executor does not use the signal.

After an abort, the `retrieve` method of each built-in executor rejects with the reason of the signal. It does not return `null`, because an aborted read has no result. If a read fails and the signal is not aborted, `retrieve` still returns `null`.

The timeout applies to the read of each gateway. Each gateway gets its own `timeoutMs` and its own signal. `retrieve`, `publish`, and `probe` use the same timeout. If `timeoutMs` is `0`, the executor gets no signal.

### 5. `CasApi.probe` checks each gateway

`CasApi.probe` calls `probe` of each source through `#withTimeout`. So a probe that times out rejects with `CAS operation timed out after <n>ms`.

With a list, `probe` checks each gateway at the same time. Each gateway must answer. If one or more gateways do not answer, `probe` rejects with `One or more CAS gateways do not answer: <url>: <reason>; <url>: <reason>.` A reason is the text of the error, or `no answer` for an error with no text. With one source, `probe` rejects with the error of that source.

### 6. The cli keeps one gateway

The cli keeps the one gateway of `--cas-gateway`, `BTCR2_CAS_GATEWAY`, and the config file key `cas.gateway`. It passes that gateway to the api as `gateways: [url]`. `btcr2 config doctor` names the first gateway of the list.

### 7. The vector pipeline passes its list of gateways to the api

`verify-live.ts` passes `cas: { gateways, timeoutMs: CAS_GATEWAY_TIMEOUT_MS }` to the api. Each gateway still gets 20 seconds per object. This change removes `GatewayChainCasExecutor` and its helper `valueOrNull`. The `CAS_GATEWAY` variable and the default list `PUBLIC_CAS_GATEWAYS` do not change.

The old executor counted a gateway that did not answer in 20 seconds as a gateway with no content. The api counts it as a timeout (decision 3). So the resolve of a negative set with the rule `update-missing` can now give the message `CAS content for <hash> cannot be retrieved`. ADR 136 says that the pattern of a rule must change with the message text. The pattern of `update-missing` now also accepts that message. Each of the two messages says that the signed update is not available from the CAS.

### 8. Each judgment call conforms to the specification texts

| Judgment call | Text | Result |
|---|---|---|
| The api reads from more than one gateway (decisions 1 and 2). | BTCR2 Update Data Distribution, IPFS: "A resolver retrieves a file associated with a SHA-256 hash by constructing the IPFS CIDv1 and requesting the file from an IPFS node." | Conforms. The specification names no node and does not limit the number of requests. |
| The api reads from the next gateway after bytes with a different hash (decision 2). | BTCR2 Update Data Distribution, CAS: "If the hashes do not match, the resolver MUST NOT use the content." | Conforms. The api does not use the bytes. The text does not tell the resolver to stop. |
| The api rejects with `MISSING_UPDATE_DATA` only after it reads from each gateway of the list (decision 3). | Resolve: "Raise a `MISSING_UPDATE_DATA` error if the update is not available from either source." | Conforms. The content is not available from the CAS if no gateway gives it. The genesis document path keeps `NOT_FOUND` (ADR 164, decision 3). |
| The pattern of `update-missing` accepts the message of a CAS read that fails (decision 7). | Resolve: "Raise a `MISSING_UPDATE_DATA` error if the update is not available from either source." | Conforms. The error type is `MISSING_UPDATE_DATA` for each of the two messages. |
| At the timeout, the api aborts the request (decision 4). | The specification has no text about a timeout or about the end of a request. | The specification is silent. The abort is a library decision. |
| `probe` requires an answer from each gateway (decision 5). | The specification has no text about a health check. | The specification is silent. The health check is a library decision. |

## Alternatives

**`gateway: string | string[]`.** Rejected. One key then has two forms, and each reader of the config must handle both. An example is `btcr2 config doctor`. The packages have no users yet, so the change needs no alias.

**One timeout for the whole list.** Rejected. A first gateway that does not answer then uses the full timeout, and the api never reads from the next gateway.

**Read from all gateways at the same time, and take the first bytes with the requested hash.** Rejected. The api then sends a request to each gateway for each read. The order of the list then has no effect, so an app cannot put its own gateway before the public gateways. The public gateways share one rate limit (ADR 124).

**Stop at bytes with a different hash, as before.** Rejected. The specification says only that the resolver MUST NOT use the content. Another gateway can give bytes with the requested hash.

**Count a gateway that does not answer as a gateway with no content, as the old executor of the vector pipeline did.** Rejected. With one source, a timeout gives a rejection (ADR 164, decision 3). A list of gateways must give the same result as a list of one gateway.

**`probe` passes if one gateway answers.** Rejected. A health report then does not show a gateway of the list that does not answer.

**Keep the race, and pass no signal to the executor.** Rejected. The request then stays open after the timeout. The cli then waits for the gateway, and the browser shows errors for requests that the app no longer uses.

**A default list of public gateways.** Rejected. A browser app needs a gateway that sends `Access-Control-Allow-Origin`. ADR 124 found that ipfs.io redirects the raw-block request with no such header. trustless-gateway.link, ipfs.io, and dweb.link share one pool of servers (ADR 124). So a second gateway of that pool does not make a read more reliable.

## Consequences

- The api gets a MINOR release, and the cli gets a PATCH release. No other package gets a release.
- The test vectors do not change. The vector pipeline changes the pattern of one rule (decision 7).
- A TypeScript config with `gateway` does not compile. A JavaScript config with only `gateway` has no backend, so the `CasApi` constructor throws.
- With one gateway, `CasApi.retrieve` has the same results as before. At the timeout, the api now aborts the request. In the local test of the examples, the server saw the abort at 531 ms, with `timeoutMs` 500.
- The api aborts the gateway request at the CAS timeout, so the cli process ends at the timeout. Before, a gateway that did not answer kept the process open until the gateway closed the request.
- A read from a list of n gateways can take n times `timeoutMs`.
- A probe that times out rejects with `CAS operation timed out after <n>ms`. Before, the message was the text of the `DOMException` of `AbortSignal.timeout`.
- The live verify of the vector pipeline reads from the next gateway if a gateway gives bytes with a different hash. Before, `CasApi` refused such bytes, and the verify used no other gateway.

These residuals stay:

- **A custom executor that does not use the signal.** Such an executor keeps its request open after the timeout. `CasApi` still rejects at the timeout.
- **No signal from the caller.** `api.cas.retrieve` and `resolveDid` take no signal from the caller. A caller cannot abort a CAS read before the timeout.
- **One gateway in the cli.** The cli takes only one gateway. A cli user cannot name a second gateway.

**Superseded.**

- ADR 069, decision 3: "`CasConfig` selects among four backends with the priority `executor` > `blockstore` > `rpcUrl` > `gateway`." It also says that "the read-only `gateway` default is unchanged." Decision 1 of this ADR replaces `gateway` with the list `gateways`, and the default with a list of one.
- ADR 072, decision 1: `resolveConnectionConfig` "passes both `gateway` and `rpcUrl` through when set". The decision also names "the api's `CasConfig` priority (`rpcUrl > gateway`)". Decision 6 of this ADR passes the gateway as `gateways: [url]`. Decision 1 of this ADR replaces `gateway` with `gateways` in the priority.
- ADR 110: "Content that does not match, content that is not JSON, and content that is not a JSON object raise a `ResolveError` of type `MISSING_UPDATE_DATA`". Decision 2 of this ADR first reads from the next gateway of a list for bytes that do not match. Decision 3 of this ADR rejects only if no gateway gives bytes with the requested hash.
- ADR 124, the "Unchanged" block: "The CAS gateway chain of the vector pipeline (`PUBLIC_CAS_GATEWAYS` in `packages/api/lib/_e2e-helpers.ts`), which runs in Node." `_e2e-helpers.ts` keeps only the list. Decision 7 of this ADR passes the list to `CasApi`.
- ADR 129, "Context": "`rpcUrl` wins over `gateway`". Decision 1 of this ADR replaces `gateway` with the list `gateways`.
- ADR 164, "Context": "The three built-in executors catch each error of a read and also return `null`." Decision 4 of this ADR makes them reject with the reason of the signal after an abort.
- ADR 164, decision 3: each failure of the executor read "gives a `ResolveError` of type `MISSING_UPDATE_DATA`", with `{ hash, cause }` as the `data`. ADR 164 also says that "`data.cause` holds the original error." With a list of gateways, decision 2 of this ADR reads from the next gateway after a timeout. Decision 3 of this ADR rejects only if no gateway gives bytes with the requested hash, and puts each cause in `data.gateways`.
- ADR 164, the "Unchanged" block: "`CasApi.retrieve` refuses content that does not hash to the address". Decision 2 of this ADR first reads from the next gateway of a list.
- ADR 164, the first residual: "The timeout of `CasApi` does not stop the read of the executor." A custom executor that does not use the signal keeps this residual (see the residuals above). Decision 4 of this ADR removes the residual for the built-in executors.

**Unchanged.**

- ADR 023: the `CasExecutor` interface. `retrieve` returns `Uint8Array | null`. Decision 4 of this ADR adds an optional signal to `retrieve` and `publish`.
- ADR 069, decision 1: `BlockstoreLike` gets and puts raw blocks by CID, and a Helia instance fits `BlockstoreProviderLike`. Decision 4 of this ADR adds an optional `{ signal }` to `get` and `put`.
- ADR 071, decision 1: `HttpGatewayCasExecutor` sets `canPublish` to `false`. Decision 2 of this ADR adds that a list of gateways is not writable.
- ADR 076, decision 4: `cas.timeoutMs` keeps its default of 30000. If the value is `0`, no timeout applies. Decision 4 of this ADR adds the abort at the timeout and the timeout of each gateway.
- ADR 124: `DEFAULT_CAS_GATEWAY` stays `https://trustless-gateway.link`. Decision 1 of this ADR adds the default list of one gateway.
- ADR 125: `CasApi.probe` calls `CasExecutor.probe` with an abort signal at the CAS timeout. Decision 5 of this ADR adds the check of each gateway of a list.
- ADR 136, "Consequences": "If a text changes, the cause check fails, and the pattern in `FAILURE_RULES` must change with the text." Decision 7 of this ADR adds the message of a CAS read that fails to the pattern of `update-missing`.
- ADR 164, decision 3: the genesis document path changes `MISSING_UPDATE_DATA` to `NOT_FOUND`, and `CasApi.publish` keeps the plain timeout `Error`. Decision 3 of this ADR adds the message of a list of gateways.

## Implementation

- `packages/api/src/cas.ts`: `CasConfig.gateways`; the list of sources in `CasApi` (`CasSource`); `retrieve` reads from each source in order (`CasMiss`); the functions `readError` and `failureText`; `probe` checks each source; `#withTimeout` takes a function of the signal and aborts the signal at the timeout; the signal parameters of `CasExecutor`, `BlockstoreLike`, and the three built-in executors; the function `failedRead`; JSDoc.
- `packages/api/src/api.ts`: the default config `{ gateways: [DEFAULT_CAS_GATEWAY] }`.
- `packages/cli/src/config.ts`: `resolveConnectionConfig`, `resolveEffectiveConfig`, and `runDoctor` use `gateways`.
- `packages/api/lib/_e2e-helpers.ts`: the removal of `GatewayChainCasExecutor` and `valueOrNull`. `packages/api/lib/verify-live.ts`, `test-api.ts`, and `e2e-full-lifecycle.ts`: `cas.gateways`. `packages/api/lib/_scenario-helpers.ts`: the pattern of `update-missing`.
- Docs: `packages/api/README.md`, `packages/api/docs/DEMO.md`, `packages/api/docs/test-vectors.md`.
- Tests:
  - api: `cas-api.spec.ts` (the signal of each built-in executor; the rejection after an abort; `null` for a failure with a signal that is not aborted; each result of decision 2 and decision 3, with the `data.gateways` entries; the empty list; `publish` and `probe` of a list; the probe timeout message; the abort at the timeout; no signal with `timeoutMs` 0; a local HTTP server that sees the abort of the request at the timeout).
  - cli: `config.spec.ts` (the cli config passes `gateways: [url]` to the api); `config-commands.spec.ts` (`btcr2 config doctor` names the gateway).

## References

- did:btcr2 specification: [BTCR2 Update Data Distribution](https://dcdpr.github.io/did-btcr2/update-data-distribution.html) ("Content Addressable Storage (CAS)", "IPFS"), [Resolve](https://dcdpr.github.io/did-btcr2/operations/resolve.html).
- ADRs 023, 069, 071, 072, 076, 110, 124, 125, 129, 136, 156, 164.

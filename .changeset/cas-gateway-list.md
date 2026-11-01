---
'@did-btcr2/api': minor
'@did-btcr2/cli': patch
---

The api aborts a CAS operation at the timeout and reads from an ordered list of gateways (ADR 170).

- api: Breaking: this change removes `CasConfig.gateway`, with no alias. `CasConfig.gateways` takes an ordered list of the URLs of IPFS HTTP gateways, for example `cas: { gateways: ['https://trustless-gateway.link'] }`. The `CasApi` constructor throws for a config with an empty list and no other backend, with the error of a config with no backend. The default config is `{ gateways: [DEFAULT_CAS_GATEWAY] }`.
- api: `CasApi.retrieve` reads from each gateway in the order of the list. It reads from the next gateway if a gateway has no content, does not answer in time, or gives bytes with a different hash. `HttpGatewayCasExecutor` returns `null` if the gateway answers with an error status, or if the request fails before the timeout (ADR 164). If each gateway has no content, `retrieve` returns `null`.
- api: `retrieve` rejects with a `ResolveError` of type `MISSING_UPDATE_DATA` if no gateway gives the content and one or more reads fail. A read fails if the gateway does not answer in time or gives bytes with a different hash. The message is `CAS content for <hash> cannot be retrieved from the gateways: <url>: <result>; ...`. The `data` is `{ hash, gateways: [{ gateway, cause?, actual? }] }`. With one source, the message and the `data` do not change.
- api: at the CAS timeout, `CasApi` aborts the operation. Before, the read of the executor stayed open after the timeout. The timeout applies to the read of each gateway. `CasExecutor.retrieve` and `CasExecutor.publish` take an optional `AbortSignal`, and `BlockstoreLike.get` and `BlockstoreLike.put` take an optional `{ signal }`. The built-in executors pass the signal to `fetch` or to the blockstore. After an abort, they reject with the reason of the signal and do not return `null`.
- api: `CasApi.probe` uses the same timeout. A probe that times out rejects with `CAS operation timed out after <n>ms`. With a list of gateways, `probe` checks each gateway at the same time. It rejects with `One or more CAS gateways do not answer: ...` and names each gateway that does not answer.
- cli: the cli passes its one CAS gateway (`--cas-gateway`, `BTCR2_CAS_GATEWAY`, or the `cas.gateway` key) to the api as a list of one. At the CAS timeout, the api aborts the gateway request, so the cli process ends at the timeout. Before, a gateway that did not answer kept the process open until the gateway closed the request. Dependency uptake through api.

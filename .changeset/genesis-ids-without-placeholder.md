---
'@did-btcr2/method': patch
'@did-btcr2/api': patch
'@did-btcr2/cli': patch
---

The create path accepts a verification method id or a service id without the placeholder (ADR 167).

- method: `validateGenesis('producer')` and `GenesisDocument.create` no longer require the placeholder `did:btcr2:_` in each verification method `id` and each service `id`. The DID Core rules of a producer stay. Before, they refused such an `id` with `Invalid GenesisDocument <member>: <member>[<index>].id must contain "did:btcr2:_"`.
- api: `btcr2.createExternalFromDocument` accepts a genesis document with an id without the placeholder, for example `#key-0`. `btcr2.buildGenesisDocument` keeps a service `id` that is not a fragment as given, for example `https://a.example/services#1`. The rules of a producer then check the syntax of that `id`. The browser bundle holds the method package.
- cli: the `create` and `genesis` docs; dependency uptake through api.

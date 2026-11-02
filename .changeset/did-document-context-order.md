---
'@did-btcr2/method': minor
'@did-btcr2/api': minor
'@did-btcr2/cli': patch
'@did-btcr2/aggregation': patch
---

The DID document context has the DID v1.1 context as its first item on each path (ADR 171).

- method: Breaking: `DidDocument.isValid` and `GenesisDocument.validateGenesis` refuse a `@context` whose first item is not `https://www.w3.org/ns/did/v1.1` (DID Core v1.1, section 6.2.3). Before, the check accepted the two required contexts in any order. The rule applies to a producer and to a consumer. So the resolver, `Updater.construct`, `GenesisDocument.fromJSON`, `Identifier.validate`, and the `DidDocument` constructor refuse such a document.
- method: Breaking: each item of `@context` must be a string or a JSON object. Before, the check accepted an item of any kind, for example `null` or `5`. The btcr2 context can still be at any position, and the array can hold other contexts.
- method: the message names the rule: `Invalid "@context": <rule>`, or `Invalid GenesisDocument "@context": <rule>` for a genesis document. An example is `Invalid "@context": @context[0] must be "https://www.w3.org/ns/did/v1.1"`. The error type stays `INVALID_DID_DOCUMENT`. The old message is the start of the new message.
- method: the resolver refuses an update whose patch moves the DID v1.1 context from the first position, with `INVALID_DID_UPDATE`. It also refuses a patch that adds an item of a wrong kind. `Updater.construct` refuses the two patches with `INVALID_DID_UPDATE`.
- method: `resolveBtcr2SenderPk` returns `undefined` for an `x1` sender whose genesis document has another first `@context` item.
- api: Breaking: `createExternalFromDocument` leaves the `@context` check to the method. For a bad `@context`, the message is the method message, for example `Invalid GenesisDocument "@context": @context must be an array`. The error `data` is the document. Before, the message was `The genesis document "@context" must include "https://www.w3.org/ns/did/v1.1" and "https://btcr2.dev/context/v1".`, and the `data` was `{ context }`.
- api: each resolution function and each update function applies the new rules through the method, for example `btcr2.resolve`, `resolveDid`, and `btcr2.update`.
- cli: `create -t x --document` refuses a `@context` with another first item. `identifier decode --genesis-document`, `resolve`, `update`, `deactivate`, `message sign`, and `message verify` fail on such a `@context`. `identifier validate --genesis-document` reports it as a failed `genesisDocument` check. The message names the rule. Dependency uptake through api.
- aggregation: the JSDoc of `AggregationParticipantParams.genesisDocument` and `AggregationParticipantRunnerOptions.genesisDocument` states the `@context` rules of ADR 171.

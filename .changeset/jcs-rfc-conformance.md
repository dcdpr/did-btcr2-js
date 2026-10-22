---
'@did-btcr2/common': major
'@did-btcr2/method': minor
'@did-btcr2/api': minor
'@did-btcr2/cryptosuite': patch
'@did-btcr2/aggregation': patch
'@did-btcr2/cli': patch
---

The JCS serializer sorts every object and refuses NaN, Infinity, and a lone surrogate (ADR 154).

- common: Breaking: `canonicalize`, `canonicalHash`, and `canonicalHashBytes` throw a `CanonicalizationError` for a value with no JCS form (RFC 8785). The type is `NON_FINITE_NUMBER` for NaN, Infinity, or -Infinity, also for a Number object and for the number of the JSON text `1e400`. The type is `LONE_SURROGATE` for a string or a member name with a lone surrogate. The type is `NOT_JSON_DATA` for a BigInt, a cycle, or a top-level value with no JSON form. `data.path` gives the location of the value as a JSON Pointer. Before, NaN and Infinity became `null`, a lone surrogate became its escape text, and a BigInt or a cycle gave a `TypeError`.
- common: Breaking: `canonicalize` sorts an object that has a data member named `toJSON`, at each depth. Before, such an object and each object in it kept the order of their members, so the hash depended on that order. A `toJSON` method has the same effect as before: `JSON.stringify` calls it first.
- common: the package no longer depends on `json-canonicalize`. An own serializer writes the JSON form with the rules of RFC 8785 section 3.2.
- common: `MethodErrorCode` gets the member `PROOF_TRANSFORMATION_ERROR` and its named export.
- method: Breaking: `Resolver.external` refuses a genesis document with no JCS form with a `ResolveError` of type `INVALID_DID_DOCUMENT`. `Resolver.provide` refuses a signed update with no JCS form with `INVALID_SIGNAL_DATA`, and a CAS Announcement with no JCS form with `MISSING_UPDATE_DATA`. `data.cause` gives the type and the message of the `CanonicalizationError`.
- method: `Resolver.sidecarData` leaves an update or a CAS Announcement with no JCS form out of its maps. If a beacon signal needs the item, the resolver asks for it with a data need. Before, the map keyed such an item by the hash of its escape text or of its `null` form.
- method: Breaking: `Updater.construct` and `Updater.sign` refuse a source document or a patch with no JCS form with an `UpdateError` of type `INVALID_DID_UPDATE`. Before, `construct` returned an update whose `targetHash` used the `null` form of a NaN patch value. `GenesisDocument.toGenesisBytes` throws a `DidDocumentError` of type `INVALID_DID_DOCUMENT` for a document with no JCS form.
- method: `Identifier.validate` reports a failed `genesisDocument` check for a genesis document with no JCS form and does not throw. The set check of the DID Core rules compares no map item with no JCS form, because the hash step refuses the document.
- cryptosuite: `transformDocument` throws a `CryptosuiteError` of type `PROOF_TRANSFORMATION_ERROR` for a document with no JCS form. `proofConfiguration` throws `PROOF_GENERATION_ERROR` for proof options with no JCS form. Thus `createProof` and `verifyProof` throw for such data, and `verifyProof` gives no `verified: false` result. Before, the suite signed and verified the `null` form or the escape text.
- aggregation: `AggregationParticipant.submitUpdate` refuses an update with no JCS form with an `AggregationParticipantError` of type `UPDATE_MALFORMED`. `verifyEnvelope` refuses an envelope with no JCS form with an `HttpTransportError` of type `ENVELOPE_MALFORMED`. The CAS strategy derives no signal from a CAS Announcement with no JCS form, so the member does not approve it.
- api: the api exports `CanonicalizationError` and `CryptosuiteError`. `hashDocument`, `CasApi.publish`, `getInitialDocument`, `createExternalFromDocument`, `constructUpdate`, the resolve functions, and the crypto sub-facade refuse a value with no JCS form through the lower packages.
- cli: the merge of sidecar data keeps one copy of each entry with no JCS form, by its JSON text, and does not throw. `create -t x --document`, `identifier decode`, `identifier validate`, and `resolve` refuse a genesis document with no JCS form.

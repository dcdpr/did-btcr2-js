---
'@did-btcr2/method': minor
'@did-btcr2/api': minor
'@did-btcr2/cli': patch
---

The resolver checks the JSON type of four sidecar members, and the data of a CAS read that fails is not available (ADR 164).

- method: Breaking: `DidBtcr2.resolve` and `Resolver.sidecarData` refuse a sidecar member of the wrong JSON type with a `ResolveError` of type `INVALID_OPTIONS`. `updates`, `casUpdates`, and `smtProofs` must be arrays, and `@context` must be a string. A value of another JSON type, also `null`, fails. The check does not read `genesisDocument`, an item of an array, or a member with another name.
- api: Breaking: `CasApi.retrieve` gives a `ResolveError` of type `MISSING_UPDATE_DATA` for a read that times out and for an executor that throws or rejects. The message is `CAS content for <hash> cannot be retrieved: <cause>`. For an object cause that is not an `Error`, the message ends at `retrieved.` The `data.cause` member holds the original error. Thus `tryResolveDid` gives `NOT_FOUND` for the genesis document and `MISSING_UPDATE_DATA` for other data, not `INTERNAL_ERROR`.
- api: Breaking: `CasApi.retrieve` refuses bytes that are not UTF-8 as content that is not JSON (`MISSING_UPDATE_DATA`). The browser bundle holds the method package.
- cli: for an identifier with a record, `-r` and `-p` values of the wrong type go to the api as they are. The api refuses them with `INVALID_OPTIONS`. Before, some of these values threw a `TypeError` or resolved. `--min-conf` and `--genesis-document` do not change options or a `sidecar` that are not an object. A `genesisDocument` of `null` in the flags wins over the genesis document of the record. `identifier add --sidecar` keeps an entry that is not an object, by its JSON text.
- cli: the `resolve`, `config-file`, and `DEMO` docs; dependency uptake.

---
'@did-btcr2/common': minor
'@did-btcr2/method': minor
'@did-btcr2/api': minor
'@did-btcr2/cli': patch
---

A failed resolution gives the error object of DID Resolution v1. The resolver refuses a resolution option that it does not support (ADR 157).

- common: `MethodErrorCode.FEATURE_NOT_SUPPORTED` and its named export `FEATURE_NOT_SUPPORTED` are new.
- method: Breaking: `DidBtcr2.resolve` checks the resolution options in the order of DID Resolution v1, section 4.4, before it returns the `Resolver`. An option name other than `accept`, `expandRelativeUrls`, `noCache`, `versionId`, `versionTime`, `minConf`, `sidecar`, and `maxDiscoveryRounds` gives a `ResolveError` of type `FEATURE_NOT_SUPPORTED`. `expandRelativeUrls: true` also gives `FEATURE_NOT_SUPPORTED`. A wrong value of `accept`, `expandRelativeUrls`, `noCache`, `sidecar`, or `maxDiscoveryRounds` gives `INVALID_OPTIONS`. Options that are not an object, for example `null`, also give `INVALID_OPTIONS`. Before, the resolver ignored each such option, and `null` gave a raw `TypeError`.
- method: Breaking: `ResolutionOptions` no longer extends `DidResolutionOptions` of `@web5/dids`. It declares `accept`, `expandRelativeUrls`, and `noCache`. A TypeScript caller that gives another option name gets a compile error.
- method: Breaking: `Identifier.decode` checks the DID syntax of DID Core v1.1 first. A valid DID of another method gives `METHOD_NOT_SUPPORTED`, for example `did:example:a:b` (before: `INVALID_DID`). An identifier that is not a DID gives `INVALID_DID`, for example `did:BTCR2:k1...` (before: `METHOD_NOT_SUPPORTED`). A value that is not a string gives `INVALID_DID`.
- api: Breaking: `raw.didResolutionMetadata.error` of `tryResolveDid` is the error object `{ type, title, detail }` of DID Resolution v1, section 10. `type` is the URL of the error type: `https://www.w3.org/ns/did#<CODE>` for the 9 types of DID Resolution v1, and the anchor of the type on `https://dcdpr.github.io/did-btcr2/errors.html` for the 4 types of did:btcr2. `raw.didResolutionMetadata.errorMessage` is removed. The top-level `error` and `errorMessage` do not change.
- api: Breaking: `DidResolutionResult` is a type of the api, with `didDocument: Btcr2DidDocument | null`. The api no longer exports the `DidResolutionResult` of `@web5/dids`. The type `ResolutionError` is new.
- api: `tryResolveDid` with a DID that is not a string, or with the empty string, gives `INVALID_DID`. Before, a DID that is not a string made `tryResolveDid` throw.
- cli: `resolve`, `update`, and `deactivate` refuse a field of the `-r` or `-p` resolution options that the resolver does not support. `resolve` of a valid DID of another method prints `Invalid did method: ...`.

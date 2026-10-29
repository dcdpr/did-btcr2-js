---
'@did-btcr2/method': minor
'@did-btcr2/api': minor
'@did-btcr2/cli': patch
---

Each input fault of identifier encoding and decoding gives `INVALID_DID`, and the api leaves the identifier input checks to the method (ADR 163).

- method: Breaking: `Identifier.encode` refuses an `idType` other than `KEY` or `EXTERNAL`, also a name that an object inherits, for example `toString`. It refuses `genesisBytes` that are not a `Uint8Array`, for example a hex string or a plain array of numbers. It refuses `undefined` and `null` options. Each refusal is an `IdentifierError` of type `INVALID_DID`. The message for a wrong length holds the length, for example `got 32 bytes`.
- method: Breaking: `DidBtcr2.create` takes `options` as a required parameter and delegates to `Identifier.encode`. A call with no `idType` gives an `IdentifierError` of type `INVALID_DID`, not a `MethodError` of type `INVALID_DID_DOCUMENT`.
- method: Breaking: the type of `IdentifierComponents.network`, `DidComponents.network`, and `IdentifierReport.network` is `keyof typeof BitcoinNetworkNames`, not `string`.
- method: if `Identifier.decode` refuses the genesis bytes, the message holds no bytes.
- api: Breaking: `did.encode`, `did.decode`, `btcr2.createDeterministic`, `btcr2.createExternal`, `createDid`, and `btcr2.getInitialDocument` give the `IdentifierError` of the method, not a plain `Error`. `did.validate` returns a report for a value that is not a string. `did.decode` and `did.validate` declare `network` as a name of `BitcoinNetworkNames`. `updateDid('')` and `deactivateDid('')` reject with `Failed to resolve DID` and a cause of type `INVALID_DID`. The browser bundle holds the method package.
- cli: dependency uptake.

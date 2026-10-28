---
'@did-btcr2/method': minor
'@did-btcr2/api': minor
'@did-btcr2/cli': patch
---

A beacon `serviceEndpoint` is a BIP321 URI, and the read path and the write path use one parse (ADR 161).

- method: Breaking: `BeaconUtils.parseBitcoinAddress` matches the scheme `bitcoin:` in any case. The address part is the text before the first `?`. It must be a base58 P2PKH or P2SH address, a bech32 segwit version 0 address, or a bech32m segwit address of version 1 to 16. A query key that starts with `req-`, in any case, makes the URI invalid. The parse returns a bech32 or bech32m address in lower case. A base58 address keeps its case. Each refusal is a `MethodError` of type `BEACON_SERVICE_ERROR`.
- method: Breaking: `BeaconUtils.isBeaconService` is `true` only if the parse of the `serviceEndpoint` gives a Bitcoin address. Thus the resolver finds no signals for a beacon whose `serviceEndpoint` gives no Bitcoin address, and the resolution continues.
- method: Breaking: `NeedFunding.beaconAddress` and the beacon transaction use the address part of the URI, not the `serviceEndpoint` with the scheme removed.
- method: Breaking: `DidBtcr2.update` refuses a `beaconId` that names a service that is not a beacon, or a beacon whose `serviceEndpoint` gives no Bitcoin address. The refusal is an `UpdateError` of type `INVALID_DID_UPDATE`.
- method: Breaking: the change removes `BeaconUtils.parseBeaconServiceEndpoint`.
- api: Breaking: `update` refuses such a `beaconId` before any I/O and before any CAS publication. `getBeacons` gives a beacon with a `BITCOIN:` scheme, and omits a beacon whose `serviceEndpoint` gives no Bitcoin address. `buildGenesisDocument` takes a beacon `address` as a Bitcoin address or a BIP321 URI, and writes a bech32 address in lower case. A builder refusal is a `DidDocumentError` of type `INVALID_DID_DOCUMENT`. The browser bundle holds the method package.
- cli: the `update` and `genesis` docs; dependency uptake.

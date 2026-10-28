# ADR 161: A Beacon Endpoint Is a BIP321 URI: the Scheme Matches in Any Case, the Address Must Decode, and the Read and Write Paths Use One Parse

- **Status:** Accepted
- **Date:** 2026-10-28
- **Packages:** `@did-btcr2/method` (MINOR: `BeaconUtils.parseBitcoinAddress` reads a BIP321 URI and decodes its address part; `BeaconUtils.isBeaconService` needs a Bitcoin address; the Fund need and the beacon transaction use the parse; `DidBtcr2.update` refuses a `beaconId` of a service that gives no Beacon Address; the change removes `BeaconUtils.parseBeaconServiceEndpoint`); `@did-btcr2/api` (MINOR: `update` refuses such a `beaconId` before any I/O; `getBeacons` and `buildGenesisDocument` give other results; the browser bundle holds the method package); `@did-btcr2/cli` (PATCH: the `update` and `genesis` docs and a JSDoc; dependency uptake through api)

## Context

### The read path and the write path read an endpoint in two ways

`BeaconUtils.parseBitcoinAddress` needed the prefix `bitcoin:` in lower case. It returned the text before the first `?` and did not check that text. `BeaconUtils.isBeaconService` refused an endpoint without the lower-case prefix. The resolver, the signal discovery, and `getBeacons` of the api use these two functions.

The write path did not use them. The Fund need of the `Updater` and the beacon transaction removed the first `bitcoin:` from the endpoint and kept the rest. Thus one endpoint gave two addresses:

| `serviceEndpoint` of a `SingletonBeacon` | Before: resolve | Before: api `update` with this `beaconId` | After |
|---|---|---|---|
| `bitcoin:<addr>` | signals at `<addr>` | UTXOs of `<addr>` | no change |
| `BITCOIN:<addr>` | not a beacon: no signals, no error | UTXOs of `BITCOIN:<addr>`, then "unfunded" | `<addr>` on both paths |
| `bitcoin:<addr>?label=beacon` | signals at `<addr>` | plain `Error`: `Invalid address: contains illegal characters` | `<addr>` on both paths |
| `bitcoin:<ADDR>` (a bech32 address in upper case) | no signals, no error | `SIGNER_KEY_MISMATCH` | `<addr>` in lower case on both paths |
| `bitcoin:<addr>?req-pop=x` | signals at `<addr>` | plain `Error`, as above | no Beacon Address |
| `bitcoin:?lightning=lnbc1` | plain `Error`: `Invalid address: contains illegal characters` | plain `Error` | no Beacon Address |
| `bitcoin:abc`, a bad checksum, a bech32 address in mixed case | a request for the text, which Esplora refuses with HTTP 400 | not tested | no Beacon Address |

A beacon with no Beacon Address has no signals, and the resolution continues. The write path refuses its `beaconId` (decision 5).

### A service that is not a beacon passed the factory

`DidBtcr2.update` found the service of `beaconId` by its `id` only. Thus a `beaconId` of a `LinkedDomains` service passed. With a `bitcoin:` endpoint at a funded address and `publishToCas: 'always'`, the api published the signed update to the CAS. Then `BeaconFactory.establish` threw a `MethodError` of type `INVALID_BEACON_ERROR`. A CAS publication is permanent (ADR 150).

### The specification reads a Beacon Address from each beacon

"Find Beacon Signals" says: "Scan the `service` entries in `current_document` ([DID Document (data structure)]) and identify [BTCR2 Beacons][BTCR2 Beacon] by matching service `type` to [Beacons Table 1: Beacon Types]. Parse each beacon `serviceEndpoint` as a [Beacon Address]." A signal of a beacon must meet this condition: "The transaction spends from the [Beacon Address]."

Beacons says: "Resolution of a DID MUST process signals from all [BTCR2 Beacons][BTCR2 Beacon] identified in the [Current DID Document]". The Beacon Address is "The Bitcoin address of a [BTCR2 Beacon]." The DID Document section says: "A resolver parses only one URL in a DID document. That URL is the `serviceEndpoint` of a [BTCR2 Beacon] service, and the resolver parses it as a [Beacon Address]." A footnote of the section says: "A [Beacon Address] is a Bitcoin address and has no host."

The specification cites BIP321 only in "Establish `current_document`", for the template of a `k` DID: "Bitcoin addresses MUST use the Bitcoin URI Scheme". The section "Announcing to a Singleton Beacon" of Update says: "The [Beacon Signal] is signed by the private key that controls the [Beacon Address] and broadcast to the Bitcoin network." The specification names no error for an endpoint that gives no Beacon Address.

### BIP321 and BIP173

BIP321 defines the URI as `bitcoinurn = "bitcoin:" [ bitcoinaddress ] [ "?" bitcoinparams ]`. It also says:

- "The scheme component ("bitcoin:") is case-insensitive, and implementations must accept any combination of uppercase and lowercase letters."
- "The bitcoinaddress body MUST be either a base58 P2SH or P2PKH address, bech32 Segwit version 0 address, bech32m Segwit address, or empty."
- "If a client does not implement handling a query parameter which has a key prefixed with req-, it MUST consider the entire URI invalid."

BIP173 says: "Encoders MUST always output an all lowercase Bech32 string." It also says: "Decoders MUST NOT accept strings where some characters are uppercase and some are lowercase (such strings are referred to as mixed case strings)." BIP350 sets one checksum format for each witness version: bech32 for version 0, and bech32m for version 1 to 16.

### ADR 086 accepted a case residual

ADR 086 has the section "Accepted residual: beacon addresses are compared as case-sensitive strings". The resolver compared the beacon address with the lower-case address of the spent output, so a bech32 address in upper case gave no signals. The section accepted the defect on this premise: "every in-repo endpoint generator emits the lowercase form". The genesis builder of ADR 108 made the premise false: `buildGenesisDocument` wrote a supplied address as given, also in upper case.

The section gives a fix direction: lower-case a bech32 or bech32m address in `parseBitcoinAddress`, and keep the case of a base58 address. Its rejected alternative, a comparison of the script of the spent output, is "Strictly stronger". ADR 086 says: "It remains the preferred long-term shape."

## Decision

### 1. `parseBitcoinAddress` reads a BIP321 URI

`BeaconUtils.parseBitcoinAddress(uri)` does these steps:

1. The scheme `bitcoin:` matches in any case.
2. The address part is the text between the scheme and the first `?`.
3. The address part must be one of the forms of BIP321, with the structure of BIP173 and BIP350 (decision 2).
4. A query key that starts with `req-`, in any case, makes the URI invalid. The parse ignores each other query key.

The parse refuses an empty address part, also if the query has a payment instruction. A beacon needs a Bitcoin address. A refusal is a `MethodError` of type `BEACON_SERVICE_ERROR` with the data `{ uri }`. The messages are:

- `Invalid Bitcoin URI: the scheme is not bitcoin:`
- `Invalid Bitcoin URI: the address part is not a Bitcoin address`
- `Invalid Bitcoin URI: a query key starts with req-`

### 2. The address part must decode as an address of BIP321

The parse accepts these forms, and no other text:

- A base58check text with a payload of 21 bytes. The first byte is `0x00` or `0x05` (P2PKH or P2SH of mainnet), or `0x6f` or `0xc4` (of the test networks).
- A bech32 text of 90 characters or fewer, with witness version 0 and a program of 20 or 32 bytes.
- A bech32m text of 90 characters or fewer, with witness version 1 to 16 and a program of 2 to 40 bytes.

The parse does not check the network. A checksum alone is not enough: a WIF secret key and an extended public key also have a valid base58check checksum.

### 3. A bech32 address becomes lower case

The parse returns a bech32 or bech32m address in lower case. A base58 address keeps its case: base58check is case-sensitive. The decoder refuses a bech32 text in mixed case, so only a text in upper case changes. This is the fix direction of ADR 086.

The decode rule makes the address comparison equal to a script comparison. Esplora and Bitcoin Core give the address of a spent output in one form. A bech32 address is in lower case, and a base58 address is the base58check text of the payload. The parse gives the same form for each address that decodes. Thus an address comparison and a script comparison give the same result for each address of the network of the DID. The signal discovery needs no network argument, and the fullnode map keeps its keys.

### 4. `isBeaconService` needs a Beacon Address

`BeaconUtils.isBeaconService` returns `true` only if the type is in Beacons Table 1 and `parseBitcoinAddress` reads the `serviceEndpoint`. The function does not use `this`, because `getBeaconServices` passes it unbound to `filter`. Thus each caller of `getBeaconServices` can parse each result with no error.

A beacon whose endpoint gives no Beacon Address is still a beacon of the document, but it has no signals. No transaction spends from a text that is not a Bitcoin address, so the resolver loses no signal. The resolution continues.

The removed-address test of ADR 114 compares parsed addresses. Thus an update that changes only the case of the scheme or of a bech32 address does not remove the beacon address.

### 5. The write path uses the parse, and the factory refuses a service with no Beacon Address

The Fund need (`NeedFunding.beaconAddress`) and `SinglePartyBeacon.buildSignAndBroadcast` get the address from `parseBitcoinAddress`. The Singleton, CAS, and SMT beacons all use `buildSignAndBroadcast`.

`DidBtcr2.update` keeps the message `No beacon service found for provided beaconId` for an id that names no service. After the id match, it refuses a service that `isBeaconService` refuses. The refusal is an `UpdateError` of type `INVALID_DID_UPDATE`, with this message:

`The service <beaconId> is not a beacon service: its type is not in Beacons Table 1, or its serviceEndpoint gives no Bitcoin address.`

The check runs before Construct. Thus the api refuses such a `beaconId` before any I/O, and before any CAS publication. A `beaconId` that the api derives is always a beacon with a Beacon Address, because the api selects it from `getBeacons`, which uses `getBeaconServices`.

### 6. The genesis builder takes a BIP321 URI

`buildGenesisDocument` takes a beacon `address` as a Bitcoin address or as a BIP321 URI. If the input has no scheme, the builder adds `bitcoin:`. Then it uses `parseBitcoinAddress`. If the parse refuses the input, the builder refuses it with a `DidDocumentError` of type `INVALID_DID_DOCUMENT`. The message is `<label>.address "<input>" is not a Bitcoin address or a BIP321 URI of one: <parse message>`.

The check of the network and the script kind stays. The document gets `bitcoin:<address>`, with a bech32 address in lower case.

### 7. The change removes `BeaconUtils.parseBeaconServiceEndpoint`

No code called it. It removed the first `bitcoin:` and kept the query, so it gave a third address for one endpoint.

### 8. Each judgment call conforms to the specification texts

| Judgment call | Text | Result |
|---|---|---|
| The scheme matches in any case on both paths. | "Find Beacon Signals": "Parse each beacon `serviceEndpoint` as a [Beacon Address]." BIP321: "The scheme component ("bitcoin:") is case-insensitive, and implementations must accept any combination of uppercase and lowercase letters." | Conforms. |
| The write path uses only the address part. | Update: "The [Beacon Signal] is signed by the private key that controls the [Beacon Address] and broadcast to the Bitcoin network." | Conforms. |
| An address part that does not decode gives no Beacon Address, and the beacon has no signals. | Terminology: "The Bitcoin address of a [BTCR2 Beacon]." "Find Beacon Signals": "The transaction spends from the [Beacon Address]." BIP321: "The bitcoinaddress body MUST be either a base58 P2SH or P2PKH address, bech32 Segwit version 0 address, bech32m Segwit address, or empty." The specification names no error. | Conforms. The resolution processes zero signals of the beacon, so it meets Beacons: "Resolution of a DID MUST process signals from all [BTCR2 Beacons][BTCR2 Beacon] identified in the [Current DID Document]". |
| The parse checks the structure of the address, not only the checksum. | BIP321: "The bitcoinaddress body MUST be either a base58 P2SH or P2PKH address, bech32 Segwit version 0 address, bech32m Segwit address, or empty." | Conforms. |
| A `req-` query key makes the URI invalid. | BIP321: "If a client does not implement handling a query parameter which has a key prefixed with req-, it MUST consider the entire URI invalid." | Conforms. |
| A bech32 address becomes lower case, and a mixed-case text is not an address. | BIP173: "Encoders MUST always output an all lowercase Bech32 string." and "Decoders MUST NOT accept strings where some characters are uppercase and some are lowercase (such strings are referred to as mixed case strings)." | Conforms. |
| The factory refuses a `beaconId` of a service with no Beacon Address. | Update: "announcing that update via one or more [BTCR2 Beacons][BTCR2 Beacon] listed in the DID document". "Find Beacon Signals" identifies a beacon by its type and reads its Beacon Address. | Conforms. |
| The genesis builder takes a BIP321 URI and writes `bitcoin:` with a lower-case bech32 address. | "Establish `current_document`": "Bitcoin addresses MUST use the Bitcoin URI Scheme". BIP173: "Encoders MUST always output an all lowercase Bech32 string." The specification does not define the input of the api. | Conforms. |

## Alternatives

**A character rule for the address part, for example `/^[0-9A-Za-z]+$/`.** Rejected. It accepts `abc`, a bad checksum, a bech32 text in mixed case, and a base58 address in upper case. BIP321 and BIP173 refuse these texts. Such a text goes to the indexer, and Esplora refuses it with HTTP 400.

**A checksum check only.** Rejected. A WIF secret key and an extended public key pass a base58check checksum. BIP321 permits only P2PKH, P2SH, and segwit addresses.

**A beacon with no Beacon Address fails the resolution with `INVALID_DID_DOCUMENT`.** Rejected. One bad service then makes the DID unresolvable. The specification names no error for this case, and the beacon has no signal to lose.

**Ignore each query key, also a `req-` key.** Rejected. BIP321 says that the client "MUST consider the entire URI invalid". The parse uses the scheme rule of BIP321, so it also uses the `req-` rule of BIP321.

**Compare the script of the spent output, not its address (ADR 086).** Rejected. The signal discovery then needs the network, and the fullnode map needs scripts as keys. With the decode rule, the address comparison gives the same result for each address of the network (decision 3).

**Keep `parseBeaconServiceEndpoint`, and let it use the parse.** Rejected. No code calls it, and one parse needs one entry point.

**Keep the match of the factory by id only.** Rejected. A service that is not a beacon then fails after a permanent CAS publication.

## Consequences

- The method and api packages get a MINOR release. The cli gets a PATCH release.
- The resolver, the signal discovery, the Fund need, the beacon transaction, `getBeacons`, and the genesis builder use one parse. One endpoint gives one address.
- A document with `BITCOIN:<addr>` or with a bech32 address in upper case now gives the signals of the address. Before, it gave no signals and no error, so the result did not show the updates of the beacon.
- A beacon with `bitcoin:?lightning=...` gives no signals, and the resolution continues. Before, the api resolution threw a plain `Error`. `getBeacons` omits the beacon. Before, it gave `address: ""`.
- An endpoint with a `req-` query key now gives no signals. Before, the resolver read the signals of its address. No test vector and no producer in the repo writes a query. A resolver that ignores a `req-` key gives another result for such a DID.
- An api `update` with a `beaconId` of a service that is not a beacon now fails with an `UpdateError` of type `INVALID_DID_UPDATE` before any I/O. Before, it failed with `INVALID_BEACON_ERROR` after a possible CAS publication, or with a plain `Error` at the UTXO request.
- `buildGenesisDocument` refuses a bech32 address in mixed case and a URI with a `req-` key. Before, it wrote the address as given.
- Each `bitcoin:` endpoint of the test vectors decodes under the rule of decision 2, so no vector changes.
- The parse does not check the network. A beacon address of another network passes the parse, and the resolver finds no signals for it on the network of the DID. This result does not change.
- The api lib scripts keep their text operations on endpoints. They read only documents that the repo writes, with a lower-case scheme and no query, so their results do not change.
- The specification names no error for an endpoint that gives no Beacon Address. A later change of the specification can change decisions 4 and 5.

**Superseded.**

- ADR 086, the section "Accepted residual: beacon addresses are compared as case-sensitive strings". Decision 3 of this ADR applies its fix direction. The rejected alternative of ADR 086, the script comparison, stays rejected for the reason of decision 3.

**Unchanged.**

- ADR 086, decisions 1 and 2: the resolver recognizes a signal from the serialized script, and an indexer signal must spend from the beacon address. Decision 3 of this ADR adds one form for each address on both sides of the comparison.
- ADR 095: `getBeacons` filters through `getBeaconServices` and uses `parseBitcoinAddress`. Decisions 1 and 4 of this ADR replace the BIP-21 parse with the BIP321 parse.
- ADR 108: a supplied address must be a P2PKH, P2WPKH, or P2TR address of the network. Decision 6 of this ADR adds the BIP321 input and the lower-case bech32 output.
- ADR 114: the resolver ignores the signals of a removed beacon address, and the test compares parsed addresses. Decision 4 of this ADR adds that a change of case only is not a removal.
- ADR 148, decision 6: `No beacon service found for provided beaconId` stays the message for a document with no beacon service. Decision 5 of this ADR adds a second message.
- ADR 150: the api refuses an unknown `publishToCas` value. Decision 5 of this ADR also stops a CAS publication of an update for a service that is not a beacon.

## Implementation

- `packages/method/src/core/beacon/utils.ts`: `parseBitcoinAddress` (BIP321 parse, address decode with `@scure/base`, `req-` rule, lower case for bech32); `isBeaconService` uses the parse; the change removes `parseBeaconServiceEndpoint`.
- `packages/method/src/core/updater.ts`: the Fund need uses the parse.
- `packages/method/src/core/beacon/beacon.ts`: `buildSignAndBroadcast` uses the parse.
- `packages/method/src/did-btcr2.ts`: the factory refusal and its JSDoc.
- `packages/method/src/core/beacon/signal-discovery.ts`: a comment.
- `packages/api/src/genesis.ts`: `parseAddress` uses the parse and gives the builder error type; the JSDoc of `GenesisBeaconSpec.address`.
- `packages/api/src/method.ts`: the JSDoc of `BeaconInfo.address` and `getBeacons`.
- `packages/cli/src/genesis-spec.ts`: the JSDoc of `GenesisSpecBeacon`.
- Docs: `packages/method/README.md`, `packages/api/README.md`, `packages/cli/docs/update.md`, `packages/cli/docs/genesis.md`.
- Tests:
  - method: `beacon.spec.ts` (the parse and `isBeaconService` tables, the decode of a bech32 text in upper case), `signal-discovery.spec.ts`, `updater.spec.ts` (the Fund need and the factory), `beacon-broadcast.spec.ts`, `resolver.spec.ts`.
  - api: `did-method-api.spec.ts` (`getBeacons`, `update`), `genesis.spec.ts`.

## References

- did:btcr2 specification: [Resolve](https://dcdpr.github.io/did-btcr2/operations/resolve.html) ("Establish `current_document`", "Find Beacon Signals"), [Update](https://dcdpr.github.io/did-btcr2/operations/update.html) ("Announce DID Update"), [Beacons](https://dcdpr.github.io/did-btcr2/beacons.html), [Data Structures](https://dcdpr.github.io/did-btcr2/data-structures.html) (DID Document), [Terminology](https://dcdpr.github.io/did-btcr2/terminology.html) (Beacon Address).
- [BIP321: URI Scheme](https://github.com/bitcoin/bips/blob/master/bip-0321.mediawiki).
- [BIP173: Base32 address format for native v0-16 witness outputs](https://github.com/bitcoin/bips/blob/master/bip-0173.mediawiki).
- [BIP350: Bech32m format for v1+ witness addresses](https://github.com/bitcoin/bips/blob/master/bip-0350.mediawiki).
- ADRs 086, 095, 108, 114, 148, 150.

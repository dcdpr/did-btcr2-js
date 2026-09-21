# ADR 118: The Resolver Keys the Processed Beacon Signals by Beacon Address, Not by Service Id

- **Status:** Accepted
- **Date:** 2026-09-21
- **Packages:** `@did-btcr2/method` (PATCH), `@did-btcr2/bitcoin` (PATCH); dependency uptake in `@did-btcr2/aggregation`, `@did-btcr2/api`, and `@did-btcr2/cli`

## Context

The resolver scans each beacon address one time. "Find Beacon Signals" keeps the scanned addresses in `scanned_beacons`, keyed by beacon address. The specification has no per-service state.

The implementation kept a second set. BeaconProcess marked a beacon service as processed after its signals became update tuples, and skipped a marked service in the later discovery rounds. That set was keyed by the service id.

A beacon rotation is a BTCR2 Update that replaces the `serviceEndpoint` of a beacon service and keeps its id. Example: version 1 carries the service `#initialP2PKH` at the address `A`. A signal of `A` announces version 2, which moves `#initialP2PKH` to the address `A2`. A signal of `A2` announces version 3. The resolver processed `A` in the first round and marked the id `#initialP2PKH`. The second round scanned `A2`, but BeaconProcess skipped the service, because its id was marked. The signal of `A2` never became a tuple. The resolver returned version 2. A request for version 3 failed with `NOT_FOUND`.

The gap did not show in the test vectors. The rotation recipe of the vector corpus announces the rotation at another beacon, so the old address of the rotated service carries no signal, and the resolver never marks its id.

Two defects of the same review ride this change. `BitcoinRestClient.executeRequest` parsed the body as JSON before it checked the HTTP status. A 429 HTML page from a rate-limited Esplora host raised `SyntaxError` with no status and no URL, not the typed `FAILED_HTTP_REQUEST` of ADR 085. `Identifier.encode` accepted a numeric-string network. The numeric enum `BitcoinNetworkNames` also maps a value string to a name, so `'5'` read as the name `mutinynet`, the low nibble became 0, and the encoder minted a mainnet identifier.

## Decision

**The processed set is keyed by beacon address.** BeaconProcess computes the beacon address of a service before the skip test. It skips a service whose address is in the set, or whose signals list is empty. After the signals of a service became tuples, it adds the address to the set. The set holds addresses only. The service id plays no part.

**The REST client reads the status before it parses the body.** `executeRequest` reads the body as text first. A non-OK status raises `FAILED_HTTP_REQUEST` with the status, the URL, and the body: the JSON value if the body parses, else an excerpt of 200 characters. An OK status with a `text/plain` content type returns the text. An OK status with a body that is not JSON raises `INVALID_HTTP_RESPONSE` with the status, the URL, and an excerpt.

**The encoder accepts only a network name that maps to a number.** `Identifier.encode` rejects a network value whose enum lookup is not a number.

## Scope boundary

- Two beacon services at one address are processed one time. The specification scans an address one time, so both services see the same signals.
- The set of ADR 114 step 4 (the beacon addresses of the current document) does not change.
- The `minConf` rule of ADR 105 does not change: a service whose signals are all below the threshold is not processed and not marked.
- No test vector changes in this pull request. A rotation recipe that announces the rotation at the old address joins the next vector pass.
- The RPC transport already read the status first. It does not change.

## Consequences

**Positive.** A rotated beacon whose old address carried a signal resolves past the rotation. A rate-limited Esplora host produces a typed error with the status, so a caller can tell a rate limit from a broken response. A numeric-string network fails at the encoder, not at resolution time on the wrong chain.

**Negative.** None for a conformant document. A document with two services at one address processed each service one time before this change, with the same signals twice. It now processes the address one time.

**Unchanged.** The discovery rounds and the scanned-address set. The update tuple shape and the sort of ADR 111. The error data of `FAILED_HTTP_REQUEST` still carries the body under `data`.

## Implementation

- `packages/method/src/core/resolver.ts`: the private set `#processedAddresses`; the address computed at the top of the BeaconProcess loop.
- `packages/method/tests/resolver.spec.ts`: the helpers of the ADR 114 block moved to module scope with a `did` parameter; the describe block "the signals of a rotated beacon address (ADR 118)", three cases.
- `packages/bitcoin/src/client/rest/index.ts`: `executeRequest`; the helper `errorBody`.
- `packages/bitcoin/tests/rest-client.spec.ts`: a 429 HTML page; an OK body that is not JSON.
- `packages/method/src/core/identifier.ts`: the `typeof` guard on the enum lookup.
- `packages/method/tests/encode-identifier.spec.ts`: a numeric-string network.
- Versions: method 0.65.1 and bitcoin 0.11.1 (PATCH); aggregation 0.6.3, api 0.25.2, and cli 0.24.4 (PATCH, dependency uptake).

## References

- [ADR 085](085-typed-error-policy.md): the typed error policy.
- [ADR 105](105-resolution-processes-only-signals-at-min-conf.md): the `minConf` rule of BeaconProcess.
- [ADR 111](111-resolver-processes-one-update-per-pass-and-validates-the-resolution-options.md): the update tuples and the discovery rounds.
- [ADR 114](114-resolver-ignores-the-signals-of-a-removed-beacon-address.md): the signals of a removed beacon address.
- Specification, "Resolve": "Find Beacon Signals" (`scanned_beacons`).

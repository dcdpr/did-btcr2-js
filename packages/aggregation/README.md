# @did-btcr2/aggregation

Multi-party coordination for [did:btcr2](https://dcdpr.github.io/did-btcr2/) aggregate beacons (CAS and SMT). Extracted from `@did-btcr2/method` so an aggregation operator can depend on the protocol without the rest of the method runtime.

## What's here

- **State machines (sans-I/O, synchronous):** `AggregationService` (server side) and `AggregationParticipant` (client side) drive cohort formation, update collection, data aggregation, validation, and MuSig2 signing, emitting messages for the caller to dispatch.
- **`AggregationCohort`** holds cohort keys, builds the CAS Announcement map or the SMT tree, and tracks validation and non-inclusion responses.
- **`BeaconSigningSession`** runs the MuSig2 (BIP-327) key-path-only signing session for the cohort's Taproot output.
- **Transports (pluggable):** `NostrTransport`, the HTTP client and server adapters, an in-memory bus for testing, and a DIDComm stub. `TransportFactory.establish()` selects one from a discriminated-union config. The HTTP transport is DID-method-agnostic: pass a `resolveSenderPk` callback to authenticate senders from their DID.
- **Runner facades:** `AggregationServiceRunner` and `AggregationParticipantRunner` drive the state machines to completion with event-driven callbacks.

The fee estimator contract (`FeeEstimator`, `StaticFeeEstimator`) lives in `@did-btcr2/bitcoin`; this package consumes it.

See the [did-btcr2-js monorepo](https://github.com/dcdpr/did-btcr2-js) and the architecture decision records (ADRs 008, 020, 027, 038-046) for the design.

## License

MPL-2.0

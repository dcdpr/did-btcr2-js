# ADR 119: The api Takes a Separate Signer for the Beacon Transaction Input

- **Status:** Accepted
- **Date:** 2026-09-21
- **Packages:** `@did-btcr2/api` (MINOR); dependency uptake in `@did-btcr2/cli`

## Context

An update signs two things. The BTCR2 Update carries a Data Integrity proof, and the key of that proof is the key of the verification method that the update names. The beacon transaction spends a UTXO at the beacon address, and the key of that input is the key that the beacon address encodes. The method package keeps the two apart: `Updater.sign` takes the signer of the proof and checks it against the `publicKeyMultibase` of the verification method, and `beacon.broadcastSignal` takes the signer of the input and checks it against the beacon address (`SIGNER_KEY_MISMATCH`).

`DidMethodApi.update` took one `signer` and passed it to both. The three genesis beacons of a KEY identifier encode the DID key, so the one signer served both checks. Every other beacon failed: a beacon at a fresh key, a beacon at a key that a key manager holds under another id, or a beacon whose address a controller received from an operator. The api refused the update at the broadcast with `SIGNER_KEY_MISMATCH`, after the proof was signed. A caller had to drive the `Updater` directly to use such a beacon.

The design review of the aggregate beacon helpers (2026-08-03) found the conflation and ranked it as the first change to ship: the benefit that callers want, a beacon address that the DID does not reveal, does not depend on the beacon type.

## Decision

**The api takes an optional `beaconSigner`.** `DidMethodApi.update` and `DidMethodApi.deactivate` accept `beaconSigner?: Signer`. `DidBtcr2Api.updateDid` and `DidBtcr2Api.deactivateDid` pass it through. `UpdateBuilder.beaconSigner(s)` sets it on the builder. The value defaults to `signer`, so every existing call keeps its behavior.

**The signer of the proof does not change.** `signer` still signs the BTCR2 Update and still must match the verification method. `beaconSigner` signs the beacon transaction input only and must match the beacon address.

## Scope boundary

- The cli does not change. A `--beacon-key <id>` flag is a later cli MINOR.
- The funding check of `NeedFunding` does not change. Its false positive in the fee window is a separate item.
- No single-party CAS or SMT beacon creation helper. The design review deferred it until a multi-DID broadcast exists.
- The `Signer` interface does not change.

## Consequences

**Positive.** A beacon at any key the caller can sign for is usable through the api and the builder. A key manager can hold the DID key and the beacon key under separate ids.

**Negative.** One more optional parameter on four methods and one more setter on the builder.

**Unchanged.** The signing checks of the method package. The publication policy of ADR 073. The derivation of `beaconId` and `verificationMethodId` when the caller omits them.

## Implementation

- `packages/api/src/method.ts`: the `beaconSigner` parameter of `update` (default `signer`) and `deactivate`; the use site at `broadcastSignal`; the `UpdateBuilder` field, setter, and passthrough.
- `packages/api/src/api.ts`: the passthrough of `updateDid` and `deactivateDid`.
- `packages/api/README.md`: one bullet.
- `packages/api/tests/support/update-fixtures.ts`: the update fixtures, moved out of the CAS policy spec; `updateFixture` takes `separateBeaconKey`.
- `packages/api/tests/did-method-api-beacon-signer.spec.ts`: four cases.
- Versions: api 0.26.0 (MINOR); cli 0.24.5 (PATCH, dependency uptake).

## References

- [ADR 073](073-cas-publication-is-opt-in.md): the update path of the api.
- [ADR 094](094-deactivation-is-an-ordinary-update.md): `deactivate` as an update with a fixed patch.
- [ADR 102](102-funding-guard-applies-the-beacon-spendability-rule.md): the funding check of the write path.

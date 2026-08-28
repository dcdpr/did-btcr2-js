# ADR 104: The update path derives an omitted verification method and beacon

- **Status:** Accepted
- **Date:** 2026-09-03
- **Packages:** `@did-btcr2/api`

## Context

Every write on the api takes a `verificationMethodId` and a `beaconId`. The readme, the demo, and the end-to-end script spell both ids at every call site. They use `${did}#initialKey` and `${did}#initialP2WPKH`. A user must learn two naming conventions before the first update.

The call already holds the state that identifies both values. The Updater refuses a signer whose key differs from the `publicKeyMultibase` of the named method (ADR 091 fixed that check at the Updater). The signer's key therefore identifies the method. A derivation from the signer's key can only name the method that the check accepts. A single-party DID has one funded beacon in the ordinary case. The funding guard (ADR 102) reads that address in any case.

## Decision

**`DidMethodApi.update` derives an omitted `verificationMethodId` and an omitted `beaconId`.** `deactivate`, `updateDid`, and `deactivateDid` pass through `update` and inherit the derivation. `UpdateBuilder.execute` keeps its explicit requirements.

**The verification method is the one method that publishes the signer's key.** The derivation encodes the signer's public key as the Updater does. It then finds the methods on the source document whose `publicKeyMultibase` equals that key. One match is the id.

If there is no match, the api refuses the update. No method that the document lists can sign with that key, and the message says so before the Updater reports a key mismatch. If there are several matches, the api refuses the update and names the ids.

**The beacon is the only beacon, or the only funded beacon.** If the document has one beacon service, the api uses that beacon with no chain read. There is no choice to make. The funding guard reports the state of that beacon.

If the document has several beacon services, the derivation reads the UTXO list of each address. It keeps the beacons whose list holds a spendable UTXO under the beacon's own rule, `selectSpendableUtxo` (ADR 063, applied by ADR 102). One funded beacon is the id. If no beacon is funded, the api refuses the update and names every id and address, so that the caller can fund one. If several beacons are funded, the api refuses the update and names the funded ids. The api never decides which UTXO to spend.

**The derivation runs inside `update`, after its guards.** The deactivated guard (ADR 100), the connection guard, and the network guard (ADR 103) all refuse before any I/O. A derivation in the facade, before `update`, reads the chain first. On a shared-encoding test network with a mismatched connection, those reads return nothing. The derivation then refuses with "no beacon funded". That is the misleading outcome that ADR 103 prevents.

Inside `update`, a refused update reads nothing. One implementation serves every write path. The derivation reads through the per-call `bitcoin` override. The cli calls `update` directly, so it inherits the derivation and can drop its two flags with no api change.

**The api rejects a first-match pick.** A pick of the first method with the signer's key, or of the first funded beacon, is a silent choice. The proof names the method. The beacon that the api picks holds the UTXO that the update spends. Both refusals name the candidates, so that the caller makes the choice.

## Scope boundary

**The rules that validate the ids are unchanged.** `DidBtcr2.update` still checks the `capabilityInvocation` authorization of the method and finds the beacon service. A derived id passes through those checks like a supplied id.

**The single-beacon shortcut does not check funding.** With one beacon there is nothing to choose. The funding guard reports an unfunded single beacon with its own message.

**The derivation adds one read per beacon.** The funding guard reads the chosen address again. The api accepts one request per beacon.

**The builder stays explicit.** Its `execute` keeps all four required fields.

**Documentation is part of the branch-wide sync.** The readme, the demo, and the end-to-end script drop the two ids where the derivation covers them.

## Consequences

**Positive.** A first update needs the DID, the patches, and a signer. A user who funded one beacon of a fresh DID writes with no naming convention. The api refuses a wrong signer with the reason. The api refuses a funding gap with every address to fund.

**Negative.** A document with several funded beacons must name one. If a caller omits the id and signs with a wrong key, the caller now sees the message of the derivation, not the key-mismatch message of the Updater.

**Neutral.** A caller that supplies both ids sees no change. The parameters widen. No existing call breaks.

## Implementation

- `packages/api/src/method.ts`: `verificationMethodId` and `beaconId` are optional on `update` and `deactivate`. `update` fills them after the network guard through two private helpers, `#deriveVerificationMethodId(document, signer)` and `#deriveBeaconId(document, bitcoin)`. Both throw an `UpdateError` of type `INVALID_DID_UPDATE` with the candidates in `data`.
- `packages/api/src/api.ts`: the two parameters are optional on `updateDid` and `deactivateDid`. Both methods pass them through.
- Tests:
  - The derived method appears in the proof.
  - The api refuses a foreign signer with no chain read.
  - The api refuses a document with two methods for one key, with no chain read.
  - The network refusal precedes the derivation.
  - The api uses the only beacon with no chain read.
  - The api chooses the one spendable beacon among several.
  - The api refuses none funded and several funded, with the candidates in `data`.
  - The api refuses a document with no beacon service.

## References

- ADR 063 (beacon UTXO hardening): the spendability rule that the derivation applies.
- ADR 091 (relative DID URLs and DID injection into beacons): fixed the signer-versus-method check at the Updater.
- ADR 095 (the initial document and beacon addresses are derivable offline): `getBeacons`, which the derivation reads.
- ADR 096 (signers from the facade): the signer whose key the derivation reads.
- ADR 100 (the update path refuses a deactivated source): the first guard that the derivation runs after.
- ADR 102 (the funding guard applies the beacon's spendability rule): the same selector, one call earlier.
- ADR 103 (a DID and its Bitcoin connection must name the same network): the guard that decides where the derivation runs.
- `docs/api-crud-review-2026-09-01.md`: the second-round review that carried this as gap G12.

# ADR 169: The Aggregate Beacon Address Is n-of-n by Default, and Each Script Leaf Is Opt-In

- **Status:** Accepted
- **Date:** 2026-10-31
- **Packages:** `@did-btcr2/aggregation` (MINOR: each script leaf of the beacon address is opt-in; the public API of the cohort conditions, the participant, the service, the spend builders, and the solo runner changes)

## Context

In this ADR, a member is a participant that the service accepted in a cohort. n is the number of cohort keys. Leaf A is the k-of-n fallback leaf. Leaf B is the CSV recovery leaf.

### Each beacon address had two script leaves

Before this change, the beacon address of each aggregate cohort was a Taproot output with an internal key and a script tree. The internal key is the MuSig2 aggregate of the cohort keys. The script tree always had two leaves ([ADR 042](042-fault-tolerant-beacon-output.md), [ADR 043](043-k-of-n-fallback-protocol.md)):

- Leaf A: any k members together can spend the output at once. If the cohort conditions had no `fallbackThreshold`, `computeBeaconAddress` used k = max(1, n-1).
- Leaf B: the holder of `recoveryKey` can spend the output alone after `recoverySequence` blocks. `recoveryKey` and `recoverySequence` were required cohort conditions.

If the config did not name the recovery values, `AggregationRunner.solo` set `recoveryKey` to the x-only key of the service and `recoverySequence` to 144.

### A leaf lets a party publish a Beacon Signal without all members

Terminology, "Beacon Signal", says: "Beacon Signals are Bitcoin transactions that spend from a Beacon Address and include a transaction output of the format defined in Signal Bytes." The script of a leaf does not limit the outputs of a spend. Thus each spend through a leaf can be a Beacon Signal.

If a Beacon Signal has no announcement for a member DID, that DID fails to resolve. Security Considerations, "Invalidation Attacks", says: "if these updates cannot be retrieved by a resolver, the DID MUST be considered invalid."

### The specification recommends an n-of-n beacon address

Appendix, "No Privileged Role", says: "those participating in aggregation SHOULD use a protocol that ensures every Aggregation Participant in the Aggregation Cohort has explicitly signed the Beacon Signal itself. It is RECOMMENDED that Aggregate Beacons use a Beacon Address that requires an n-of-n Schnorr Signature where each Aggregation Participant explicitly signs in a provable manner."

Security Considerations, "Invalidation Attacks", says: "To prevent these attacks, all Beacon Signals SHOULD be authorized by signatures: either from the DID controller when using a Singleton Beacon or with a `n-of-n` multisignature from all `n` members of an Aggregation Cohort when using an Aggregate Beacon."

Security Considerations, "Aggregate Beacon Address Verification", says: "A Beacon Address of an Aggregate Beacon SHOULD be an `n-of-n` Pay-to-Taproot (P2TR) address, with a key contributed to the `n` by each of the participants in an Aggregation Cohort. DID controllers participating in an Aggregation Cohort SHOULD verify the Beacon Address is an `n-of-n` and that one of the `n` keys is the key that they provided to the Aggregation Service."

Appendix, "Worst Case", names the two failure cases:

1. "If the Beacon Signal does not require n-of-n signing, a hostile Aggregation Cohort (or Aggregation Service) could invalidate the DID by publishing a Beacon Signal with a malformed update."
2. "When the Beacon Signal does require n-of-n signing, a hostile Aggregation Cohort (or Aggregation Service) could render that Beacon inoperable, preventing publication of BTCR2 Updates through that address. However, this has no effect on other beacons."

The same section says: "The best practice to avoid complete failure is to have at least one Singleton Beacon in every DID document, ensuring a fallback mechanism should all Aggregate Beacons fail."

Aggregate Beacons, "BTCR2 Update Aggregation", says: "A full protocol definition is out of scope for this specification, but a RECOMMENDED example is provided for illustration."

### Examples

Alice, Bob, and Carol are the members of a CAS cohort of service S. The advert of S names no `fallbackThreshold`.

| | Before | After, with the default values |
|---|---|---|
| Script tree | leaf A (k = 2) and leaf B (key of S, 144 blocks) | none |
| Who can publish a Beacon Signal | all 3 members; any 2 members (leaf A); S alone after 144 blocks (leaf B) | all 3 members |
| S puts 2 keys of its own in a cohort with Alice | S publishes alone through leaf A | S cannot publish without Alice |
| Bob goes offline | 2 members complete the Beacon Signal through leaf A | the beacon stops; a Singleton Beacon stays the backup beacon |
| The funds if Bob goes offline | S can take them back through leaf B after 144 blocks | they stay at the beacon address |

## Decision

### 1. Each script leaf is off by default

`AggregationCohort.computeBeaconAddress` adds a leaf only if the cohort conditions name it. With no leaf, the output has no script tree, and `tapMerkleRoot` is empty. The tweak is `taggedHash('TapTweak', P)`, where P is the x-only form of the MuSig2 aggregate key (the BIP-86 form). Thus only all n members together can spend the output.

With both leaves, the order stays leaf A, then leaf B (ADR 043, decision 2).

### 2. The cohort conditions name each leaf

- `fallbackThreshold` present: leaf A with exactly this k. Absent: no leaf A. `computeBeaconAddress` no longer uses k = max(1, n-1).
- `recoveryKey` and `recoverySequence` present: leaf B. Both absent: no leaf B.

These functions refuse an input with only one of the two recovery values:

- `validateCohortConditions` returns the problem "recoveryKey and recoverySequence must be both present or both absent". Thus `createCohort` refuses the config.
- `isCohortAdvertMessage` returns `false`. It also returns `false` for a `recoveryKey` that is not 64 hex characters and for a `recoverySequence` outside [1, 0xffff].
- `recoveryLeafParams` refuses with the error type `INCOMPLETE_RECOVERY_PARAMS`. `buildRecoveryLeaves` calls it.

The advert shows each leaf and the exact k. Thus `shouldJoin` and the participant see the full script tree before the participant sends `COHORT_OPT_IN`.

### 3. The participant refuses each leaf that it does not allow

`AggregationParticipantParams` and `AggregationParticipantRunnerOptions` have two new options: `allowFallbackLeaf` and `allowRecoveryLeaf`. The default of each option is `false`. `joinCohort` refuses an advert that names a leaf that the participant does not allow:

- Leaf A: the error type `FALLBACK_LEAF_NOT_ALLOWED`. The data has `cohortId` and `fallbackThreshold`.
- Leaf B: the error type `RECOVERY_LEAF_NOT_ALLOWED`. The data has `cohortId`, `recoveryKey`, and `recoverySequence`.

The cohort stays in the Discovered phase. The participant runner calls `shouldJoin` first. If `shouldJoin` accepts the advert and `joinCohort` refuses it, the runner emits `error` and sends no `COHORT_OPT_IN`.

At `COHORT_READY`, the participant computes the beacon address with the leaf values of the advert. It refuses another address (`BEACON_ADDRESS_MISMATCH`, [ADR 152](152-the-aggregation-checks-bind-to-the-beacon-type-the-membership-and-the-beacon-output-of-the-cohort-and-the-service-checks-only-the-update-sender.md)). If the two addresses match, the address has only the leaves of the advert.

### 4. The participant checks the key count against the bounds of the advert

At `COHORT_READY`, the participant refuses a key count n below `minParticipants` or above `maxParticipants` of the advert. The error type is `COHORT_SIZE_OUT_OF_BOUNDS`. The data has `cohortId`, `n`, `minParticipants`, and `maxParticipants`. The check comes before `validateMembership`. The phase stays OptedIn, as for `BEACON_ADDRESS_MISMATCH`.

With leaf A, each key above the bound can be a key of the service, and the service can sign with k such keys without the members. Before this change, only the service checked the bounds.

### 5. A cohort with no leaf A has no fallback

- `AggregationService.startFallbackSigning` refuses a cohort with no leaf A, with the error type `NO_FALLBACK_LEAF`. The check comes after the `COHORT_NOT_FOUND` check. The phase does not change.
- `AggregationServiceRunner.triggerFallback` rejects with this error. With `autoFallbackOnStall`, the runner does not start the fallback at a phase timeout for a cohort with no leaf A. The runner fails the cohort with `COHORT_PHASE_STALLED`.
- The participant drops a `FALLBACK_AUTHORIZATION_REQUEST` for a cohort with no leaf A. It drops the request before it wipes its secret nonce of the key-path round. Thus the request cannot stop that round.
- `buildFallbackSpend` requires `fallbackThreshold`. It refuses a spent output with no leaf A (`PREVOUT_SCRIPT_MISMATCH`).
- `buildRecoverySpend` takes `fallbackThreshold` only for an output with leaf A. If the caller sets `beaconAddress`, `buildRecoverySpend` refuses an output with no leaf B (`BEACON_ADDRESS_MISMATCH`).

### 6. Two beacon types for the same members need another key

The beacon type is not an input of the beacon address (ADR 152). With no leaf, the address depends only on the cohort keys and the network. Thus two cohorts with the same keys get one address, also if their beacon types differ. The `BEACON_TYPE_CONFLICT` check of ADR 152 stays the guard. The participant makes this check only for the cohorts of one participant object.

This ADR adds no code for this case. The JSDoc of `CohortConditions.recoverySequence` and of `SoloCohortOptions.config`, and the method docs, tell the caller to use another key of each member for another beacon type.

### 7. The `solo` runner adds no leaf by default

`AggregationRunner.solo` gives the leaf values of `config` to the service with no change. It sets no default value. `SoloCohortOptions.config` has the new optional `fallbackThreshold`. The solo participant allows leaf A if `config.fallbackThreshold` is present. It allows leaf B if `config.recoveryKey` or `config.recoverySequence` is present.

`DEFAULT_RECOVERY_SEQUENCE` stays exported as a suggested value. No code of the package uses it.

### 8. `participant-funded` stays refused

`buildRecoveryLeaves` refuses the funding model `participant-funded` with the error type `UNSUPPORTED_FUNDING_MODEL`, also with no leaf. Thus `computeBeaconAddress` refuses it before it sets `tapTweak`.

### 9. The wire version stays 2

The advert fields keep their names. An advert can now omit `recoveryKey` and `recoverySequence`. `AGGREGATION_WIRE_VERSION` stays 2 ([ADR 168](168-the-aggregation-participant-makes-the-smt-nonce-and-sends-only-the-update-hash.md)). The aggregation package 0.10.0 is the first release with wire version 2, and it has this change. Thus no released peer of wire version 2 has the old rules.

### 10. Each judgment call conforms to the specification texts

| Judgment call | Text | Result |
|---|---|---|
| Each leaf is off by default, and a member must allow each leaf (decisions 1 and 3). | Appendix, "No Privileged Role": "It is RECOMMENDED that Aggregate Beacons use a Beacon Address that requires an n-of-n Schnorr Signature". "Aggregate Beacon Address Verification": "DID controllers participating in an Aggregation Cohort SHOULD verify the Beacon Address is an `n-of-n`". | Conforms. The default is the recommended form. A cohort with a leaf deviates from a SHOULD only with the consent of each member. |
| The values name each leaf, and k has no default (decision 2). | Aggregate Beacons, "BTCR2 Update Aggregation": "A full protocol definition is out of scope for this specification, but a RECOMMENDED example is provided for illustration." | The specification is silent. The advert shows the full script tree, so each member can verify it. |
| The participant checks n against the bounds of the advert (decision 4). | "Aggregate Beacon Address Verification": "that one of the `n` keys is the key that they provided to the Aggregation Service." | The specification is silent on the bounds. With this check, the participant limits the keys that a service can add to a cohort with leaf A. |
| For `COHORT_SIZE_OUT_OF_BOUNDS`, the phase stays OptedIn. The runner calls `shouldJoin` before the leaf check. The two leaf refusals have two error types (decisions 3 and 4). | The scope text of the row on decision 2 applies. | The specification is silent. |
| A cohort with no leaf A has no fallback (decision 5). | Appendix, "Worst Case", item 2: "this has no effect on other beacons." Also: "The best practice to avoid complete failure is to have at least one Singleton Beacon in every DID document". | Conforms. The beacon stops, and the specification names the Singleton Beacon as the backup beacon. |
| The address of a cohort with no leaf depends only on the keys, and this ADR adds no code for two beacon types (decision 6). | "Aggregate Beacon Address Verification": "This can be achieved only by constructing the Beacon Address for themselves using the set of keys from the Aggregation Cohort". | Conforms. The address has no input that the specification does not name. Another key gives another address. |
| The member still does not check the change destination of a beacon transaction (residual "The change output with no leaf"). | "Invalidation Attacks": "DID controllers SHOULD verify the updates announced within a Beacon Signal before authorizing it." | The specification is silent on the change output. The member still verifies the Beacon Signal against the data (ADR 089, decision 1). The first reason of ADR 089, decision 3, stays: a member cannot tell a rotated change address from a drain address. |
| `AGGREGATION_WIRE_VERSION` stays 2 (decision 9). | The specification defines no wire version. The scope text of the row on decision 2 applies. | The specification is silent. |

## Alternatives

**Keep each leaf on by default, and let a participant opt out.** Rejected. The specification asks for an n-of-n address in three SHOULD rules. With this default, a participant that sets no option joins a cohort where one party can publish a Beacon Signal alone. "Worst Case" item 1 names that risk.

**Remove both leaves.** Rejected. A leaf is a tool for an operator and a cohort that accept its trade-off. Under a SHOULD, an implementation can deviate for a reason. With decision 3, each member gives its consent.

**Use a flag for each leaf, with the old default values.** Rejected. A flag and a value are two sources of truth for one leaf. The participant must then also know the default k. With decision 2, the advert shows the exact k.

**Accept each leaf, and let only `shouldJoin` decide.** Rejected. A caller with `shouldJoin: async () => true` then joins a cohort with leaves. The specification asks each DID controller to verify that the address is n-of-n.

**Put the beacon type or the cohort id into the tweak.** Rejected. The tweak then has an input that the specification does not name. The specification builds the address from "the set of keys from the Aggregation Cohort". With the old default values (the key of the service, 144 blocks), both beacon types also got one address.

**Fail the cohort for `COHORT_SIZE_OUT_OF_BOUNDS`, as for `BEACON_TYPE_CONFLICT`.** Rejected. A wrong key count is a bad `COHORT_READY` of the service, as a wrong address is. For both, the phase stays OptedIn.

**Skip an advert with a refused leaf before `shouldJoin`, with no event.** Rejected. The caller wanted the cohort. The `error` event tells the caller why the join did not occur.

**Use one error type with a `leaf` field.** Rejected. With two error types, a caller can select the case by the type alone, as for each other error type of the participant.

## Consequences

- The aggregation package gets a MINOR release. At 0.x, a MINOR release can hold a break of the public API. No other workspace package depends on the aggregation package, so no other package gets a release.
- The method README, the method docs, and a comment in `packages/method/src/core/beacon/beacon.ts` change. These changes are documentation only, so the method package gets no release. npm shows the new method README after the next method release.
- With the default values, the beacon address of a cohort changes. A config with `recoveryKey` and `recoverySequence` but no `fallbackThreshold` also gets another address, because leaf A is now absent. To keep an old address, the service must name k = max(1, n-1) and the two recovery values. Each member must also allow both leaves.
- A UTXO at an old address stays spendable. The caller of `buildFallbackSpend` must give the old k (max(1, n-1)), `recoveryKey`, and `recoverySequence`. The caller of `buildRecoverySpend` must give the old k.
- By default (`allowFallbackLeaf` and `allowRecoveryLeaf` are `false`), a participant refuses each advert with a leaf. An operator who wants a leaf must ask each member to allow it.
- In a cohort with no leaf, one offline member stops the beacon, and the funds stay at the beacon address. "Worst Case" item 2 names this case. A DID document with a Singleton Beacon keeps a beacon that works.
- If the caller sets no `changeAddress`, the change of a beacon transaction goes to the beacon address (ADR 044, decision 1). With no leaf, only all n members together can spend that change. ADR 044 says: "A transient n-of-n cohort that may dissolve after one round also cannot safely lock change to anything that requires all n signers to reconvene." For a cohort of one round, the caller of `buildAggregationBeaconTx` can set `changeAddress` to an address of the funder.
- The test vectors do not change. No vector and no step of the vector pipeline uses the aggregation package.

The public API breaks. No alias stays:

1. This change removes `resolveFallbackThreshold`, `AggregationCohort.effectiveFallbackThreshold`, and the error type `NO_RECOVERY_PARAMS`.
2. `CohortConditions.recoveryKey` and `CohortConditions.recoverySequence` are optional. `BeaconLeafParams` requires only `cohortKeys`. `buildRecoveryLeaves` returns 0, 1, or 2 leaves. `recoveryLeafParams` and the error type `INCOMPLETE_RECOVERY_PARAMS` are new.
3. `FallbackSpendParams.fallbackThreshold` is required. `FallbackSpendParams.recoveryKey` and `FallbackSpendParams.recoverySequence` are optional. `RecoverySpendParams.fallbackThreshold` has no default.
4. The participant options `allowFallbackLeaf` and `allowRecoveryLeaf` are new. The error types `FALLBACK_LEAF_NOT_ALLOWED`, `RECOVERY_LEAF_NOT_ALLOWED`, `COHORT_SIZE_OUT_OF_BOUNDS`, and `NO_FALLBACK_LEAF` are new.
5. `AggregationRunner.solo` sets no default leaf value. `SoloCohortOptions.config.fallbackThreshold` is new.

These residuals stay:

- **The change output with no leaf.** A member does not check where the change of a beacon transaction goes (ADR 089, decision 3). The first reason of ADR 089 stays: a member cannot tell a rotated change address from a drain address. [ADR 044](044-beacon-change-output-address.md) makes the change destination a value of the caller. The second reason, "The argument that does work", is true only if the address has the leaves. With no leaf, the honest members sign a drain transaction of the service, because they do not check the change. Thus the funder of a beacon address with no leaf trusts the service with the balance.
- **One address for two beacon types.** With no leaf, two cohorts with the same keys get one address (decision 6). The participant makes the `BEACON_TYPE_CONFLICT` check only for the cohorts of one participant object.
- **Keys of the service inside the bounds.** With leaf A, a service can still add keys of its own up to `maxParticipants`. The participant cannot tell a key of the service from a key of a member. Each member that allows leaf A accepts this risk.

**Superseded.**

- ADR 039, decision 7: the words "Conditions are advisory to participants, structural to the service." Decision 3 of this ADR makes the participant refuse a leaf that it does not allow. Decision 4 of this ADR makes it refuse a key count outside the bounds of the advert.
- ADR 041, the status note: the words "adopts a hybrid Taproot output (optimistic MuSig2 key-path, k-of-n script fallback, timelock recovery) that handles liveness directly". Decision 1 of this ADR makes each leaf of that output opt-in.
- ADR 042, "Decision": the words "with three spend paths" in the lead paragraph. Decision 1: the lead words "Beacon output becomes an internal key plus a script tree", the words "replacing the key-path-only output", the sentence "The script tree carries a k-of-n fallback leaf and a timelock recovery leaf.", and the words "so the MuSig2 session tweak must now include the Merkle root". Decision 2: the title "Three spend paths, tried as an optimistic cascade". These statements are true only for a cohort with a leaf. Decision 1 of this ADR makes the key-path-only output the default, with the tweak `taggedHash('TapTweak', P)`.
- ADR 042, decision 2: the sentence "Funds are never permanently locked." Decision 3: the words "The operator funds the beacon UTXO and holds the single CSV recovery key". Decision 4: the words "transitions optimistic to fallback to recovery rather than hanging". Decision 6: the words "immediately removes permanent fund-locking" and "but funds are always recoverable". Decision 8: the words "Because the hybrid handles liveness directly". Decisions 1 and 5 of this ADR make each leaf opt-in, so a cohort with no leaf has no fallback and no recovery.
- ADR 042, "Consequences", "Positive": the words "Funds are never permanently locked (the recovery leaf), the rare defector no longer freezes the cohort (the k-of-n fallback)". "Negative": the sentence "The beacon output format changes from key-path-only to internal-key plus a script tree, and the MuSig2 tweak must include the Merkle root." "References": the words "to replace with a script tree". Decision 1 of this ADR makes the key-path-only output the default.
- ADR 043, "Context": the words "replaced the key-path-only aggregate beacon output with a hybrid Taproot output". Decision 1 of this ADR makes the hybrid output opt-in.
- ADR 043, decision 1: the title words "defaulting to n-1", the sentence "When unadvertised, k resolves to `max(1, n-1)`: tolerate one missing or defecting signer, the smallest useful fallback witness.", and the words "the same advertised-or-default rule". Decision 2 of this ADR removes the default: with no `fallbackThreshold`, the address has no leaf A.
- ADR 043, decision 2: the words "For the current two-leaf tree". Decision 1 of this ADR gives a tree of 0, 1, or 2 leaves.
- ADR 043, decision 7: the words "the script-tree scriptPubKey the cohort actually funded" and the sentence "A key-path-only script would not match the funded UTXO and would invalidate both the key-path sighash and the fallback script-path sighash." Decision 1 of this ADR makes the key-path-only script the funded script of a cohort with no leaf.
- ADR 043, "Consequences": the sentences "Funds remain recoverable via leaf B even when k cannot be reached." and "Both land in a single breaking release so the address derivation stabilizes once." Decisions 1 and 2 of this ADR make leaf B opt-in and change the address derivation.
- ADR 089, "Context": the words "or, when that path stalls, a standalone BIP-340 signature over the k-of-n script-path leaf". Decision 5 of this ADR gives a cohort with no leaf A no fallback signature.
- ADR 089, decision 3: the title words "the beacon address already surrendered custody", the words "while blocking nothing an attacker cannot do another way", and the paragraph "The argument that does work." with its two bullets. Also the paragraph from "So anyone who funds a cohort beacon address" to "funding a beacon address is trusting the recovery-key holder and any k members with the balance." These statements are true only for a beacon address with the leaves. The words "with k defaulting to n-1 when the advert does not set it" are not true for any cohort. The residual "The change output with no leaf" gives the trust statement for a beacon address with no leaf. Decisions 1 and 2 of this ADR make each leaf opt-in and remove the default.
- ADR 089, "Consequences": the sentence "Whoever funds a beacon address trusts the advertised recovery-key holder and any k members with the balance." "Rejected alternatives": the words "protects funds that the beacon output's own script tree has already surrendered to the recovery-key holder and to any k members". These statements are true only for a beacon address with the leaves. Decision 1 of this ADR makes each leaf opt-in.
- ADR 152, "Context": the sentence "The beacon address comes from the cohort keys, k, the recovery key, the recovery sequence, the funding model ([ADR 042](042-fault-tolerant-beacon-output.md)), and the network." "Consequences", "Unchanged": the bullet "ADR 042: the inputs of the beacon address." With no leaf, the inputs are the cohort keys and the network. Decisions 1 and 6 of this ADR make k and the recovery values inputs only for a leaf that the cohort names.
- ADR 152, decision 5: the sentence "With `autoFallbackOnStall`, k other members can also sign a cohort that this member refused." "Alternatives": the sentence "After `rejectValidation`, k other members can still sign the cohort." These statements are true only for a cohort with leaf A. Decision 5 of this ADR gives a cohort with no leaf A no fallback.
- ADR 152, decision 9: the sentence "The examples also give the recovery terms that ADR 042 requires." "Implementation": the words "the service example sets the recovery terms", the words "say that `recoveryKey` and `recoverySequence` are required (ADR 042)", and the sentence "To offer both types to the same members, use another `recoverySequence` for each type." Decision 2 of this ADR makes the recovery values optional. Decision 6 of this ADR tells the caller to use another key of each member for each beacon type.

**Unchanged.**

- ADR 039, decision 1: `beaconType` and `minParticipants` are the required conditions, and each other condition is optional. Decision 2 of this ADR adds the leaf values as optional conditions.
- ADR 042, "Context": the key-path-only output `p2tr(aggPubkey, undefined, network)` with the tweak `taggedHash("TapTweak", aggPubkey)`. Also: "A key-path-only Taproot UTXO can be spent in exactly one way: a single Schnorr signature under the tweaked aggregate key, which mathematically requires all n MuSig2 partial signatures." Decision 1 of this ADR adds this output as the default, with its risk.
- ADR 042, decisions 1, 3, and 5: the internal key is the n-of-n MuSig2 aggregate of the independent BIP-340 keys of the members. Leaf B is `<delay> CHECKSEQUENCEVERIFY DROP <operatorKey> CHECKSIG`. The recovery policy, the condition validator, and the advert guard enforce the bound of the delay. `participant-funded` stays reserved. Decisions 2 and 8 of this ADR add the leaf values as optional values and keep the refusal of `participant-funded`.
- ADR 043, decisions 1, 2, 4, 5, and 7: k is in [1, n], and a different k gives a different address. The leaf order is leaf A, then leaf B. The fallback on a stall is opt-in. The member computes leaf A from its own cohort state. The spent output script comes from the funded beacon address. Decision 5 of this ADR adds the refusal of a fallback for a cohort with no leaf A.
- ADR 043, "Consequences": "**k is a published cohort property.** Joining members see k in the advert and can decline a cohort whose fallback tolerance they dislike." Decision 3 of this ADR adds the option `allowFallbackLeaf`, with the default `false`.
- ADR 044, decision 1: the change destination is the `changeAddress` of the caller, and the default is the beacon address. Decision 1 of this ADR adds a default beacon address that only all n members can spend (see the change bullet in the Consequences).
- ADR 089, decisions 1 and 2: the Beacon Signal binds to the validated data, and a signable transaction has a fixed form. Decision 3: "A member does **not** check where the change goes or how large the fee is." Decision 4: a member accepts a `FALLBACK_AUTHORIZATION_REQUEST` only with the session of the key-path round. Decision 5 of this ADR adds the drop of a fallback request for a cohort with no leaf A.
- ADR 152, decisions 3 and 5: each signature spends the beacon output of the cohort, and `#assertSignableBeaconTx` compares the prevout script byte for byte with `beaconScript`. Two cohorts with the same keys, k, recovery key, recovery sequence, and funding model have the same beacon script. One beacon address of a participant has one beacon type (`BEACON_TYPE_CONFLICT`). Decision 6 of this ADR adds that two cohorts with the same keys and no leaf have the same beacon script.
- ADR 152, the residual "One key for each DID": the beacon address does not depend on the DID. Decision 6 of this ADR adds one key for each beacon type.

## Implementation

- `packages/aggregation/src/core/recovery-policy.ts`: `BeaconLeafParams` with optional leaf values; `recoveryLeafParams`; `buildRecoveryLeaves` returns only the named leaves; the removal of `resolveFallbackThreshold`; the module JSDoc and the JSDoc of `DEFAULT_RECOVERY_SEQUENCE`.
- `packages/aggregation/src/core/cohort.ts`: `computeBeaconAddress` with an empty or optional script tree and the BIP-86 tweak; the removal of `effectiveFallbackThreshold` and `NO_RECOVERY_PARAMS`.
- `packages/aggregation/src/core/conditions.ts`: optional `recoveryKey` and `recoverySequence`; the pair rule of `validateCohortConditions`; the JSDoc of each leaf value.
- `packages/aggregation/src/core/messages/bodies.ts`: the pair rule, the 64 hex rule, and the optional range rule of `isCohortAdvertMessage`.
- `packages/aggregation/src/core/fallback-spend.ts`, `packages/aggregation/src/core/recovery-spend.ts`: the leaf values of `FallbackSpendParams` and `RecoverySpendParams`; no k = max(1, n-1) default.
- `packages/aggregation/src/service/service.ts`: `createCohort` with an optional `recoveryKey`; `NO_FALLBACK_LEAF` in `startFallbackSigning`.
- `packages/aggregation/src/service/service-runner.ts`: the leaf check of the phase timer; the multi-cohort JSDoc example.
- `packages/aggregation/src/participant/participant.ts`, `packages/aggregation/src/participant/participant-runner.ts`: `allowFallbackLeaf`, `allowRecoveryLeaf`, the two leaf refusals of `joinCohort`, `COHORT_SIZE_OUT_OF_BOUNDS`, and the drop of a fallback request for a cohort with no leaf A.
- `packages/aggregation/src/aggregation-runner.ts`: `solo` with no default leaf value and the allow options of the solo participant.
- Demos (`packages/aggregation/lib/operations/aggregation/`): `aggregation-service.ts`, `e2e-http-transport.ts`, `e2e-nostr-transport.ts`, and `e2e-verify-signing.ts` use a cohort with no leaf.
- `packages/method/src/core/beacon/beacon.ts`: the comment on the spent output script in `buildAggregationBeaconTx` (by default, the output has no script tree).
- Docs: `packages/aggregation/README.md`, `packages/method/README.md`, `packages/method/docs/aggregation.md` (the new section "Beacon address", and `changeAddress` for a cohort of one round), `packages/method/docs/beacon-system-overview.md`.
- Tests (`packages/aggregation/tests/`):
  - `aggregation-leaf-opt-in.spec.ts` (new): the address of each leaf set (none, A, B, A and B), the pair rule, the member refusals, the bounds of n, `NO_FALLBACK_LEAF`, the spend builders with one leaf, and `solo`.
  - 18 other spec files: the default fixtures have no leaf. Each leaf test names the leaf in the config and allows it in the participant.

## References

- did:btcr2 specification (main at commit `cc96c580`): [Appendix](https://dcdpr.github.io/did-btcr2/appendix.html) ("No Privileged Role", "Worst Case"), [Security Considerations](https://dcdpr.github.io/did-btcr2/appendix/security-considerations.html) ("Invalidation Attacks", "Aggregate Beacon Address Verification"), [Aggregate Beacons](https://dcdpr.github.io/did-btcr2/beacons/aggregate-beacons.html) ("BTCR2 Update Aggregation"), [Terminology](https://dcdpr.github.io/did-btcr2/terminology.html) ("Beacon Signal").
- BIP-86 (the key-path-only tweak), BIP-341 (Taproot), BIP-342 (`OP_CHECKSIGADD`).
- ADRs 039, 041, 042, 043, 044, 089, 152, 168.

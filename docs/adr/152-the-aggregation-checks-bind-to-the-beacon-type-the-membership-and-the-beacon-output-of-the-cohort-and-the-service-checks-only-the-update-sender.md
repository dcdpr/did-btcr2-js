# ADR 152: The Aggregation Checks Bind to the Beacon Type, the Membership, and the Beacon Output of the Cohort, and the Service Checks Only the Update Sender

- **Status:** Accepted
- **Date:** 2026-10-20
- **Packages:** `@did-btcr2/aggregation` (MINOR: the participant, the service, and the two runners refuse input that they accepted before. `RejectionReason`, `JoinedCohortInfo`, and some runner events change)

## Context

In an aggregate beacon round, the service makes the cohort, the beacon address, the aggregated data, and the transaction. Each member checks this work and then signs. Before this change, the checks had five defects. The runners also had old defects in the same code.

### The member validated with the beacon type that the message named

`#handleDistributeAggregatedData` selected the strategy with `message.body.beaconType`. It did not use the beacon type of the cohort. The advert guard `isCohortAdvertMessage` accepted each `beaconType` string.

Example: a member joins a CASBeacon cohort, and its DID document gets a CASBeacon service at the beacon address. The service then sends DISTRIBUTE_AGGREGATED_DATA with the type SMTBeacon, a valid SMT proof, and the SMT root. The member validated the data as SMT data (`matches` true) and signed a transaction that anchors the SMT root. A resolver processes this signal as a CAS signal. It finds no CAS Announcement for the root and raises `MISSING_UPDATE_DATA`, so the DID does not resolve.

A member also joined a cohort of the type `FooBeacon`. The round of that cohort then stopped at the distribution.

### The service accepted a member after it fixed the beacon address

`acceptParticipant` had no phase check. `pendingOptIns()` still listed each open opt-in after `finalizeKeygen`.

Example: a cohort has `minParticipants` 1. The opt-ins of b and c arrive together, and the operator decision for c takes 50 ms. The runner accepts b, and `finalizeKeygen` computes the beacon address from the key of b. Then the approval of c returns, and `acceptParticipant` adds c. The cohort keys are now the keys of b and c, but b got an address for the key of b alone. Thus the address does not come from the cohort keys, and c gets no COHORT_READY.

A second path needed no slow decision. A DID with an open opt-in sent COHORT_OPT_IN again after `finalizeKeygen`. The state machine dropped this message. The runner then read the old record from `pendingOptIns()` and called the operator again, and the approval added the DID.

### A fallback signature did not bind to the beacon output of the member

`approveFallback` computed the script-path sighash over the prevout script of the request (`prevOutScriptHex`). It did not compare this script with the cohort. The fallback leaf comes only from the sorted cohort keys and k ([ADR 043](043-k-of-n-fallback-protocol.md), decision 2).

Example: cohorts A and B have the same two keys and k = 1, but other recovery keys. Their fallback leaves are equal, and their beacon addresses are different. The service of A asks a member to sign a fallback transaction. The transaction spends the UTXO of B, sends its value to the service, and anchors the signal of A. The member signed, and its signature completed a valid spend of the UTXO of B. [ADR 089](089-aggregation-signing-preconditions.md), decision 4, records this residual.

On the key path, `approveNonce` also used the script of the request with no comparison. The partial signature uses the tweak of the cohort of the member, so it cannot spend an output with another key. `startSigning` accepted each prevout script. It threw `MISSING_PREV_OUT_SCRIPT` only after it set the phase SigningStarted.

### The service refused a conformant update

`#verifySubmittedUpdate` verified the proof of an update with the opt-in key (`participantPk`) of the sender.

Example: `did:btcr2:k1abc` joins a CASBeacon cohort with the key of `#initialKey`. Update 2 adds `#key-2` and makes it the only `capabilityInvocation` entry. The controller signs update 3 with `#key-2`. The service dropped update 3 with the rejection code `UPDATE_VERIFICATION_FAILED`, but a resolver accepts update 3. Thus no later update of the DID got through this beacon.

The opt-in key is also self-declared ([ADR 090](090-aggregation-transport-sender-authentication.md), the residual "`participantPk` is self-declared and not tied to the sender's DID"). Thus the old check bound the update to no key of the DID document.

### Two beacon types can get one beacon address

The beacon address comes from the cohort keys, k, the recovery key, the recovery sequence, the funding model ([ADR 042](042-fault-tolerant-beacon-output.md)), and the network. It does not come from the beacon type or from the DID. A member uses the same key in each cohort.

Example: a service advertises a CASBeacon cohort and an SMTBeacon cohort with `minParticipants` 1 and the same recovery terms. A member joins both cohorts, and both cohorts get the address X. The application adds a CASBeacon service at X to the DID document. The SMT round then anchors an SMT root from X. A resolver processes this signal as a CAS signal and raises `MISSING_UPDATE_DATA`.

The type check of decision 1 does not find this case, because the member validates each cohort with the type of that cohort. Also, `joinedCohorts` listed a cohort after its COHORT_READY failed with the error type `BEACON_ADDRESS_MISMATCH`. The cause: `validateMembership` sets `cohort.beaconAddress` before it compares the address.

### The runners had old defects in the same code

1. `joinFirst` and `joinMatching` rejected on an `error` event, but they did not stop the runner. The caller had no runner handle, and the runner continued to sign and to join new adverts.
2. `stop()` removed only the transport handlers. A callback that waited at `stop()` still signed and sent a message after it returned.
3. The service runner awaited `onProvideTxData` with no latch. A VALIDATION_ACK during the await called `onProvideTxData` again, for example a repeated ack or an ack of a stranger. The second `startSigning` call threw `INVALID_PHASE`, and the runner failed the cohort.
4. Two opt-ins of one DID can wait on the operator at the same time. Then the second approval threw `ALREADY_ACCEPTED` and failed the cohort. Or the first approval added the key of the second opt-in to the cohort, even if the operator declined that key.

The service runner also dropped an approval past `maxParticipants` with no event. The four demos in `packages/aggregation/lib/operations/aggregation/` built a beacon transaction with no `OP_RETURN` signal. Their prevout script was a key-path-only P2TR script, not the beacon script.

### Examples

| Case | Before | After |
|---|---|---|
| A CAS cohort gets valid SMT data under the type SMTBeacon | The member signs the SMT root. | `matches` is false. The default runner sends a rejection ack, and `approveNonce` throws `UNVALIDATED_DATA`. |
| An advert has the `beaconType` `FooBeacon` | The member joins, and the round stops at the distribution. | The participant drops the advert. |
| The approval of c returns after `finalizeKeygen` | `acceptParticipant` adds c. The address does not come from the cohort keys. | The runner emits `message-rejected` with the rejection code `MEMBERSHIP_FINAL`. |
| A fallback request of cohort A spends the UTXO of cohort B | The member of A signs. The spend of B is valid. | `approveFallback` throws `PREVOUT_SCRIPT_MISMATCH`. |
| The member submits update 3, signed with `#key-2` | The service drops it (`UPDATE_VERIFICATION_FAILED`). | The service accepts it. |
| An SMT cohort gets the accepted address of a CAS cohort of the member | The member signs the SMT root. | `receive()` throws `BEACON_TYPE_CONFLICT`. The phase becomes Failed, and the runner emits `cohort-failed`. |

### The normative specification texts

- Beacons: "The Beacon Type in the service defines how Beacon Signals MUST be processed."
- Beacons: "Any on-chain Beacon Signal that cannot be processed renders the related DID invalid. For this reason, all DID controllers SHOULD ensure the Beacon Addresses they include in their DID document require appropriate approval to spend UTXOs controlled by the address, so that only approved Beacon Signals can be posted to Bitcoin."
- Terminology, Beacon Signal: "Beacon Signals are Bitcoin transactions that spend from a Beacon Address and include a transaction output of the format defined in Signal Bytes."
- Terminology, Beacon Address: "Spends of UTXO controlled by this address are identified as Beacon Signals."
- Resolve, Find Beacon Signals: "For each Beacon Address that is not in `scanned_beacons`:". Also: "The transaction spends from the Beacon Address.", "The last output script of the transaction contains Signal Bytes.", and "Derive `update_hash` from the transaction's Signal Bytes based on the Beacon Type:".
- Resolve, Process CAS Beacon: "Raise a `MISSING_UPDATE_DATA` error if the announcement is not in `cas_lookup_table` and not available from CAS." Process SMT Beacon: "Raise a `MISSING_UPDATE_DATA` error if `smt_lookup_table` has no entry for `smt_root`."
- Security Considerations, Aggregate Beacon Signal Verification: "The DID controller SHOULD verify that the Beacon Signal announces the BTCR2 Update they expect (or no BTCR2 Update) for all Beacon Signals broadcast by Aggregation Services before final authorization. If they do not, then invalidation attacks become possible where a Beacon Signal announces a BTCR2 Update that cannot be retrieved for a particular DID, causing the DID to be invalidated." This text names the failure of the first defect and of the fifth defect.
- Security Considerations, Aggregate Beacon Address Verification: "DID controllers participating in an Aggregation Cohort SHOULD verify the Beacon Address is an `n-of-n` and that one of the `n` keys is the key that they provided to the Aggregation Service." Also: "This can be achieved only by constructing the Beacon Address for themselves using the set of keys from the Aggregation Cohort that SHOULD be provided by the Aggregation Service."
- Update, Construct BTCR2 Signed Update: "An `INVALID_DID_UPDATE` error MUST be raised if no entry of the `sourceDidDocument.capabilityInvocation` Set identifies `verificationMethodId`."
- Resolve: "The resolver MUST find the entry of `current_document.capabilityInvocation` that identifies `update.proof.verificationMethod`."

The specification does not mark the appendix as non-normative. Conformance: "Everything else in this specification is normative." Thus the SHOULD texts of the security considerations are normative.

### The texts with no requirement

- Aggregate Beacons: "DID controllers can use a CAS Beacon, an SMT Beacon, or both to participate in BTCR2 Update Aggregation." This text has no BCP 14 keyword. It names the two aggregate beacon types.
- Privacy Considerations, Aggregation Services Only Need Hashes: "aggregators are able to coordinate Beacon Signals without needing to view or validate DID documents or the updates." This text has no BCP 14 keyword, and it describes a capability. Thus it sets no requirement.

### The illustrative example

- Aggregate Beacons: "A full protocol definition is out of scope for this specification, but a RECOMMENDED example is provided for illustration."
- Conformance: "All sections marked as non-normative, as well as all authoring guidelines, diagrams, examples, and notes in this specification are non-normative." The key words apply "when, and only when, they appear in all capitals".

Thus the section "Example Using Musig2, secp256k1, and Schnorr Signatures" is illustrative, and its lowercase "must" is not a BCP 14 keyword. Three of its texts match this change:

- "The Aggregation Service decides when to finalize the membership of the Aggregation Cohort. After it does, it computes an `n-of-n` Pay-to-Taproot (P2TR) address from the public keys the Aggregation Participants provided."
- "The Aggregation Participant must validate the contents of the Beacon Signal (partially signed transaction) according to the type of the BTCR2 Beacon:"
- "allows all Aggregation Participants to veto any Beacon Signal for which their own proof data does not match the proposed `OP_RETURN` data."

This change follows the example, but no check depends on the example. Each check depends on the normative texts above.

### BIP 341

Common signature message: "sha_scriptpubkeys (32): the SHA256 of all spent outputs' scriptPubKeys, serialized as script inside CTxOut." Thus a Taproot signature commits to the script of the output that the transaction spends.

## Decision

### 1. The member validates with the beacon type of its cohort

- `isCohortAdvertMessage` (`packages/aggregation/src/core/messages/bodies.ts`) accepts only a `beaconType` in `KNOWN_BEACON_TYPES`: CASBeacon and SMTBeacon. The participant drops an advert of another type. The runner then emits no `cohort-discovered` event and does not call `shouldJoin`. `joinCohort` for the id of that advert throws `INVALID_PHASE` ("not in Discovered phase").
- `#handleDistributeAggregatedData` selects the strategy with the beacon type of the cohort, from the advert. `PendingValidation.beaconType` is that type.
- `PendingValidation.matches` is also false if the message names another type or no type. Before, the participant dropped a message with no type. Now it stores a validation with `matches` false.
- The default `onValidateData` approves only if `matches` is true, so for such data it sends a rejection ack. `approveNonce` and `approveFallback` throw `UNVALIDATED_DATA` if `matches` is false.
- `JoinedCohortInfo.beaconType` (a new required member), the `beaconType` of the `OnProvideUpdate` info (new), and `CohortCompleteInfo.beaconType` give the type of the cohort. Before, `CohortCompleteInfo.beaconType` came from the validation, or it was an empty string. The JSDoc says: "The beacon service in the DID document must have this type."

### 2. The membership is final at `finalizeKeygen`

`finalizeKeygen` computes the beacon address from the cohort keys. Thus the service accepts no member after it:

- `acceptParticipant` checks `COHORT_NOT_FOUND` first. It then throws `INVALID_PHASE` outside the phase Advertised, before its other checks.
- `pendingOptIns()` returns an empty map outside the phase Advertised. The runner reads this map after each opt-in, so a second opt-in after `finalizeKeygen` reaches no operator callback.
- The state machine drops an opt-in outside the phase Advertised and records no rejection. This behavior does not change.

After the operator decision, the service runner applies these checks in this order:

1. If the runner stopped, or the cohort completed or failed, the runner drops the approval with no event.
2. If the DID is already a member, the runner drops the approval with no event (decision 7).
3. If the phase is not Advertised, the runner emits `message-rejected` with the rejection code `MEMBERSHIP_FINAL`.
4. If a newer opt-in of the DID replaced the record, the runner drops the approval with no event (decision 7).
5. If the cohort has `maxParticipants` members, the runner emits `message-rejected` with the rejection code `COHORT_FULL`. Before, it dropped the approval with no event.

The runner emits `MEMBERSHIP_FINAL` and `COHORT_FULL`, not the state machine. The participant of a late approval gets no message and stays in the phase OptedIn. `AggregationParticipantRunner` has no timeout, so the application of the participant must set its own deadline.

### 3. Each signature spends the beacon output of the cohort

- `AggregationCohort` has the private field `#beaconScript`. `computeBeaconAddress` sets it from the P2TR payment. The getter `beaconScript` returns a copy, and it is empty before `computeBeaconAddress`.
- `#assertSignableBeaconTx` gets the prevout script of the request. After the one-input check, it compares the script byte for byte with `beaconScript`. If the script is not hex, is not equal, or `beaconScript` is empty, it throws `PREVOUT_SCRIPT_MISMATCH` with the data `{ cohortId, beaconAddress, prevOutScriptHex }`.
- `approveNonce` and `approveFallback` both apply this check. After the check, both sign over the `beaconScript` of the cohort, not over the script of the request.
- `startSigning` applies its checks in this order: `COHORT_NOT_FOUND`, `INVALID_PHASE`, `MISSING_PREV_OUT_SCRIPT`, then `PREVOUT_SCRIPT_MISMATCH` if `prevOutScripts[0]` is not `beaconScript`. Then it starts the session. A refusal leaves the phase Validated. The service runner then fails the cohort.

The check is the first defense. A beacon signal spends from the beacon address (Terminology), so a member signs only a spend of its own beacon output. The sighash over its own beacon script is a second defense. By BIP 341, a signature over its own beacon script cannot spend an output with another script.

Only the check on the fallback path closes an attack: the spend of another cohort with the same keys and k. On the key path, the partial signature already uses the tweak of the cohort. The key-path check and the `startSigning` check fail fast: they refuse a round that cannot complete, before any signature.

Two cohorts with the same keys, k, recovery key, recovery sequence, and funding model have the same beacon script. For these cohorts the check passes. Decision 5 covers the beacon type of such cohorts.

### 4. The service checks only the structure of the proof and the sender DID

`#submittedUpdateProblem` replaces `#verifySubmittedUpdate`. It reads the proof through `unknown`, so a wrong type gives a rejection and not a raw `TypeError` out of `receive()`. It applies these checks in this order:

1. The proof is an object, not `null` and not an array. Else: `UPDATE_MALFORMED`, "SUBMIT_UPDATE signedUpdate has no proof object".
2. `verificationMethod` is a string, and `proofValue` is a string that is not empty. Else: `UPDATE_MALFORMED`, "Update proof has no verificationMethod or proofValue string".
3. `verificationMethod` is the sender DID, then `#`, `?`, or `/`, then at least one more character. Else: `UPDATE_SENDER_MISMATCH`, "Update proof verificationMethod is not a DID URL of the sender DID".

Check 3 refuses a relative id (`#initialKey`), the bare DID, and a longer DID that starts with the sender DID. The rule is the rule of `Updater.sign` on the write path ([ADR 147](147-only-the-method-that-signs-an-update-must-be-a-bip340-multikey-and-both-update-paths-check-that-method.md), decision 6).

The service does not verify the signature. It does not hold the current DID document of the sender, so it cannot know which methods can sign an update. A resolver verifies the proof. An update with a bad proof harms only the DID of the sender. The CAS map key is that DID, and the SMT leaf index is the SHA-256 hash of that DID.

The order of `#handleSubmitUpdate` does not change: the body, `NOT_A_MEMBER`, the size cap, the new checks, then `DUPLICATE_RESPONSE`. `service.ts` no longer imports `BIP340Cryptosuite` and `SchnorrMultikey`. The package source now imports only types from `@did-btcr2/cryptosuite`.

`RejectionReason` changes:

- `UPDATE_VERIFICATION_FAILED` is removed. No alias stays.
- `UPDATE_SENDER_MISMATCH` is new (check 3).
- `INVALID_FALLBACK_SIG` is new. It names a fallback signature that does not verify (before: `UPDATE_VERIFICATION_FAILED`). It also names a fallback `signerPk` that is not the cohort key of the sender (before: `UPDATE_MALFORMED`).
- `MEMBERSHIP_FINAL` and `COHORT_FULL` are new. Only the service runner emits them (decision 2).
- `UPDATE_MALFORMED` now has four causes: no `signedUpdate`, an update that JCS cannot canonicalize, no proof object, and check 2.

### 5. One beacon address of a participant has one beacon type

In `#handleCohortReady`, after `validateMembership`, the participant compares this cohort with each other cohort of the participant object. If another cohort has the same accepted beacon address and another beacon type:

- the phase of this cohort becomes Failed;
- `receive()` throws `AggregationParticipantError` of the type `BEACON_TYPE_CONFLICT`;
- the data is `{ cohortId, beaconType, beaconAddress, otherCohortId, otherBeaconType }`.

The membership is final at `finalizeKeygen` (decision 2), so a cohort in conflict cannot get another address. Thus a cohort in conflict fails. If no other cohort conflicts, the participant records the accepted address and sets the phase CohortReady.

The scope of the check:

- **The participant side only.** The service has no address check (see Alternatives).
- **One participant object in memory.** The check reads only the cohorts of this object.
- **Any phase.** A cohort in the phase Complete, or Failed after `rejectValidation`, still counts. Its address can stay in a beacon service of a DID document. With `autoFallbackOnStall`, k other members can also sign a cohort that this member refused.
- **After `validateMembership`.** The check uses an address that the member computed. Before `validateMembership`, only the claimed address is available.
- **The accepted-address field.** `validateMembership` sets `cohort.beaconAddress` before it compares, so a refused COHORT_READY can leave an address in the cohort. The new field `ParticipantCohortState.beaconAddress` holds only the accepted address. The check and `joinedCohorts` read only this field.

Thus `joinedCohorts` lists only the cohorts whose COHORT_READY the participant accepted. Two cohorts of one beacon type at one address stay allowed. The JSDoc of `JoinedCohortInfo.beaconType` tells the application to compare the beacon address with the beacon services of its DID documents.

The check compares address strings. Testnet3, testnet4, signet, and mutinynet give one address string for the same terms. Thus the check can also refuse a cohort on another of these networks. This refusal is not necessary, but it makes no DID invalid.

### 6. The participant runner reports the refusal as a cohort failure and stops before a rejection

- The COHORT_READY handler of the participant runner reads the error type. For `BEACON_TYPE_CONFLICT`, it emits `cohort-failed` with `{ cohortId, reason }` and no `error` event. The refusal ends one cohort, as a validation rejection does. The JSDoc of `error` says "A non-fatal error occurred". The other cohorts of the runner continue.
- `joinFirst` and `joinMatching` call `runner.stop()` before they reject on an `error` event.
- The participant runner checks the stopped state again after each awaited application callback: `shouldJoin`, `onProvideUpdate`, `onValidateData`, and `onApproveSigning` for the nonce and for the fallback. The JSDoc of `stop()` says: "A callback that waits at stop() has no effect after it returns."
- `joinFirst` and `joinMatching` do not count a failed cohort. They wait for a cohort that completes. If no other cohort completes, the promise does not settle. The JSDoc says so.

Thus `joinFirst` with two cohorts in conflict resolves with the first cohort and its sidecar data. Before this change, the member refused no cohort, so it signed each cohort that got to the signing before `joinFirst` stopped the runner. This is a reason for `cohort-failed`: an `error` event makes `joinFirst` reject, and the caller does not get the sidecar data (see Alternatives).

### 7. The service runner applies an approval only to the opt-in that the operator saw, and it requests the transaction data one time

- After the `MEMBERSHIP_FINAL` check, the runner compares the record of `pendingOptIns()` with the record that it gave to the operator. `pendingOptIns()` returns the stored records, so an identity comparison finds a replaced record. For a replaced record, the runner drops the approval with no event.
- Before this check, the runner drops an approval for a DID that is already a member, with no event.
- The service runner sets the latch `signingRequested` before it awaits `onProvideTxData`. A VALIDATION_ACK during the await then cannot call `onProvideTxData` or `startSigning` a second time. After the await, the runner does not call `startSigning` if the runner or the cohort stopped, or if the cohort completed or failed.

The identity check has two limits:

1. Under an approve-all policy, the newest opt-in wins. The decision for the newest opt-in approves it, and the service adds its key to the cohort. The default `onOptInReceived` approves each opt-in.
2. On a transport with no sender authentication, a stranger can send an opt-in with the DID of another party. The check does not bind the opt-in to a key of that DID. A later change of the transports binds the opt-in to the sender key.

The JSDoc of `onOptInReceived` says: "only the decision for the new opt-in applies."

### 8. The demos send a signal and spend the beacon output

The four demos in `packages/aggregation/lib/operations/aggregation/` get the prevout script from the beacon address. Each demo sends the change to the beacon address and puts `OP_RETURN <signalBytes>` in the last output. `e2e-verify-signing.ts` reads the tweaked key from the beacon output, and it computes the sighash over the beacon script. The JSDoc examples of `startSigning` and `AggregationServiceRunner` name `buildAggregationBeaconTx` of `@did-btcr2/method` with its options object.

### 9. Each judgment call conforms to the specification texts

| Judgment call | Text | Result |
|---|---|---|
| The member validates the aggregated data with the beacon type of the advert. It vetoes data under another type or under no type. | Beacons: "The Beacon Type in the service defines how Beacon Signals MUST be processed." Security Considerations: "The DID controller SHOULD verify that the Beacon Signal announces the BTCR2 Update they expect (or no BTCR2 Update)". | Conforms. The beacon service of the member has the type of the cohort. A signal of another type announces no update that a resolver can find for the DID. |
| The participant drops an advert of a type other than CASBeacon and SMTBeacon. The check runs on the receive path, not in `joinCohort`. | Aggregate Beacons: "DID controllers can use a CAS Beacon, an SMT Beacon, or both to participate in BTCR2 Update Aggregation." | Conforms. Only these two types aggregate updates. The specification is silent on the place of the check. On the receive path, one advert of another type cannot reject `joinFirst` or `joinMatching`. |
| `acceptParticipant` throws `INVALID_PHASE` outside the phase Advertised. `pendingOptIns()` is empty outside that phase. | Aggregate Beacons, example: "The Aggregation Service decides when to finalize the membership of the Aggregation Cohort. After it does, it computes an `n-of-n` Pay-to-Taproot (P2TR) address from the public keys the Aggregation Participants provided." Security Considerations: "DID controllers participating in an Aggregation Cohort SHOULD verify the Beacon Address is an `n-of-n` and that one of the `n` keys is the key that they provided to the Aggregation Service." | Conforms. A key that the service adds after `finalizeKeygen` is not in the address that each member computed. |
| A late approval gives `message-rejected` with `MEMBERSHIP_FINAL` or `COHORT_FULL`. A late opt-in and an approval after a stop give no event. | The specification defines no event of a service. | The specification is silent. One rule covers both late approvals, so an operator that approved an opt-in gets an answer. A late opt-in reaches no operator callback, so it needs no answer. |
| The service runner applies an approval only to the opt-in that the operator saw. It drops an approval for a member DID. A latch requests the transaction data one time. | The specification defines no operator decision and no runner. | The specification is silent. The checks keep the rule of ADR 089, decision 5: one inbound message cannot fail a cohort. A repeated opt-in or a repeated ack no longer fails the cohort. |
| The member and `startSigning` refuse a prevout script that is not the beacon script, on the key path and on the fallback path. | Terminology: "Beacon Signals are Bitcoin transactions that spend from a Beacon Address and include a transaction output of the format defined in Signal Bytes." Beacons: "so that only approved Beacon Signals can be posted to Bitcoin." | Conforms. A transaction that spends another output is not a beacon signal of the cohort. Both paths give the same guarantee, as ADR 043, decision 5, does for the signal check. |
| The member signs over its own beacon script. `beaconScript` is a private field with a copy getter. | BIP 341: "sha_scriptpubkeys (32): the SHA256 of all spent outputs' scriptPubKeys, serialized as script inside CTxOut." | Conforms. The signature commits to the beacon script of the member, so it cannot spend an output with another script. The specification is silent on the API. With a copy, a caller cannot change the bytes that the check reads. |
| The JSDoc examples and the demos build a transaction that spends the beacon output and puts the signal in the last output. | Resolve, Find Beacon Signals: "The transaction spends from the Beacon Address." Also: "The last output script of the transaction contains Signal Bytes." | Conforms. The examples also give the recovery terms that ADR 042 requires. |
| The service checks only the structure of the proof and the sender DID. It does not verify the signature. | Update: "An `INVALID_DID_UPDATE` error MUST be raised if no entry of the `sourceDidDocument.capabilityInvocation` Set identifies `verificationMethodId`." Resolve: "The resolver MUST find the entry of `current_document.capabilityInvocation` that identifies `update.proof.verificationMethod`." Privacy Considerations: "aggregators are able to coordinate Beacon Signals without needing to view or validate DID documents or the updates." | Conforms. Each `capabilityInvocation` method that can sign can sign an update. The service does not hold the current DID document, so a key check refuses conformant updates. The specification gives the service no check of an update. |
| The proof id must be the sender DID, then `#`, `?`, or `/`, then at least one more character. | The specification names no proof id rule for a service. | The specification is silent. The rule is the rule of `Updater.sign` (ADR 147, decision 6). The old service check also refused a relative id, at the signature verification. |
| Each check has its own rejection code. `UPDATE_VERIFICATION_FAILED` is removed with no alias. | The specification defines no rejection code of a service. | The specification is silent. Each name identifies its check: a structure check validates, and a signature check verifies. At 0.x, the package changes the name with no alias. |
| The participant refuses a COHORT_READY at the accepted address of another of its cohorts with another beacon type. Two cohorts of one type at one address stay allowed. | Resolve, Find Beacon Signals: "For each Beacon Address that is not in `scanned_beacons`:" and "Derive `update_hash` from the transaction's Signal Bytes based on the Beacon Type:". Beacons: "Any on-chain Beacon Signal that cannot be processed renders the related DID invalid." | Conforms. A resolver scans each beacon address one time and processes each signal with one beacon type. A signal of the other type cannot be processed. |
| The check runs after `validateMembership`, reads only the accepted address, and counts each other cohort in any phase. | Security Considerations: "This can be achieved only by constructing the Beacon Address for themselves using the set of keys from the Aggregation Cohort that SHOULD be provided by the Aggregation Service." | Conforms. The check uses an address that the member computed. A Complete or Failed cohort can keep a beacon service in a DID document. |
| On a conflict, the phase becomes Failed. The participant runner emits `cohort-failed` and no `error` event. | The specification defines no participant event. | The specification is silent. The membership is final, so the cohort cannot get another address. The refusal ends one cohort, as a validation rejection does. |
| The check is only on the participant side and knows one participant object. The library has no service check and no seed option for known beacons. | Security Considerations: "The DID controller SHOULD verify that the Beacon Signal announces the BTCR2 Update they expect (or no BTCR2 Update) for all Beacon Signals broadcast by Aggregation Services before final authorization." | Conforms. The SHOULD applies to the DID controller. By the guard criterion of ADR 135, the library refuses only a permanent failure with data that it holds. The DID documents are data of the application. |
| `joinFirst` and `joinMatching` stop the runner before they reject. The runner checks the stop after each awaited callback. `joinMatching` does not count a failed cohort. | The specification defines no library API. | The specification is silent. After a rejection, the caller has no runner handle, so only the helper can stop the runner. `joinMatching` keeps its contract: "resolve once `count` cohorts have completed". |

## Alternatives

- **Verify the update signature with the cohort key, as a documented service rule.** Rejected. The check refuses a conformant update that another `capabilityInvocation` method signs. The opt-in key is self-declared (ADR 090), so the check binds the update to no key of the DID document.
- **Add a hook `validateSubmittedUpdate`, with the structure check as the default.** Rejected for this change. No operator needs it now. A later change can add it for an operator that resolves the DID of each sender.
- **Keep the rejection code `UPDATE_VERIFICATION_FAILED` and change only the reason text.** Rejected. The name identifies a signature check that no longer runs.
- **Use `UPDATE_MALFORMED` for each fault of a submitted update.** Rejected. A caller then cannot tell a malformed proof from a proof under another DID.
- **Ignore a late approval with no event.** Rejected. An operator interface that approved an opt-in then waits for a `participant-accepted` event that never comes.
- **Add a new runner event `opt-in-expired`.** Rejected. `message-rejected` already reports each input that the service drops. A new event type for one case adds API.
- **Throw `UNSUPPORTED_BEACON_TYPE` from `joinCohort`.** Rejected. The runner calls `joinCohort` for each advert that passes `shouldJoin`. One advert of another type then rejects `joinFirst` and `joinMatching`.
- **Make `beaconScript` a public field.** Rejected. A caller can then change the bytes that the check reads.
- **Check the prevout script only on the fallback path.** Rejected. ADR 043, decision 5, gives both paths the same guarantee. The key-path check and the `startSigning` check also refuse a round that cannot complete, before any signature.
- **Give each cohort a fallback leaf of its own.** Rejected. The leaf is an input of the beacon address, so every beacon address changes. The prevout check already closes the attack.
- **Record the two beacon types at one address as a residual.** Rejected. The type check of decision 1 then has a gap: the member signs a signal of the other type at its own address.
- **Run the conflict check before `validateMembership`, with the claimed address.** Rejected. If the claim is false, the member reports `BEACON_TYPE_CONFLICT` and not `BEACON_ADDRESS_MISMATCH`.
- **Count only the other cohorts in a live phase.** Rejected. A Complete cohort keeps its address in a DID document. After `rejectValidation`, k other members can still sign the cohort.
- **Keep the `error` event for the conflict and stop the runner.** Rejected. The stop also ends the other cohorts of the runner. For example, the member then does not sign the cohort that it accepted first.
- **Add an address record to the service: `createCohort` or `finalizeKeygen` refuses a second beacon type at one address, and the record stays after `removeCohort`.** Rejected for this change. At the service, the harm is a stall, and `phaseTimeoutMs` ends it. The service also does not know the cohorts of another service.
- **Add a seed option `knownBeacons` for the beacon services of the DID documents of the application.** Rejected for this change. The DID documents are data of the application, and the library does not hold them. The JSDoc and the docs tell the application to compare.
- **Let `joinMatching` settle when a cohort fails.** Rejected for this change. It changes the contract "resolve once `count` cohorts have completed".

## Consequences

- The aggregation package gets a MINOR release. At 0.x, a MINOR release can hold a break of the public API. No other package depends on the aggregation package.
- The method docs and the method README change too (`packages/method/docs/` and `packages/method/README.md`). No file of `dist` or `src` of the method package changes, so the method package gets no release. npm always publishes the README, so the next release of the method package publishes the new README.
- The test vectors do not change. No vector and no step of the vector pipeline uses the aggregation package.

The behavior changes:

- A member vetoes data of another beacon type, or data under no type. Before, it approved and signed.
- A member does not join a cohort of a type other than CASBeacon and SMTBeacon. Before, it joined, and the round stopped at the distribution.
- A late approval after `finalizeKeygen` adds no member. The runner emits `MEMBERSHIP_FINAL`. Before, the service added the member, and the address no longer came from the cohort keys.
- A member refuses to sign, on both paths, a transaction that does not spend its beacon output. Before, it signed. On the fallback path, its signature completed a spend of another cohort.
- `startSigning` refuses a prevout script that is not the beacon script. Before, it started a round that did not give a valid spend.
- The service accepts an update that any key signed, if the proof names a DID URL of the sender DID. A signature that does not verify passes too. The harm stays with the DID of the sender: a resolver refuses the update, and only that DID fails to resolve.
- A member refuses a cohort at the accepted address of another of its cohorts with another beacon type. Before, it signed both cohorts.

The public API breaks:

1. `isCohortAdvertMessage` returns false for a `beaconType` other than CASBeacon and SMTBeacon. The participant drops such an advert. The runner emits no `cohort-discovered` event, and `joinCohort` throws `INVALID_PHASE` for its id.
2. `PendingValidation.beaconType` is the type of the cohort. `PendingValidation.matches` is false if the message names another type or no type. A message with no type now gives a stored validation.
3. `approveNonce` and `approveFallback` throw `PREVOUT_SCRIPT_MISMATCH`.
4. `acceptParticipant` throws `INVALID_PHASE` outside the phase Advertised. `pendingOptIns()` returns an empty map outside that phase.
5. `startSigning` throws `PREVOUT_SCRIPT_MISMATCH`. It throws `MISSING_PREV_OUT_SCRIPT` before it changes the phase.
6. `RejectionReason` removes `UPDATE_VERIFICATION_FAILED`. It adds `UPDATE_SENDER_MISMATCH`, `INVALID_FALLBACK_SIG`, `MEMBERSHIP_FINAL`, and `COHORT_FULL`. A fallback `signerPk` that is not the cohort key gives `INVALID_FALLBACK_SIG` (before: `UPDATE_MALFORMED`). A proof that is not an object, a `verificationMethod` that is not a string, or a `proofValue` that is empty or not a string gives `UPDATE_MALFORMED` (before: `UPDATE_VERIFICATION_FAILED`).
7. The service runner emits `message-rejected` with `MEMBERSHIP_FINAL` or `COHORT_FULL`. Before, it dropped these approvals with no event.
8. `JoinedCohortInfo.beaconType` is a new required member. Code that builds a `JoinedCohortInfo` must set it. Code that calls an `OnProvideUpdate` function must pass `beaconType`.
9. `CohortCompleteInfo.beaconType` is the type of the cohort. Before, it came from the validation, or it was an empty string.
10. `AggregationParticipant.receive()` throws `AggregationParticipantError` of the type `BEACON_TYPE_CONFLICT`, and the phase becomes Failed. The data is `{ cohortId, beaconType, beaconAddress, otherCohortId, otherBeaconType }`.
11. `joinedCohorts` lists only the cohorts whose COHORT_READY the participant accepted. Before, it also listed a cohort after `BEACON_ADDRESS_MISMATCH`. Each key in `JoinedCohortInfo.cohortKeys` is now a copy, so a change to a key does not change the cohort.
12. The participant runner emits `cohort-failed` with `{ cohortId, reason }` for `BEACON_TYPE_CONFLICT`, and no `error` event. `joinFirst` and `joinMatching` do not settle on it.
13. `joinFirst` and `joinMatching` stop the runner before they reject on an `error` event.
14. After `stop()`, a callback that returns late has no effect: the runner sends no message for it.
15. The additions: the getter `AggregationCohort.beaconScript` and the member `beaconType` of the `OnProvideUpdate` info.

The residuals:

- **The conflict check is in memory.** It does not know the cohorts of an earlier participant object, for example after a restart. It also does not know the cohorts of another object with the same key. Each `joinFirst` call, each `joinMatching` call, and each `AggregationRunner.solo` run makes a new object. The application must compare the beacon address with the beacon services of its DID documents. To refuse, it returns `{ approved: false }` from `onValidateData`. A `null` return from `onProvideUpdate` declines the update, but the member still signs.
- **One key for each DID.** The beacon address does not depend on the DID. If two DIDs use one key, an SMT cohort of one DID can get the beacon address of the other DID. Each SMT signal at a beacon address of a DID must have an SMT proof for that DID. Thus the application must use one key for each DID. The type check does not find this case, because the two beacon types are equal.
- **The structure check and a transport with no inbound authentication.** This residual applies to `InMemoryTransport`, to a custom transport with no sender authentication, and to a direct caller of the state machine. There, `message.from` is only a claim. The old signature check refused an update under the DID of a member if the sender did not hold the opt-in key. Now a party that sends messages with the DID of a member can submit an update for that DID before the member. The member then finds a wrong slot and vetoes the signal, so the round does not complete. On such a transport, the same party can already decline for the member with SUBMIT_NONINCLUDED, which has no signature.
- **The transport sender key is the genesis key.** The transports authenticate a sender with the genesis key of the DID ([ADR 066](066-x1-transport-authentication.md)). Thus the holder of a genesis key that a later update removed can still submit an update for the DID. A resolver refuses that update, so the DID does not resolve after a signal that announces it. The old check did not close this gap, because that holder declares its own opt-in key. This change does not widen the gap. A later change of the transports closes it.

The test evidence:

- The aggregation tests: 427 tests pass. Before this change, 347 tests passed.
- Old-code runs compile the new tests against older source. A run on the source of `@did-btcr2/aggregation` 0.7.7 covers 33 new or changed tests of decisions 1, 2, and 4, and 32 of them fail. One positive advert control passes. On the same source, the cross-cohort fallback test reaches `approveFallback`, and the old code signs.
- On the source of this change without decisions 5 and 6, 16 of the 20 tests of the conflict check and of the join helpers fail. The 4 tests that accept two cohorts pass by design. The 8 tests of the stopped checks and of the error type filter have no old-code run. Mutants pin them.
- The mutation run of decisions 1 to 4 has 46 mutants: 41 killed and 5 equivalent. Two more mutants remove the identity check and the latch of decision 7, and the tests kill both.
- The mutation run of decisions 5 and 6 has 34 mutants: 33 killed and 1 equivalent. The equivalent mutant stops the runner in `joinFirst` after the rejection, not before it. The `error` listener runs synchronously, so no caller code sees the order.

**Superseded.**

- ADR 089, decision 4: the paragraph from "Known residual: the fallback sighash is not bound to the member's own beacon output." to "it is the highest-value of the residuals in this record." Decision 3 of this ADR makes the comparison on both paths, and the member signs over its own beacon script.
- ADR 089, "Consequences": the first follow-up, "bind the fallback sighash's prevout script to the member's own beacon output (decision 4)". Decision 3 of this ADR closes it.
- ADR 089, decision 5: the clause "and the cryptographic validity of what it carries", for the SUBMIT_UPDATE handler. The service checks only the structure of the proof and the sender DID (decision 4). The clause still applies to a nonce, a partial signature, and a fallback signature (`INVALID_NONCE`, `INVALID_PARTIAL_SIG`, `INVALID_FALLBACK_SIG`).
- ADR 147, decision 10: the last sentence of its first paragraph, "A relative id (`#initialKey`) still passes this check, and the proof verification after it refuses the id, as the resolver does." The sender DID check now refuses a relative id with `UPDATE_SENDER_MISMATCH`, and no proof verification runs (decision 4).

**Unchanged.**

- ADR 089, decisions 1 and 2: the signal binds to the validated data, and a signable transaction has a fixed shape. Decision 3 of this ADR adds the prevout script rule to `#assertSignableBeaconTx`.
- ADR 089, decision 3: a member does not check the change destination or the fee. The other three follow-ups of its Consequences stay open: the fee cap, the rejection bound, and the participant-funded model.
- ADR 089, decision 4: a fallback request must carry the session id and the transaction of the optimistic round.
- ADR 089, decision 5: one inbound message cannot fail a cohort. The new service checks record a rejection and never throw from `receive()`. `acceptParticipant` and `startSigning` are operator actions, so they still throw. Decision 7 of this ADR applies the same rule to the service runner.
- ADR 089, decision 5, and the conflict check: decision 5 covers the service, and the conflict check is on the participant side. The participant `receive()` already threw for a refused COHORT_READY, for example with `BEACON_ADDRESS_MISMATCH`. The refusal also needs local state, not only one inbound message: an accepted cohort of this participant object, at an address that the member computed. A COHORT_READY counts only if its sender is the service of the cohort and it passes `validateMembership`. On a transport with no sender authentication, a party that sends messages with the service DID can already make the member accept a wrong COHORT_READY. Thus the check gives that party no new power.
- ADR 043, decision 2: two cohorts with the same keys and k have the same fallback leaf.
- ADR 043, decisions 5 and 7: the member computes the fallback leaf from its own cohort, and the prevout script is the beacon script. Decision 3 of this ADR makes decision 7 a condition of each signature.
- ADR 042: the inputs of the beacon address.
- ADR 147, decision 6: the proof id rule of the write path. The read path does not check it.
- ADR 147, decision 10: the DID of a proof id is the text before the first `?`, `/`, or `#`.
- ADR 090: the residual that `participantPk` is self-declared and not tied to the DID of the sender. That residual names `#verifySubmittedUpdate` as the check that the proof names the sender DID. `#submittedUpdateProblem` now makes this check (decision 4). It also refuses a relative id and the bare DID.

## Implementation

- `packages/aggregation/src/core/messages/bodies.ts`: `hasStrOneOf`. `isCohortAdvertMessage` accepts only a type in `KNOWN_BEACON_TYPES`.
- `packages/aggregation/src/core/cohort.ts`: the private field `#beaconScript`, the copy getter `beaconScript`, the assignment in `computeBeaconAddress`, and the JSDoc.
- `packages/aggregation/src/core/conditions.ts`: the module JSDoc and the `CohortConditions` JSDoc say that `recoveryKey` and `recoverySequence` are required (ADR 042). The JSDoc of `recoveryKey` and `recoverySequence` says that a CAS cohort and an SMT cohort with the same terms get one address. To offer both types to the same members, use another `recoverySequence` for each type.
- `packages/aggregation/src/core/beacon-strategy.ts`: the JSDoc of `AggregateBeaconStrategy`. The service and the participant accept only CASBeacon and SMTBeacon, and a registered strategy replaces the built-in strategy of the same type.
- `packages/aggregation/src/core/transport/nostr.ts`: the comment of the directed subscription. A relay can send an old message again, and a runner can act on it again. Thus a replayed message is not always harmless.
- `packages/aggregation/src/participant/participant.ts`:
  - `JoinedCohortInfo.beaconType` and its JSDoc;
  - the field `ParticipantCohortState.beaconAddress`. `joinedCohorts` reads it and copies the cohort keys;
  - the conflict check in `#handleCohortReady`;
  - the cohort type and the type check in `#handleDistributeAggregatedData`;
  - the prevout check in `#assertSignableBeaconTx`, and the beacon script in `approveNonce` and `approveFallback`;
  - the `@throws` of `receive()`, and the `@context` sentence in the JSDoc of `genesisDocument` ([ADR 148](148-did-document-adds-no-member-so-context-is-required-and-verificationmethod-and-service-are-optional.md)).
- `packages/aggregation/src/participant/participant-runner.ts`:
  - the `beaconType` of the `OnProvideUpdate` info and of `cohort-complete`;
  - `cohort-failed` for `BEACON_TYPE_CONFLICT`;
  - the stop before the rejection in `joinFirst` and `joinMatching`;
  - the stopped check after each awaited callback, and the JSDoc;
  - the `@context` sentence in the JSDoc of the `genesisDocument` option (ADR 148).
- `packages/aggregation/src/participant/events.ts`: the JSDoc of `CohortCompleteInfo.beaconType` and of `cohort-failed`.
- `packages/aggregation/src/service/service.ts`:
  - the `RejectionReason` members and their JSDoc;
  - `pendingOptIns()` and the phase check of `acceptParticipant`;
  - `#submittedUpdateProblem`, the removed cryptosuite import, and `INVALID_FALLBACK_SIG`;
  - the check order of `startSigning`;
  - the JSDoc of `CohortConfig`: the required conditions.
- `packages/aggregation/src/service/service-runner.ts`:
  - the checks after the operator decision, with `MEMBERSHIP_FINAL` and `COHORT_FULL`;
  - the latch `signingRequested`;
  - the JSDoc of `OnProvideTxData`, of `onOptInReceived`, and of the class example.
- `packages/aggregation/src/service/events.ts`: the JSDoc of `message-rejected`.
- `packages/aggregation/src/aggregation-runner.ts`: the JSDoc of `SoloCohortOptions.config` and `solo`. Each run makes a new participant object.
- `packages/aggregation/tests/aggregation-cohort-binding.spec.ts` (new):
  - the beacon type of the cohort and the final membership;
  - the approval of the opt-in that the operator saw;
  - the beacon output on both paths and in `startSigning`;
  - the conflict check and the runner stop.
- `packages/aggregation/tests/aggregation-submit-proof-id.spec.ts`: the new rejection codes, an update that another key signs, and an update whose `proofValue` does not verify.
- `packages/aggregation/tests/aggregation-receive-path-dos.spec.ts`: the beacon output in the fixtures, the new rejection codes, and the latch test.
- `packages/aggregation/tests/aggregation-multi-cohort.spec.ts`, `aggregation-noninclusion.spec.ts`, `aggregation.spec.ts`, `aggregation-x1-transport-auth.spec.ts`, and `aggregation-fallback-protocol.spec.ts`: the beacon script in the fixtures. The fallback spec also tests `INVALID_FALLBACK_SIG`.
- `packages/aggregation/tests/aggregation-conditions.spec.ts`: the advert guard for each beacon type. `aggregation-transport-sender-auth.spec.ts`: one comment.
- `packages/aggregation/lib/operations/aggregation/aggregation-service.ts`, `e2e-http-transport.ts`, `e2e-nostr-transport.ts`, and `e2e-verify-signing.ts`: the beacon output, the change output, and the signal in the last output.
- `packages/aggregation/README.md`: ADR 152 in the list of design records.
- `packages/method/README.md`: the service example sets the recovery terms and builds the transaction with `buildAggregationBeaconTx`.
- `packages/method/docs/aggregation.md` and `packages/method/docs/beacon-system-overview.md`: the participant flow, the service flow, the rejection codes, the prevout check, and the conflict check.

## References

- did:btcr2 specification: [Beacons](https://dcdpr.github.io/did-btcr2/beacons.html), [Aggregate Beacons](https://dcdpr.github.io/did-btcr2/beacons/aggregate-beacons.html), [Terminology](https://dcdpr.github.io/did-btcr2/terminology.html), [Conformance](https://dcdpr.github.io/did-btcr2/conformance.html), [Update](https://dcdpr.github.io/did-btcr2/operations/update.html), [Resolve](https://dcdpr.github.io/did-btcr2/operations/resolve.html), [Security Considerations](https://dcdpr.github.io/did-btcr2/appendix/security-considerations.html), and [Privacy Considerations](https://dcdpr.github.io/did-btcr2/appendix/privacy-considerations.html).
- [BIP 341](https://github.com/bitcoin/bips/blob/master/bip-0341.mediawiki): the common signature message.
- [BIP 327](https://github.com/bitcoin/bips/blob/master/bip-0327.mediawiki): MuSig2.
- [ADR 037](037-single-party-beacon-and-two-axis-model.md) and [ADR 040](040-multi-cohort-service-runner.md): `AggregationRunner.solo`, `joinFirst`, and `joinMatching`.
- [ADR 042](042-fault-tolerant-beacon-output.md), [ADR 043](043-k-of-n-fallback-protocol.md), [ADR 066](066-x1-transport-authentication.md), [ADR 089](089-aggregation-signing-preconditions.md), [ADR 090](090-aggregation-transport-sender-authentication.md), [ADR 135](135-an-update-is-refused-if-the-source-resolution-misses-an-update-of-the-sidecar-data.md), [ADR 147](147-only-the-method-that-signs-an-update-must-be-a-bip340-multikey-and-both-update-paths-check-that-method.md), and [ADR 148](148-did-document-adds-no-member-so-context-is-required-and-verificationmethod-and-service-are-optional.md).

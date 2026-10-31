# ADR 168: The Aggregation Participant Makes the SMT Nonce and Sends Only the Update Hash

- **Status:** Accepted
- **Date:** 2026-10-31
- **Packages:** `@did-btcr2/aggregation` (MINOR: the SUBMIT_UPDATE body holds `updateHash`, not the update; the public API of the messages, the cohort, the beacon strategy, and the service changes; `AGGREGATION_WIRE_VERSION` is 2)

## Context

In this ADR, a member is a participant that the service accepted in a cohort. A nonce is the SMT nonce of a leaf value, not a MuSig2 nonce. `updateId` is the JSON Document Hash of a BTCR2 Update (32 bytes).

### The service got the full update and made the SMT nonce

In an aggregate beacon round, each member answers an update opportunity. Before this change, the participant sent SUBMIT_UPDATE with the body `{ cohortId, signedUpdate }`, the full BTCR2 Update. A member with no update sent SUBMIT_NONINCLUDED. For an SMT cohort, `AggregationCohort.buildSMTTree` made a nonce for each member with `randomBytes(32)`. It computed each leaf value from that nonce and, for an update, the `updateId`, and it gave each member a proof with the nonce.

Thus the service learned three facts about each member: the text of the update, the nonce, and if the member had an update. A known nonce hides nothing from the party that knows it.

An update can be private sidecar data. Privacy Considerations, "Updates Can Be Private", says: "Bitcoin is used to publicly announce and anchor updates to DID documents, however the updates themselves can be kept private by DID controllers and provided through a Sidecar mechanism at Resolution Time."

### The specification gives the service only a hash

- Privacy Considerations, "Aggregation Services Only Need Hashes": "aggregators are able to coordinate Beacon Signals without needing to view or validate DID documents or the updates. Instead, they are provided with a hash or Content Identifier (CID) of the update for a specific DID which they include in the Beacon Signal according to the type of the BTCR2 Beacon."
- Optimized Sparse Merkle Tree Implementation: "The DID controller selects the value for that index in that signal". Also: "With a `nonce`, other parties (aggregators, other DID controllers, verifiers) cannot know if there is an update, or its contents. Only the DID controller can tell them."
- Beacons, "SMT Beacon": "With a `nonce` in the leaf value, the DID controller also does not show if there is a BTCR2 Update, or its contents."
- Aggregate Beacons, "Respond to Update Opportunities", CAS Beacon: "`updateHash`: The SHA-256 hash of the BTCR2 Update to be included, created with the JSON Document Hashing algorithm."
- The same section, SMT Beacon: "`didIndex`: The SHA-256 hash of the DID to be updated;". For `updateHash`: "If there is an update:", "If a `nonce` is used: `hash(hash(nonce) + updateId)`", "If there is not an update:", "If a `nonce` is used: `hash(hash(nonce))`", and "If a `nonce` is not used: no value, the index stays empty and its leaf value is `cachedZero[0]`". Also: "Participants MUST persist their `nonce` values."
- Aggregate Beacons, "Step 3: Aggregate & Request Signal Confirmation": "For SMT Beacons, the Aggregation Service constructs a Sparse Merkle Tree (SMT) whose leaves pair each registered index with the value submitted for that index. Every registered index MUST appear as a leaf."
- Aggregate Beacons, "Confirm Signal Request": "For SMT Beacon Signals, Aggregation Participants must persist the BTCR2 Updates, nonce values, and SMT Proofs for each index they control."

Aggregate Beacons, "BTCR2 Update Aggregation", sets the scope of the Aggregate Beacons texts in this list: "A full protocol definition is out of scope for this specification, but a RECOMMENDED example is provided for illustration."

### ADR 029 accepted the leak with a false premise

ADR 029, "Consequences", "Negative", says: "The service operator can read plaintext of all directed messages they relay, including `SUBMIT_UPDATE` payloads. Mitigating factor: those payloads are already intended to be on-chain public data." The premise is false for a sidecar update. Only the Beacon Signal goes on chain, and the update can stay private.

ADR 029, "Explicitly accepted trade-offs", also says: "Participants who require end-to-end privacy against the service operator should use the Nostr transport, which offers NIP-44 envelope encryption at the wire layer." The Nostr transport encrypts each directed message to the key of the recipient. The service is the recipient of SUBMIT_UPDATE, so the service decrypts it. Thus no transport hides the body of SUBMIT_UPDATE from the service.

### Examples

| Case | Before | After |
|---|---|---|
| An SMT member adds a private service endpoint and keeps the update as sidecar data | The service gets the full update and makes the nonce. | The service gets only `hash(hash(nonce) + updateId)`. The member makes and keeps the nonce. |
| An SMT member has no update | The member sends SUBMIT_NONINCLUDED, so the service knows that the member has no update. | The member sends SUBMIT_UPDATE with `hash(hash(nonce))`. The service cannot tell it from an update. |
| A CAS member has an update | The service gets the full update and computes its hash. | The service gets the hash. The CAS Announcement holds the same hash. |
| A participant of wire version 1 sees an advert of a service of wire version 2 | Not applicable: each earlier release used wire version 1. | The participant ignores the advert, so it does not join the cohort. |

## Decision

### 1. SUBMIT_UPDATE holds only the `updateHash`

The body of SUBMIT_UPDATE is `{ cohortId, updateHash }`. `SubmitUpdateBody.updateHash` replaces `SubmitUpdateBody.signedUpdate`, and `BaseBody.updateHash` replaces `BaseBody.signedUpdate`. The value is 32 bytes in base64url with no padding. The name is the specification name for both beacon types:

- CAS Beacon: the JSON Document Hash of the update.
- SMT Beacon: the leaf value, `hash(hash(nonce) + updateId)` for an update, or `hash(hash(nonce))` for no update.

The body has no `did` field and no `didIndex` field. The service takes the DID from the sender of the transport envelope, as before. The SMT index is `didToIndex(did)`, the SHA-256 hash of the DID. `createSubmitUpdateMessage` takes `updateHash`, and `isSubmitUpdateMessage` requires an `updateHash` string.

### 2. The service checks only the form of the `updateHash`

`#handleSubmitUpdate` applies these steps in this order:

1. If the body has no `cohortId`, or if the service does not know the cohort, the service ignores the message. It also ignores the message outside the phases CohortSet and CollectingUpdates. It records no rejection.
2. If `updateHash` is not a string, the service refuses the message with `UPDATE_MALFORMED` ("SUBMIT_UPDATE has no updateHash string").
3. If the sender is not a member of the cohort, the service refuses the message with `NOT_A_MEMBER`.
4. If `updateHash` does not decode to exactly 32 bytes, the service refuses the message with `UPDATE_MALFORMED` ("SUBMIT_UPDATE updateHash is not 32 bytes in base64url"). The decoder `base64UrlToHash` (smt) is strict: it refuses the padding character `=` and padding bits that are not zero.
5. If the member already declined or already submitted a value in this round, the service refuses the message with `DUPLICATE_RESPONSE`.
6. `addUpdate(participantDid, updateHash)` stores the string as the member sent it.

The membership check and the `DUPLICATE_RESPONSE` check keep their order. A refused value is not an answer, so the member can send a good value after it. The first good value stands. `UPDATE_MALFORMED` now has two causes: no `updateHash` string, and a value that does not decode to 32 bytes.

### 3. The service has no size cap and no check of the update sender

The service no longer gets the update. Thus this change removes these items, with no alias:

- the size cap: `maxUpdateSizeBytes` of `AggregationServiceParams`, `AggregationService`, and `AggregationServiceRunnerOptions`, the constant `DEFAULT_MAX_UPDATE_SIZE_BYTES`, and the rejection code `UPDATE_TOO_LARGE`.
- the checks of ADR 152, decision 4: `#submittedUpdateProblem` and the rejection code `UPDATE_SENDER_MISMATCH`.
- the JCS step of the service. The service no longer canonicalizes an update.

The reasons:

- The body has a fixed size. In step 4 of decision 2, the service refuses a longer value with `UPDATE_MALFORMED`.
- The CAS map key or the SMT leaf index `hash(did)` binds a value to the DID of the sender. Thus a bad value harms only the DID of the sender, as a bad update did before (ADR 152, decision 4).
- By default, the HTTP server refuses a body string longer than 65,536 characters (`maxBodyBytes`) with the status 413. Thus with the default values, the old default cap of 256 KiB never applied over HTTP.

### 4. The cohort builds the aggregated data from the submitted values

`AggregationCohort.updateHashes: Map<string, string>` (DID to `updateHash`) replaces `pendingUpdates: Map<string, SecuredDocument>`. `addUpdate(participantDid, updateHash)` takes the value. `AggregationService.collectedUpdateHashes(cohortId)` replaces `collectedUpdates(cohortId)`. The cohort holds no update and no nonce.

- `buildCASAnnouncement` maps each DID to its `updateHash`. Before, it computed `canonicalHash` of each update. A member that declined is absent from the map, as before.
- `buildSMTTree` puts each submitted value at the index `didToIndex(did)`. It computes the root with `zeroHashRoot` and each proof with `generateZeroHashProof`. It gives each member `serializeProof(root, proof)`: a proof with `id`, `collapsed`, and `hashes`, and with no `nonce` and no `updateId`. Before, the cohort made the nonces and built a `BTCR2MerkleTree` with `addEntries`.

The signal bytes keep their form: the SHA-256 hash of the canonical CAS Announcement, or the SMT root.

### 5. The participant makes the SMT nonce and the value

`submitUpdate(cohortId, signedUpdate)` keeps its signature. The participant computes `updateId` with `canonicalHashBytes(signedUpdate)`. If an update has no JCS form, `submitUpdate` throws an `AggregationParticipantError` of type `UPDATE_MALFORMED`, as before (ADR 154, decision 7). Then it sends only the value:

- CAS Beacon: `updateHash` is `encode(updateId)`, the JSON Document Hash of the update in base64url.
- SMT Beacon: the participant makes a new 256-bit nonce with `randomBytes(32)`. `updateHash` is `hash(hash(nonce) + updateId)`.

The participant keeps `updateHash`, `nonce`, and `updateId` in its cohort state. These three fields replace `submittedUpdate`. The caller keeps the update. The service gets neither the update nor the nonce.

### 6. A participant with no update in an SMT cohort sends SUBMIT_UPDATE

The action of `declineUpdate(cohortId)` depends on the beacon type of the cohort:

- CAS Beacon: the participant sends SUBMIT_NONINCLUDED, as before. The CAS Announcement shows each DID with an update, so the absence of a DID is public data.
- SMT Beacon: the participant makes a new 256-bit nonce and sends SUBMIT_UPDATE with `hash(hash(nonce))`. The body has the same fields and the same length as the body of an update. Thus the service cannot tell a decline from an update.

In both cases, the phase becomes NonIncluded, and `CohortCompleteInfo.included` is `false`. The member stays in the cohort and signs. `submitUpdate` and `declineUpdate` use one private helper, `#submit`.

### 7. The service accepts SUBMIT_NONINCLUDED in an SMT cohort and leaves the index empty

The service still accepts SUBMIT_NONINCLUDED in an SMT cohort. The membership check and the `DUPLICATE_RESPONSE` check of `#handleSubmitNonInclusion` do not change. `buildSMTTree` puts no leaf at the index of that member, so the index stays empty with the leaf value `cachedZero[0]`. The member gets a proof of its index, and `verifyProof` returns `true` for it with no `nonce` and no `updateId`. The library participant does not send SUBMIT_NONINCLUDED in an SMT cohort (decision 6). If another implementation sends it, the service knows that the member has no update.

### 8. The participant validates its slot with its own values

The SMT strategy takes only `id`, `collapsed`, and `hashes` from the proof of the service. It adds the `nonce` that the member made and, for an update, the `updateId` of the member. Then it calls `verifyProof`. If the service puts a `nonce` or an `updateId` in the proof, the strategy ignores them. Thus `verifyProof` returns `true` only for the leaf value that the member selected.

The result is the full SMT Proof of the member. `PendingValidation.smtProof` and `CohortCompleteInfo.smtProof` hold it. The caller must persist it, because only the member knows the nonce.

The CAS strategy compares the map value of the member with the `updateHash` that the member kept. A member with no `updateHash` must be absent from the map, as before. `deriveSignal` does not change: the SMT signal is the `id` of the proof (ADR 089, decision 1).

### 9. The beacon strategy makes the values of a round

`AggregateBeaconStrategy` gets the required method `prepareSubmission(updateId?): BeaconSubmission`. The new type `BeaconSubmission` is `{ updateHash?, nonce? }`:

- CAS: `{ updateHash: encode(updateId) }` for an update, or `{}` for no update. With no `updateHash`, the participant sends SUBMIT_NONINCLUDED.
- SMT: a new 32-byte `nonce` and `updateHash: hashToBase64Url(leafValue(nonce, updateId))`, also for no update.

`validateParticipantView` takes `{ participantDid, updateHash?, nonce?, updateId?, body }`. This change removes the parameters `included`, `submittedUpdate`, and `expectedHash`. The strategy of each beacon type makes and checks its own value, as it already checks its own aggregated data.

### 10. `buildSMTTree` leaves the index empty for a submitted value equal to `cachedZero[0]`

`buildSMTTree` skips a submitted value equal to `cachedZero[0]`. The index of that member stays empty, and the root does not change. `cachedZero[0]` is the value of an empty leaf. A leaf with that value can give another member a sibling hash equal to a cached zero. `verifyProof` returns `false` for such a proof. Thus without the skip, one member can make `verifyProof` return `false` for the proofs of other members.

### 11. The wire version is 2

`AGGREGATION_WIRE_VERSION` is 2. The SUBMIT_UPDATE body changes, so a peer of version 1 and a peer of version 2 cannot complete a round together.

`AggregationParticipant.receive` ignores each message with another wire version, also a COHORT_ADVERT. Thus a participant of version 1 does not join a cohort of version 2. If `AggregationService.receive` knows the cohort of a message with another wire version, it refuses the message with `WRONG_VERSION`. Else it ignores the message.

If the wire version stays 1, an older participant joins the new cohort. The service refuses its SUBMIT_UPDATE with `UPDATE_MALFORMED`, because the body has no `updateHash`. The participant sends no other answer. `cohortTtlMs` and `phaseTimeoutMs` of the service runner are off by default. Thus the cohort waits, and one older participant stops the round of all members.

The method docs (`packages/method/docs/aggregation.md`, "Wire-format version") say that a change of the constant "is a breaking protocol change". ADR 027 (the mitigation of T3) says: "Mismatched messages are rejected, not silently processed as a possibly-incompatible shape."

### 12. Each judgment call conforms to the specification texts

| Judgment call | Text | Result |
|---|---|---|
| The body names the value `updateHash` for both beacon types. It has no `did` field and no `didIndex` field (decision 1). | Aggregate Beacons, "Respond to Update Opportunities": "`updateHash`: The SHA-256 hash of the BTCR2 Update to be included, created with the JSON Document Hashing algorithm." Also: "`didIndex`: The SHA-256 hash of the DID to be updated;". | Conforms. The name is the name of the specification. The sender of the transport envelope gives the DID, and the service computes `hash(did)`. |
| The service checks only that the value is 32 bytes. It has no size cap and no sender check (decisions 2 and 3). | Privacy Considerations: "aggregators are able to coordinate Beacon Signals without needing to view or validate DID documents or the updates." | Conforms. The service cannot validate a hash. A bad value harms only the DID of the sender. The specification sets no message size. |
| The participant makes the nonce and the value. For an SMT decline, the participant sends SUBMIT_UPDATE with `hash(hash(nonce))` (decisions 5 and 6). | SMT appendix: "The DID controller selects the value for that index in that signal". Also: "With a `nonce`, other parties (aggregators, other DID controllers, verifiers) cannot know if there is an update, or its contents." Aggregate Beacons: "If a `nonce` is used: `hash(hash(nonce))`". | Conforms. The service gets only a leaf value, and the two cases have one message type. |
| The service accepts SUBMIT_NONINCLUDED in an SMT cohort and leaves the index empty (decision 7). | Aggregate Beacons: "If a `nonce` is not used: no value, the index stays empty and its leaf value is `cachedZero[0]`". Step 3: "Every registered index MUST appear as a leaf." | Conforms. The specification lists this case. The empty index has the leaf value `cachedZero[0]`, and the member gets an SMT Proof of its index. |
| The member adds its own `nonce` and `updateId` to the proof of the service. `CohortCompleteInfo.smtProof` holds the full proof (decision 8). | Aggregate Beacons: "Participants MUST persist their `nonce` values." "Confirm Signal Request": "For SMT Beacon Signals, Aggregation Participants must persist the BTCR2 Updates, nonce values, and SMT Proofs for each index they control." | Conforms. The caller gets the nonce in the proof that it must persist. A nonce of the service cannot change the result. |
| The strategy interface gets `prepareSubmission`, and `validateParticipantView` takes the values that the member kept (decision 9). | Aggregate Beacons, "BTCR2 Update Aggregation": "A full protocol definition is out of scope for this specification, but a RECOMMENDED example is provided for illustration." | The specification is silent. The strategy of each beacon type already selects its aggregated data. |
| `buildSMTTree` leaves the index empty for a submitted value equal to `cachedZero[0]` (decision 10). | Algorithms, "SMT Proof Verification": "A `0` bit of `collapsed` selects an entry of `hashes` that is equal to the cached zero of that level." Also: "No `nonce` and no `updateId`: `cachedZero[0]`, the value of an empty leaf." | Conforms. The value is the value of an empty leaf, so the root is the same. The skip keeps the proofs of the other members valid. |
| `AGGREGATION_WIRE_VERSION` is 2 (decision 11). | The specification defines no wire version. The scope text of the row on decision 9 applies. | The specification is silent. A participant of version 1 does not join a cohort that it cannot complete. |

## Alternatives

**Make the nonce on the participant, but keep the full update in SUBMIT_UPDATE.** Rejected. The full update shows the same facts: its text, and that the member has an update. The nonce then hides nothing from the service.

**Record the leak in an ADR only.** Rejected. Privacy Considerations, "Aggregation Services Only Need Hashes", says that aggregators "are provided with a hash or Content Identifier (CID) of the update". The SMT appendix says that, with a nonce, aggregators "cannot know if there is an update". A record does not stop the leak.

**Keep wire version 1.** Rejected. An older participant then joins a new cohort, and the service refuses its SUBMIT_UPDATE with `UPDATE_MALFORMED`. With the default runner options, the cohort then waits with no end.

**Refuse SUBMIT_NONINCLUDED in an SMT cohort.** Rejected. The SMT response of the specification lists the case "no value, the index stays empty". A member of another implementation can select it.

**Keep a size cap for the body.** Rejected. The body has a fixed size. In step 4 of decision 2, the service refuses each value that is not 32 bytes.

## Consequences

- The aggregation package gets a MINOR release. At 0.x, a MINOR release can hold a break of the public API and of the wire. No other workspace package depends on the aggregation package, so no other package gets a release. The method docs change, but the method package does not publish its `docs` directory.
- The service learns less. In a CAS cohort, it gets the hash of each update, and the CAS Announcement holds the same hash. In an SMT cohort, it gets only a leaf value, so it cannot tell an update from no update, and it cannot learn the update.
- The participant makes a nonce for each SMT round and keeps it. It validates its slot with its own values. `cohort-complete` gives the full SMT Proof with the nonce.
- `SMTBeacon.broadcastSignal` (method) does not change. The single party is the DID controller, and it makes its own nonce.
- `BTCR2MerkleTree.addEntries` no longer builds the tree of a cohort, so its nonce check (ADR 166, decision 1) does not apply there. `prepareSubmission` of the SMT strategy makes each nonce with 32 bytes.
- The author of a custom strategy for `registerBeaconStrategy` must add `prepareSubmission` and use the new parameters of `validateParticipantView`. In TypeScript, a strategy without these changes does not compile. In JavaScript, `submitUpdate` and `declineUpdate` throw a `TypeError` for such a strategy.
- A peer of version 2 does not process a message of version 1 (decision 11). A peer of version 1 does not process a message of version 2. Thus the service and each participant of a cohort must use wire version 2, for example the aggregation package 0.10.0.
- In an SMT cohort, the Nostr messages of an update and of no update have the same type and the same length. Thus a relay cannot tell an update from no update by the length of the ciphertext.
- The test vectors do not change. No vector and no step of the vector pipeline uses the aggregation package.

The public API breaks. No alias stays:

1. `SubmitUpdateBody.signedUpdate` and `BaseBody.signedUpdate` become `updateHash`. `createSubmitUpdateMessage` takes `updateHash`. `isSubmitUpdateMessage` requires an `updateHash` string.
2. This change removes `maxUpdateSizeBytes` from `AggregationServiceParams`, `AggregationService`, and `AggregationServiceRunnerOptions`. It also removes `DEFAULT_MAX_UPDATE_SIZE_BYTES`.
3. This change removes `UPDATE_TOO_LARGE` and `UPDATE_SENDER_MISMATCH` from `RejectionReason`.
4. `AggregationService.collectedUpdates` becomes `collectedUpdateHashes`. `AggregationCohort.pendingUpdates` becomes `updateHashes`, and `addUpdate` takes an `updateHash` string.
5. `AggregateBeaconStrategy` gets the required method `prepareSubmission` and the new parameters of `validateParticipantView`. `BeaconSubmission` is new. `AGGREGATION_WIRE_VERSION` is 2.

These residuals stay:

- **The DID of the sender.** The service still learns the DID of each member from the transport envelope. Beacons, "SMT Beacon", says: "An SMT Beacon provides maximum privacy for the DID controller, as the DID controller never has to reveal their DIDs to the aggregator." Privacy Considerations, "Aggregation Participants Provide DIDs to Aggregation Services", says: "the Aggregation Service necessarily MUST know all DIDs in the Aggregation Cohort." This ADR does not change the envelope.
- **The service cannot check a value.** The service accepts each 32-byte value. It cannot check that a leaf value comes from a 256-bit random nonce. A bad value harms only the DID of the sender. The verifier accepts a nonce of any length (ADR 166, decision 3).
- **The cost of a long string.** `base64UrlToHash` decodes the full `updateHash` string before it checks the length. The cost is linear in the length. By default, the HTTP server limits a body string to 65,536 characters. The Nostr transport sends a plaintext of at most 65,535 bytes. At a receiver, nostr-tools 2.23.3 refuses a longer plaintext, but nostr-tools 2.23.4 and later accept it (ADR 153). `InMemoryTransport` and a direct caller of `receive()` have no limit.
- **The persistence of the nonce.** The participant keeps the nonce only in memory. The library does not persist `CohortCompleteInfo.smtProof`. The service cannot give the nonce again. The SMT appendix says: "If the DID controller does not have the `nonce`, the SMT Proof of that signal cannot be verified."
- **A transport with no inbound authentication.** `message.from` is only a claim on `InMemoryTransport` and on a custom transport with no sender authentication. It is also only a claim for a direct caller of the state machine. A party that sends messages with the DID of a member can submit a value for that DID before the member. The member then finds a wrong slot and vetoes the signal. ADR 152 records this case in the residual "The structure check and a transport with no inbound authentication".

**Superseded.**

- ADR 020, "Layer 2: State Machine (sans-I/O, explicit actions)": the getter `collectedUpdates` in the list of service getters. Decision 4 of this ADR renames it `collectedUpdateHashes`.
- ADR 027, T2.1: the mitigation "`maxUpdateSizeBytes` enforced in `AggregationService.#handleSubmitUpdate` before any expensive processing. Oversized updates are dropped with a diagnostic." "Consequences", "Positive": the words "oversized updates are dropped before expensive work". "Negative": the bullet that starts "The `maxUpdateSizeBytes` cap is a protocol parameter". Decision 3 of this ADR removes the cap. With the form check of decision 2, the service refuses each value that is not 32 bytes.
- ADR 027, T3: the value 1 in "`AGGREGATION_WIRE_VERSION = 1` is checked on every message at ingestion." Decision 11 of this ADR sets the value 2.
- ADR 029, "Context": the clause "giving the service operator no visibility into participant-service payloads". "Consequences": the premise "Mitigating factor: those payloads are already intended to be on-chain public data." "Explicitly accepted trade-offs": the bullet "Participants who require end-to-end privacy against the service operator should use the Nostr transport, which offers NIP-44 envelope encryption at the wire layer." The context of this ADR gives the reasons. Decision 1 of this ADR removes the update from SUBMIT_UPDATE.
- ADR 029, "Consequences", "Positive": the words "`SignedBTCR2Update` is signed at the payload layer;". The MuSig2 partial signatures still give non-repudiation of the aggregation output. Decision 1 of this ADR removes the update from SUBMIT_UPDATE, so no protocol message holds the update.
- ADR 041, decisions 3 and 4: the name `pendingUpdates`. Decision 4 of this ADR renames it `updateHashes`.
- ADR 041, decision 4: the words "`buildSMTTree` iterates the full participant list, not just `pendingUpdates`: an inclusion leaf for submitters, a non-inclusion leaf (`SHA-256(SHA-256(nonce))`) for decliners, with a per-slot nonce generated for every member as today". Decision 5: the words "emits `SUBMIT_NONINCLUDED`", for an SMT cohort. Decision 6: the sentence "The SMT strategy, for a decliner, skips the update-id requirement and recomputes `SHA-256(SHA-256(nonce))` before verifying the proof." Decisions 5 to 8 of this ADR replace these rules: the member makes the nonce, and the strategy uses the nonce of the member.
- ADR 041, "Accepted": the sentence "Nonces stay mandatory, so the non-inclusion leaf is always `SHA-256(SHA-256(nonce))` and never the literal zero." Also the clause "the service owns the SMT nonce as it does today", and the sentence "Participant-owned nonce persistence (the spec notes participants persist their nonces) is a later refinement, not part of this change." Decisions 5, 7, and 8 of this ADR replace them.
- ADR 042, decision 8: the words "or carries a non-inclusion leaf (`SHA-256(SHA-256(nonce))`", for a member that sends SUBMIT_NONINCLUDED in an SMT cohort. Decision 7 of this ADR leaves that index empty. A member that declines with the library participant still has the leaf value `hash(hash(nonce))` (decision 6).
- ADR 089, decision 5: the words "unlike the update-size cap declared immediately above it (`maxUpdateSizeBytes`, defaulting to `DEFAULT_MAX_UPDATE_SIZE_BYTES`), which a caller can size to its deployment". Decision 3 of this ADR removes the cap.
- ADR 090, the residual "`participantPk` is self-declared and not tied to the sender's DID": the clause "`#verifySubmittedUpdate` pins `proof.verificationMethod.split('#')[0] === sender` (`service/service.ts:667`), so the proof must at least name the sender's own DID." The service reads no proof. The map key or the leaf index binds the value to the DID of the sender, so the residual stays the "pollution of the sender's own DID". Decision 3 of this ADR removes the check.
- ADR 120, "Nonce mode stays the default": the words "and the aggregation cohort" in "The single-party `SMTBeacon.broadcastSignal` and the aggregation cohort build their entries with a 32-byte random nonce." Decision 5 of this ADR gives the nonce to the participant.
- ADR 147, decision 10, the first paragraph: the rule that the service takes the DID of a proof id with `split(/[?/#]/)[0]`. The service no longer reads a proof id. The "Superseded" block: the sentence "The service now takes the text before the first `?`, `/`, or `#` (decision 10)." in the ADR 090 bullet. Decision 3 of this ADR removes the check.
- ADR 152, decision 4, in full: `#submittedUpdateProblem`, its checks 1 to 3, the order "the body, `NOT_A_MEMBER`, the size cap, the new checks, then `DUPLICATE_RESPONSE`", the bullet "`UPDATE_SENDER_MISMATCH` is new (check 3).", and the bullet "`UPDATE_MALFORMED` now has four causes". Decision 9: the two rows that start "The service checks only the structure of the proof and the sender DID." and "The proof id must be the sender DID". Decisions 2 and 3 of this ADR replace them.
- ADR 152, "Consequences": the bullet "The service accepts an update that any key signed, if the proof names a DID URL of the sender DID." The public API break 6: the words "It adds `UPDATE_SENDER_MISMATCH`" and the sentence "A proof that is not an object, a `verificationMethod` that is not a string, or a `proofValue` that is empty or not a string gives `UPDATE_MALFORMED` (before: `UPDATE_VERIFICATION_FAILED`)." Decision 3 of this ADR removes these checks.
- ADR 152, the "Superseded" block: the ADR 147 bullet, and the sentence "The service checks only the structure of the proof and the sender DID (decision 4)." in the ADR 089 bullet. The "Unchanged" block: the bullet "ADR 147, decision 10: the DID of a proof id is the text before the first `?`, `/`, or `#`.", and the sentences "`#submittedUpdateProblem` now makes this check (decision 4). It also refuses a relative id and the bare DID." in the ADR 090 bullet. Decision 3 of this ADR removes these checks.
- ADR 153, decision 9: the bullet "The service checks only the structure and the sender DID of an update (ADR 152, decision 4)." The service gets no update, and it checks only the form of the `updateHash`. Decisions 1 to 3 of this ADR replace the rule.
- ADR 153, the residual "Metadata on the relay": the sentence "From the length, a reader can tell an update from a non-inclusion." Decision 6 of this ADR gives an SMT decline the type and the length of an update. The sentence stays true for a CAS cohort.
- ADR 153, "Unchanged": the sentence "A participant that needs privacy against the operator still uses the Nostr transport." in the ADR 029 bullet. The context of this ADR gives the reasons. Decision 1 of this ADR removes the update from SUBMIT_UPDATE.
- ADR 154, decision 7: the sentence "The service gives the same type for an update that it cannot canonicalize ("Update could not be canonicalized")." Decision 3 of this ADR removes the JCS step of the service.
- ADR 166, decision 2: the title "Each producer in this repository uses the check", the sentence "Each producer in this repository builds its tree with `addEntries`:", and the bullet "`AggregationCohort.buildSMTTree` (aggregation): `randomBytes(32)`." "Consequences": the words "and `AggregationCohort.buildSMTTree`" in the bullet "`SMTBeacon.broadcastSignal` and `AggregationCohort.buildSMTTree` do not change." Decisions 4 and 5 of this ADR move the nonce to the participant.

**Unchanged.**

- ADR 027, T3: each receiver checks the wire version of each message. Decision 11 of this ADR adds version 2.
- ADR 029, "Decision": TLS is the confidentiality layer of the HTTP transport. A signed envelope gives authenticity. The service still reads the plaintext of each directed message that it relays. Decision 1 of this ADR adds a SUBMIT_UPDATE that holds only a hash.
- ADR 041, decisions 1, 3, and 7: a member with no update stays in the cohort and signs. The gate is `hasAllResponses()`. `CohortCompleteInfo.included` stays. A CAS member with no update sends SUBMIT_NONINCLUDED and is absent from the map (decisions 2 and 4). Decision 7 of this ADR adds the empty index for SUBMIT_NONINCLUDED in an SMT cohort.
- ADR 089, decision 1: the participant binds the signal to the validated data with `deriveSignal`. Decision 8 of this ADR adds the `nonce` and the `updateId` of the member to the SMT Proof that it validates.
- ADR 089, decision 5: one inbound message cannot fail a cohort. Each receive handler checks what the message claims before it touches the cohort state. Decision 2 of this ADR adds a form check of the `updateHash`: the service records a rejection for a bad value and does not throw.
- ADR 120, "Nonce mode stays the default": each producer in this repository uses a 32-byte random nonce. Decision 5 of this ADR adds the participant as the producer of the nonce of an aggregate cohort.
- ADR 152, decision 1: the participant validates with the beacon type of its cohort. The residual "The structure check and a transport with no inbound authentication" stays for a submitted value (see the residuals above). Decision 8 of this ADR adds the values that the member kept to the validation.
- ADR 153, decision 8, rule 6: each directed Nostr message is a kind 1059 event with NIP-44 v2 content for the key of the recipient. Decision 6 of this ADR adds one message type and one message length for an update and for no update in an SMT cohort.
- ADR 166, decisions 1 and 3: `addEntries` refuses a nonce that is not 32 bytes, and the verifier accepts a nonce of any length. Decision 9 of this ADR adds a 32-byte nonce in `prepareSubmission` of the SMT strategy.

## Implementation

- `packages/aggregation/src/core/messages/base.ts`: `AGGREGATION_WIRE_VERSION = 2` and its JSDoc; `BaseBody.updateHash` replaces `signedUpdate`.
- `packages/aggregation/src/core/messages/bodies.ts`: `SubmitUpdateBody.updateHash` and its JSDoc; the JSDoc of `SubmitNonIncludedBody`; `isSubmitUpdateMessage` requires an `updateHash` string.
- `packages/aggregation/src/core/messages/factories.ts`: `createSubmitUpdateMessage` takes `updateHash`; the JSDoc.
- `packages/aggregation/src/core/cohort.ts`: `updateHashes`, `addUpdate(participantDid, updateHash)`, `buildCASAnnouncement`, and `buildSMTTree` with `zeroHashRoot`, `generateZeroHashProof`, `serializeProof`, and the skip of `cachedZero[0]`.
- `packages/aggregation/src/core/beacon-strategy.ts`: `BeaconSubmission`, `prepareSubmission` of both strategies, and the new parameters of `validateParticipantView`.
- `packages/aggregation/src/participant/participant.ts`: the state fields `updateHash`, `nonce`, and `updateId`; `submitUpdate` and `declineUpdate` call `#submit`; `#handleDistributeAggregatedData` gives the values that the member kept to the strategy; the JSDoc of `PendingValidation.smtProof` and `PendingValidation.expectedHash`.
- `packages/aggregation/src/participant/events.ts`: the JSDoc of `CohortCompleteInfo.smtProof` and `update-submitted`.
- `packages/aggregation/src/service/service.ts`: `#handleSubmitUpdate` with the form check; `collectedUpdateHashes`; the removal of `#submittedUpdateProblem`, `maxUpdateSizeBytes`, `DEFAULT_MAX_UPDATE_SIZE_BYTES`, `UPDATE_TOO_LARGE`, and `UPDATE_SENDER_MISMATCH`.
- `packages/aggregation/src/service/service-runner.ts`: the removal of `maxUpdateSizeBytes`.
- `packages/aggregation/src/service/events.ts`: the JSDoc of `update-received` and `message-rejected`.
- Docs: `packages/aggregation/README.md`, `packages/method/docs/aggregation.md`, `packages/method/docs/beacon-system-overview.md`, `packages/method/docs/http-transport.md`.
- Tests (`packages/aggregation/tests/`):
  - `aggregation-submit-update-hash.spec.ts` (new): the form check (6 values that are not a string, 7 strings that do not decode to 32 bytes), the string as sent, the CAS map, the SMT tree and its proofs with no nonce, the membership check before the decode check (step 4 of decision 2), and the refused value that is not an answer.
  - `aggregation-submit-proof-id.spec.ts` (removed): the tests of the sender check of ADR 152, decision 4.
  - `aggregation-noninclusion.spec.ts`: the empty index for SUBMIT_NONINCLUDED (decision 7), the skip of `cachedZero[0]` (decision 10), the strategy ignores a service nonce (decision 8), `prepareSubmission` of both strategies, the SMT decline sends SUBMIT_UPDATE (decision 6), and the CAS body `{ cohortId, updateHash }`.
  - `aggregation-receive-path-dos.spec.ts`: the helper `newUpdateHash()`; an `updateHash` that is not a string gets `UPDATE_MALFORMED`.
  - `aggregation-security.spec.ts`: T2.1, a 4 KiB `updateHash` gets `UPDATE_MALFORMED`.
  - `aggregation-cohort-binding.spec.ts`: the SMT Proof of `cohort-complete` has a nonce, and `verifyProof` returns `true` for it.
  - `aggregation-http-envelope.spec.ts`, `aggregation-transport-sender-auth.spec.ts`: the version values use `AGGREGATION_WIRE_VERSION`, not `1`.

## References

- did:btcr2 specification (main at commit `cc96c580`): [Aggregate Beacons](https://dcdpr.github.io/did-btcr2/beacons/aggregate-beacons.html) ("BTCR2 Update Aggregation", "Respond to Update Opportunities", "Step 3: Aggregate & Request Signal Confirmation", "Confirm Signal Request"), [Beacons](https://dcdpr.github.io/did-btcr2/beacons.html) ("SMT Beacon"), [Algorithms](https://dcdpr.github.io/did-btcr2/algorithms.html) ("SMT Proof Verification"), [Optimized Sparse Merkle Tree Implementation](https://dcdpr.github.io/did-btcr2/appendix/optimized-smt.html), [Privacy Considerations](https://dcdpr.github.io/did-btcr2/appendix/privacy-considerations.html) ("Updates Can Be Private", "Aggregation Services Only Need Hashes", "Aggregation Participants Provide DIDs to Aggregation Services").
- `packages/method/docs/aggregation.md`: the wire version.
- ADRs 020, 027, 029, 041, 042, 089, 090, 120, 147, 152, 153, 154, 166.

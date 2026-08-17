# @did-btcr2/aggregation

## 0.6.0

### Minor Changes

- Bind every member signature to the data it validated, authenticate a message's claimed sender, and keep one bad message from failing the cohort (ADRs 089, 090).

  - **BREAKING:** `AggregateBeaconStrategy` requires a `deriveSignal(result)` member, which recomputes the 32-byte signal from the data just validated (SHA-256 of the canonicalized CAS map, or the SMT root the member's proof was checked against). A participant approves only when the announced `signalBytesHex` equals it, so a coordinator can no longer distribute data that validates while anchoring a signal derived from different data, for instance a CAS map that omits the member. A strategy with nothing to derive from fails closed. Custom strategies must implement it.
  - **BREAKING:** a participant refuses to sign a beacon transaction unless the cohort data validated and the transaction spends exactly one input, carries exactly one OP_RETURN, places `OP_RETURN OP_PUSHBYTES_32 <validated signal>` in its last output (the only output resolution reads), burns nothing in that output, and spends no more than the input holds. A fallback request must additionally carry the optimistic round's session id and its exact transaction, or the member hands the coordinator two competing spends of one UTXO. New typed failures: `UNVALIDATED_DATA`, `INVALID_TX_STRUCTURE`, `INVALID_PREVOUT_VALUE`, `TX_MISMATCH`.
  - **BREAKING:** `NostrTransport` binds a message's self-declared `from` DID to the key that signed the event carrying it, and drops the event when they disagree or when the DID resolves to no key at all. Fail-closed: a transport built without the new `NostrTransportConfig.resolveSenderPk` receives only messages from peers registered through `registerPeer()`, and because that registry is bootstrapped by the advert and opt-in messages that are now dropped, a cohort will not form. Pass `resolveBtcr2SenderPk` from `@did-btcr2/method`; `TransportFactory` forwards it.
  - **BREAKING:** both HTTP transports bind the inner message's `from` to the authenticated envelope sender, and the server answers a mismatched advert with `401 sender_mismatch`. An advert is relayed verbatim to every subscriber and names the service DID a participant will join and the key it will encrypt to, so an unbound one lets any actor advertise a cohort in another DID's name.
  - **BREAKING:** a participant acts on a service-originated message (`COHORT_READY`, `DISTRIBUTE_AGGREGATED_DATA`, `AGGREGATED_NONCE`, `AUTHORIZATION_REQUEST`, `FALLBACK_AUTHORIZATION_REQUEST`) only when `from` is that cohort's service DID, and on an aggregated nonce only when it names the session the member is in. `COHORT_ADVERT` is exempt: it is what establishes the service DID.
  - **BREAKING:** `RejectionReason` gains `NOT_A_MEMBER`, `DUPLICATE_RESPONSE`, `INVALID_NONCE`, `INVALID_PARTIAL_SIG`, and `INVALID_PARTICIPANT_KEY`, and the double-submit and double-decline drops are recoded from `UPDATE_MALFORMED` to `DUPLICATE_RESPONSE`. Consumers switching exhaustively on the union, or matching the old codes, need updating.
  - Added `AggregationCohort.isValidCohortKey`, plus `BeaconSigningSession.isValidNonceContribution` and `verifyPartialSignature`: the checks that previously ran at cohort formation or round completion, hoisted so a receive path can apply them on arrival and blame the sender instead of the cohort.
  - Added `MAX_RETAINED_REJECTIONS` (256). The rejection log is written by anyone able to reach the service, so it is bounded for callers driving the state machine without draining it. Only diagnostics are dropped, never protocol traffic.
  - `AggregationService.receive()` no longer throws for any inbound message. Non-members, duplicate responses, unserializable update bodies, a non-string `proof.verificationMethod`, malformed nonces, invalid partial signatures, and opt-in keys that are not well-formed compressed secp256k1 points are recorded as rejections. Each of those was previously one message, from anyone able to reach the service, that failed the whole cohort.
  - `acceptParticipant` validates the opt-in key before it mutates cohort state, so a refusal can no longer leave a DID in `participants` with no key in the aggregate, which made the signing round permanently uncompletable.

### Patch Changes

- Updated dependencies []:
  - @did-btcr2/bitcoin@0.10.0
  - @did-btcr2/common@9.3.0
  - @did-btcr2/cryptosuite@10.0.0

## 0.5.0

### Minor Changes

- Typed errors for every error constructed in `src/` (ADR 085):

  - Cohort failures surface `AggregationCohortError` with types `COHORT_TTL_EXCEEDED`, `COHORT_PHASE_STALLED`, or `VALIDATION_REJECTED`, each carrying `cohortId` in `data` (validation rejections also carry the rejecting `participantDid`). Previously these were bare `Error(reason)`.
  - `InboxBuffer` rejects an invalid capacity with `AggregationServiceError` (type `INVALID_INBOX_CAPACITY`, `data.capacity`).
  - The participant HTTP client's internal sleep abort rejects with `HttpTransportError` (type `SLEEP_ABORTED`); this rejection never escapes the subscribe loops.

  Reason strings are unchanged.

### Patch Changes

- Updated dependencies []:
  - @did-btcr2/common@9.2.0

## 0.4.1

### Patch Changes

- Updated dependencies []:
  - @did-btcr2/bitcoin@0.9.0

## 0.4.0

### Minor Changes

- Authenticate EXTERNAL (x1) did:btcr2 identifiers on the aggregation HTTP transport (ADR 066)

  EXTERNAL (x1) DIDs can now join aggregation cohorts as first-class members over the HTTP
  transport, the way KEY (k1) DIDs already do. An x1 DID commits to the hash of its genesis
  document, so the controller carries that self-verifying genesis in-band on the cohort opt-in;
  the service recomputes the hash, derives the communication key from `capabilityInvocation[0]`
  (no `verificationMethod[0]` fallback), cross-checks it against the advertised
  `communicationPk`, verifies the envelope signature, and only then registers the peer. There
  is no trust-on-first-use.

  - `@did-btcr2/method`: `resolveBtcr2SenderPk(did, { genesisDocument })` is now genesis-aware
    (the one-argument form is unchanged: k1 to key, x1 to undefined), and a new exported
    `getAggregationCommunicationKey(document)` derives the aggregation communication key from
    `capabilityInvocation[0]`.
  - `@did-btcr2/aggregation`: the cohort opt-in body carries an optional `genesisDocument`; the
    HTTP server bootstraps an unregistered x1 sender from it, binds the inner `message.from` to
    the authenticated `envelope.from`, registers a bootstrapped peer only after the request
    clears every gate, and accepts a new `maxBodyBytes` transport option (413 on oversize). The
    package remains method-agnostic.

  Backward compatible: existing k1 opt-ins, one-argument resolver callers, and older
  participants are unaffected.

# @did-btcr2/aggregation

## 0.7.3

### Patch Changes

- The default config works in a browser with no proxy and no custom executor (ADR 124).

  - bitcoin: a GET request carries no `Content-Type`, so a browser sends no CORS preflight. `POST /tx` sends `text/plain` and the `RestConfig` headers, and the protocol ignores a `Content-Type` entry in `RestConfig.headers`. `HttpRequest` gets the optional field `fresh`, which `EsploraProtocol` sets on each endpoint whose response can change. The new export `createFetchExecutor({ timeoutMs? })` sends a fresh request with `cache: 'no-store'` and a random `_` query parameter. `defaultHttpExecutor` is `createFetchExecutor()`.
  - api: `BitcoinApi` uses `createFetchExecutor` for the default executor and for the `timeoutMs` executor. `DEFAULT_CAS_GATEWAY` is `https://trustless-gateway.link`, because `ipfs.io` redirects a raw-block read there with no CORS header.
  - cli: the docs and the config file example name the new default CAS gateway.
  - method, aggregation: dependency uptake.

- Updated dependencies []:
  - @did-btcr2/bitcoin@0.11.3

## 0.7.2

### Patch Changes

- The REST client returns the block height as a number.

  - bitcoin: `BitcoinBlock.count()` converts the `text/plain` body of the Esplora tip height to a number. Before, it returned the body as a string, for example `'601'`. A body that is not a non-negative integer raises `BitcoinRestError`.
  - method, aggregation, api, cli: dependency uptake.

- Updated dependencies []:
  - @did-btcr2/bitcoin@0.11.2

## 0.7.1

### Patch Changes

- The api exports the steps of a vector tool, and the SMT verifier rejects an empty sibling in `hashes` (ADR 122).

  - smt: the result of `verifyZeroHash`, `verifyProof`, and `verifySerializedProof` is `false` if a `0` bit of `collapsed` selects an entry of `hashes` that is equal to the cached zero of its level. This follows specification pull request 370. `serializeProof` writes the properties in the order of the SMT Proof data structure: `id`, `nonce`, `updateId`, `collapsed`, `hashes`. No root or hash changes.
  - method: `DidDocument.fromKeyIdentifier` sets the document `id` to the DID and the verification method id to `<did>#initialKey`. Before, the constructor threw `INVALID_DID_DOCUMENT` for each input.
  - api: the package root exports `canonicalHash`, `JSONPatch`, and `Appendix`.
  - aggregation, cli: dependency uptake.

- Updated dependencies []:
  - @did-btcr2/smt@0.4.1

## 0.7.0

### Minor Changes

- The SMT path follows the leaf values, the proof bit sequence, and the signal results of specification pull request 365 (ADR 120).

  - smt: `bitAt(i)` counts from the left, and `collapsed` follows the same sequence. `leafValue(nonce?, updateId?)` returns one of the four leaf values. `TreeEntry` is `{ did, nonce?, updateId? }`, with `updateId` the JSON Document Hash of the update. `verifyProof(proof, did)` verifies a serialized proof for a DID and returns `false` on a malformed proof. It never throws. `BTCR2MerkleTree.proof` returns an empty-index proof for a DID that is not in the tree. A nonce has any length. Breaking: every root and every proof changes. `TreeEntry.signedUpdate`, `inclusionLeafHash`, and `nonInclusionLeafHash` are gone.
  - common: the `INVALID_SIGNAL_DATA` error code.
  - method: the SMT beacon checks that the id of the proof is the signal root, verifies the proof with `verifyProof`, raises `INVALID_SIGNAL_DATA` on a failure, and produces no tuple for a proof without `updateId`. The resolver keeps `current_block_height` and drops a signal below it. `provide()` raises `INVALID_SIGNAL_DATA` for a signed update hash mismatch and for a malformed or mismatched SMT proof. It raises `MISSING_UPDATE_DATA` for a CAS announcement hash mismatch. Breaking: the error types of these failures change.
  - aggregation: the cohort builds its SMT entries with `updateId` and verifies the participant view with `verifyProof`.
  - api: a resolution that needs an SMT proof that the sidecar does not hold fails with a typed `ResolveError` of type `MISSING_UPDATE_DATA`. The vector build script adds SMT entries with `updateId`.
  - cli: documentation and dependency uptake.

### Patch Changes

- Updated dependencies []:
  - @did-btcr2/smt@0.4.0
  - @did-btcr2/common@9.7.0

## 0.6.3

### Patch Changes

- The resolver keys the processed beacon signals by beacon address (ADR 118).

  - method: the processed set of BeaconProcess is keyed by beacon address, not by service id. A rotated beacon whose old address carried a signal now resolves past the rotation. `Identifier.encode` rejects a numeric-string network such as `'5'`, which the numeric enum read as a network name and minted as a mainnet identifier.
  - bitcoin: the REST client reads the status before it parses the body. A non-OK status raises `FAILED_HTTP_REQUEST` with the status, the URL, and the body. An OK status with a body that is not JSON raises `INVALID_HTTP_RESPONSE`.
  - aggregation, api, cli: dependency uptake.

- Updated dependencies []:
  - @did-btcr2/bitcoin@0.11.1

## 0.6.2

### Patch Changes

- Updated dependencies []:
  - @did-btcr2/bitcoin@0.11.0
  - @did-btcr2/common@9.4.0

## 0.6.1

### Patch Changes

- Accept relative DID URLs everywhere in a DID document, and take the DID a beacon serves by injection (ADR 091).

  DID Core permits a verification method or service `id`, and the entries of a verification
  relationship, to be a relative DID URL (`#initialKey`). This implementation only ever produced
  the absolute spelling and in three places required it, so a conformant document using the
  relative form did not resolve.

  - `SMTBeacon` and `CASBeacon` recovered the DID by slicing their own `service.id` on `#`, which
    yields the empty string for a relative id. The SMT beacon then indexed the tree at
    `didToIndex('')` and failed proof verification; the CAS beacon looked up `announcement['']`
    and **silently skipped the update**, completing resolution against a stale document.
    `SMTBeacon.broadcastSignal` had the same slice on the write path.
  - `DidBtcr2.getSigningMethod` compared verification method ids as raw strings, so an absolute
    `proof.verificationMethod` never matched a relative `verificationMethod[].id`.

  Beacons now take the DID they serve as a required constructor argument.
  `BeaconFactory.establish(service, did)` threads it, the `Resolver` supplies
  `currentDocument.id`, `Updater.announce(beaconService, did, ...)` takes it as a parameter, and
  `NeedBroadcast` carries a `did` field. Verification method lookup resolves both sides to
  absolute DID URLs first, via the new `Appendix.absoluteDidUrl`, which the read path's
  `capabilityInvocation` check now shares. Comparison is on the resolved URL rather than the
  fragment, so a reference naming a different DID still cannot match. The unused and misnamed
  `Appendix.extractDidFragment`, which returned its input unchanged, is removed.

  Breaking: the beacon constructors, `BeaconFactory.establish`, and `Updater.announce` each take
  one more required argument.

  `AggregationService` also rejected a relative `proof.verificationMethod` on the opt-in path
  when checking that a submission is signed by its sender's own key. That failed closed, so it
  was never a trust gap, but it turned away a legal spelling; the signing key is pinned by the
  opt-in record regardless, so the relative form now resolves to the sender.

  Together these let the danubetech `uni-resolver-driver-did-btcr2` examples 11a-b and 12a-b, two
  aggregate SMT cohorts on mutinynet, resolve to version 2.

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

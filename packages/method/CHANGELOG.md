# @did-btcr2/method

## 0.55.0

### Minor Changes

- `Appendix.getVerificationMethods` throws a typed `DidDocumentError` from `@did-btcr2/common` instead of a bare `TypeError` when called without a `didDocument` (ADR 085). Message unchanged.

### Patch Changes

- Updated dependencies []:
  - @did-btcr2/common@9.2.0

## 0.54.1

### Patch Changes

- Updated dependencies []:
  - @did-btcr2/bitcoin@0.9.0

## 0.54.0

### Minor Changes

- Beacon broadcasts return structured artifacts, and CAS publication precedes the on-chain spend (ADR 070).

  - `broadcastSignal` on all three beacons (Singleton, CAS, SMT) now returns a `BroadcastResult` (`{ signedUpdate, txid, announcement?, proof? }`) instead of echoing the `SignedBTCR2Update`. Callers that used the return value directly should read `result.signedUpdate`.
  - SMT beacon broadcasts return the Merkle inclusion proof (leaf nonce embedded). Previously the proof and nonce were discarded, which made every single-party SMT signal permanently unresolvable; capture `result.proof` for sidecar distribution.
  - CAS beacon broadcasts return the CAS Announcement, so sidecar-only controllers can capture the object a resolver needs.
  - **Semantic change:** the CAS beacon now invokes `casPublish` **before** broadcasting the signal transaction. A publish failure aborts the operation while the beacon UTXO is still unspent; retries are idempotent (content-addressed re-publish).
  - `Updater.announce` accepts an options parameter (fee estimator, change address, `casPublish`) and returns the `BroadcastResult`.

## 0.53.0

### Minor Changes

- Fix versionTime queries against duplicate-containing histories and guard duplicate confirmation (ADR 068)

  Updates sort by targetVersionId before block height, so a duplicate re-announcement of an
  early version mined after the queried versionTime used to trip the versionTime early-return
  before genuine in-window updates were processed, silently resolving to an earlier version
  than the one valid at the query point. Duplicates are now confirmed before the versionTime
  check, so a re-announcement (or third-party replay) mined after versionTime can no longer
  truncate the in-window history, and a false duplicate of an in-window version now fails
  resolution with `LATE_PUBLISHING_ERROR` instead of being masked by the early return. Separately, the duplicate-confirmation history read is now guarded: a crafted
  `targetVersionId` that is not an integer of at least 2 raises a typed `INVALID_DID_UPDATE`
  (and is rejected at the `provide()` boundary), and an unconfirmable duplicate whose history
  slot does not exist raises `LATE_PUBLISHING_ERROR`, where both previously crashed with a raw
  `TypeError`. The versionTime reorder is a deliberate, traced deviation from the current spec
  step order, pursued upstream as an erratum alongside ADR 067's; see ADR 068.

## 0.52.0

### Minor Changes

- Fix resolver duplicate-update confirmation so a re-announced update no longer bricks resolution (ADR 067)

  A confirmed duplicate update (the same version announced more than once on chain, for
  example on two of a k1 DID's own beacons or replayed by a third party at another derivable
  beacon address) no longer advances the version counter. `Resolver.updates()` now increments
  `current_version_id`, and the `versionId` it reports, only on the apply path, and confirms a
  duplicate against the update-hash history without appending to it. This removes a `versionId`
  inflation that mis-classified the next genuine update and raised a false `LATE_PUBLISHING_ERROR`,
  bricking an otherwise-valid linear history in a single discovery round and across rounds. The
  duplicate-confirmation guard still rejects an update that claims an already-used version but
  carries different content. This is a deliberate, traced deviation from the current spec prose on
  when the counter increments, pursued upstream as a spec erratum; see ADR 067.

## 0.51.0

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

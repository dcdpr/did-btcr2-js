# @did-btcr2/method

## 0.58.0

### Minor Changes

- Apply the relative DID URL rule to the write path and to proof references (ADR 092).

  [ADR 091](https://github.com/dcdpr/did-btcr2-js/blob/main/docs/adr/091-inject-did-into-beacons-and-relative-did-urls.md)
  decided that both spellings of a DID URL resolve to the absolute form before being compared, and
  applied it to the read path. Four sites were left comparing raw strings, so a document written in
  the relative spelling resolved but could not be updated.

  - `DidBtcr2.update` compared `capabilityInvocation` membership and the `beaconId` service lookup
    as raw strings, one line before delegating to `getSigningMethod`, which resolves both sides.
    A caller holding a relative-spelling document could not name its own key or its own beacon in
    any spelling the factory accepted. Both comparisons now resolve each side against the document.
  - `Updater.sign` put the document's spelling of the method id into the proof's
    `verificationMethod`. For a relative document that is a bare `#initialKey`, which resolves
    against nothing once the proof leaves the document, and the cryptosuite refused to serialize
    it, so such a document could not be signed for at all. The proof now names the method by
    absolute DID URL. A document that already spells its ids absolutely produces a byte-identical
    proof, so no existing test vector changes.
  - `getAggregationCommunicationKey` dereferenced `capabilityInvocation[0]` against
    `verificationMethod[].id` by raw comparison, so an EXTERNAL sender whose genesis document mixes
    spellings derived no communication key and could not be authenticated on either transport.
  - `getSigningMethod` compared its resolved target without first rejecting an unusable one, so a
    lookup with an empty method id returned the document's first malformed verification method.
    Every comparison now rejects an unusable target before comparing.

  Adds `Appendix.relationshipMethodId(entry, did)`, which resolves a verification relationship
  entry (a reference, or a method embedded inline that names itself with its own `id`) to an
  absolute DID URL. The read path's membership check, the write path's membership check, and the
  `assertionMethod` fallback in the method lookup now share it, so all three admit exactly the same
  spellings.

  Comparison remains on the resolved absolute URL rather than the bare fragment, so a reference
  naming a different DID still cannot match. A verification method whose `controller` is some DID
  other than the document subject still fails, and still fails at signing time rather than at
  resolution.

## 0.57.0

### Minor Changes

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

## 0.56.0

### Minor Changes

- Require `capabilityInvocation` authorization on the read path, and recognize beacon signals from the spending transaction's script (ADRs 086, 088).

  - **BREAKING:** resolution rejects an update whose `proof.verificationMethod` is not listed in the contemporary document's `capabilityInvocation`, with a typed `INVALID_DID_UPDATE`, per the spec's "Check update.proof" step. Locating the method in `verificationMethod[]` and verifying its signature was not sufficient on its own: a key published only for authentication, or under no relationship at all, could authorize an update on the read path, where the write path has always refused. Bare-fragment entries and embedded verification methods are normalized against the document id before comparison, so a reference naming another DID cannot collapse onto this one. **A DID whose history was signed by a key outside `capabilityInvocation` no longer resolves**, including an EXTERNAL genesis document that omits the relationship entirely.
  - **BREAKING:** `extractOpReturnSignal(asm)` is now `extractOpReturnSignalHash(scriptPubKey)` and takes the serialized script rather than a rendered `asm` string. `asm` is a per-backend rendering (Bitcoin Core prints `OP_RETURN <hash>`, Esplora prints `OP_RETURN OP_PUSHBYTES_32 <hash>`), so an asm-shaped check written against one backend silently discards every signal from the other. The serialized script is identical on both and is what is committed to the chain. The accepted set of signals is unchanged.
  - **BREAKING:** `BeaconUtils.getBeaconServicesMap` is removed. Its only caller needs the caller's own service objects, which the map replaced with re-parsed copies, breaking the identity-keyed result map it feeds. Build the map inline with `BeaconUtils.parseBitcoinAddress`.
  - Indexer discovery requires a candidate transaction to spend an output of the beacon address before its OP_RETURN is read as a signal. An address transaction listing returns inbound payments too, so anyone able to pay dust to a beacon address could attach a 32-byte OP_RETURN and have it resolved as that beacon's signal, which permanently fails resolution for a hash no one can fulfil. The spent output is read from the embedded `vin[].prevout`, and from the funding transaction when a backend omits it, so a missing field cannot drop a real signal.
  - Full-node discovery reads the signal from the last output of the spending transaction rather than from the output being spent, which carries a plain locking script and never a signal: the path previously discovered nothing at all, and every resolver driven by it returned a stale document with no error. One transaction now yields one signal per beacon however many of that beacon's UTXOs it spends.

### Patch Changes

- Updated dependencies []:
  - @did-btcr2/bitcoin@0.10.0
  - @did-btcr2/common@9.3.0
  - @did-btcr2/cryptosuite@10.0.0

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

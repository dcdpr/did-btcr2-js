# Security Audit Report: did-btcr2-js

Date: 2026-08-03
Scope: all ten packages (`common`, `smt`, `keypair`, `cryptosuite`, `bitcoin`, `key-manager`, `method`, `aggregation`, `api`, `cli`), plus pinned dependency sources (`@noble/*`, `@scure/*`, `fast-json-patch`, `json-canonicalize`).
Method: manual code audit by parallel review agents, findings verified against actual source. `pnpm audit --prod`: no known vulnerabilities.

Findings marked **[v]** were re-verified in a second-pass audit (see bottom).

---

## Critical

### C1. Nostr transport has no DID-level sender authentication
**File:** `packages/aggregation/src/core/transport/nostr.ts:413-507` (`#makeActorEventHandler`, `#dispatchMessage`, `#handleBroadcastEvent`)

Inbound messages are dispatched to state machines with `message.from` taken at face value. Kind-1 keygen messages (COHORT_ADVERT, COHORT_OPT_IN, COHORT_OPT_IN_ACCEPT, COHORT_READY) are plaintext JSON; the Nostr event signature proves only control of some Nostr key, never bound to the claimed DID. Kind-1059 messages are NIP-44 encrypted, which authenticates the sender's Nostr key, but `#dispatchMessage` never checks `event.pubkey` against the peer-registry key for `message.from` (the registry is only used for *sending*, nostr.ts:293-298, 321-328). There is no equivalent of the HTTP transport's `verifyEnvelope` / `flat.from === envelope.from` binding.

**Exploitation:** Attacker publishes a kind-1 COHORT_ADVERT claiming `from: <realServiceDid>`; victim's runner joins (`shouldJoin` only inspects advert fields); attacker sends COHORT_OPT_IN_ACCEPT / COHORT_READY with attacker-chosen `cohortKeys` (including the victim's key, so `validateMembership` at `cohort.ts:243` passes); drives DISTRIBUTE_AGGREGATED_DATA / AUTHORIZATION_REQUEST; the victim (default `onApproveSigning: approve`, participant-runner.ts:140) produces a MuSig2 partial signature and emits `cohort-complete` carrying the **attacker-controlled beacon address**, which the reference flow tells the user to add to their DID document. Against the service: spoofed COHORT_OPT_IN poisons `pendingOptIns` (blocking the real victim via the re-opt-in guard, service.ts:329), spoofed VALIDATION_ACK registers fake consent, spoofed SIGNATURE_AUTHORIZATION aborts the cohort.

**Recommendation:** Gate the Nostr transport behind an envelope-signature scheme like HTTP's, or document it as dev-only.

---

## High

### H1. Resolver never checks `capabilityInvocation` membership for the update's verification method
**File:** `packages/method/src/core/resolver.ts:596-611` (`applyUpdate`), `packages/method/src/did-btcr2.ts:242-267` (`getSigningMethod`)

The spec ("Check update.proof") mandates: raise INVALID_DID_UPDATE if `current_document.capabilityInvocation` does not contain `update.proof.verificationMethod`. The implementation only does `getSigningMethod(currentDocument, verificationMethodId)`, which searches `didDocument.verificationMethod` (did-btcr2.ts:254-257) and never consults `capabilityInvocation`. The write path enforces this (`DidBtcr2.update`, did-btcr2.ts:175-180), so the authorization invariant depends entirely on the read path, which lacks it.

**Exploitation:** A DID controller lists an extra key in `verificationMethod` authorized only for `authentication`/`assertionMethod`. Whoever holds that key can craft an update (valid capability URN, valid BIP340 proof) that the resolver accepts. The patch can replace all keys, rotate beacons, or deactivate the DID: full DID takeover by an unauthorized key.

### H2. Inverted domain check in proof verification
**File:** `packages/cryptosuite/src/data-integrity-proof/index.ts:127-143`

```ts
if(expectedDomain.length !== proof.domain?.length) { throw ... }
else if(expectedDomain.every(url => proof.domain?.includes(url))) { throw 'do not match' }
```

The second branch throws when the domains **do** match and falls through silently when one or more expected domains are **missing**. When `proof.domain` is a string and `expectedDomain` is an array, `String.prototype.includes` performs substring matching and `length` compares string length to array length; both wrong.

**Exploitation:** A proof created for a different domain than the verifier expects passes domain validation, defeating the anti-replay purpose of `domain`. Cross-domain replay of signed updates/VCs is accepted.

### H3. Secret key material leaks via `SchnorrMultikey.toJSON()`
**File:** `packages/cryptosuite/src/multikey/index.ts:218-227` (via `SchnorrKeyPair.exportJSON()` at `packages/keypair/src/pair.ts:181-192` and `Secp256k1SecretKey.exportJSON()` at `packages/keypair/src/secret.ts:224-230`)

`toJSON()` calls `this.keyPair.exportJSON()`, embedding `{ bytes, seed, hex }` of the secret key. `toJSON` is invoked implicitly by `JSON.stringify()`. The keypair classes deliberately made their own `toJSON()` public-key-only with a separate explicit `exportJSON()`; the multikey defeats that protection.

**Exploitation:** Any logging/error/telemetry path that does `JSON.stringify(multikey)` (or stringifies an object containing one, e.g. `CryptosuiteError` `data` embedding `this` at cryptosuite/index.ts:195,203,213,233,258) writes raw secp256k1 secret keys to logs/disk. Log access equals DID update-key theft.

### H4. RPC password accepted via CLI argv
**File:** `packages/cli/src/cli.ts:56` (`.option('--btc-rpc-pass <pass>', ...)`)

The keystore passphrase is deliberately never accepted as a flag (see `keystore/passphrase.ts:36-40`, which documents exactly this threat), but the Bitcoin Core RPC password is. argv is visible in `ps`, `/proc/<pid>/cmdline`, shell history, CI logs. The RPC password guards a potentially funded hot wallet (`sendtoaddress`, `signrawtransactionwithwallet`). Mitigations exist (`BTCR2_BTC_RPC_PASS`, `BTCR2_BTC_RPC_PASS_FILE`, `env:`/`file:` secret refs); the flag should be removed or deprecated.

### H5. Full-node beacon signal discovery extracts the signal from the spent prevout, not the spending transaction
**File:** `packages/method/src/core/beacon/signal-discovery.ts:198-241` (esp. 223-227)

After identifying that a tx spends *from* a beacon address, the code reads `prevout.vout[vin.vout].scriptPubKey.asm` (the funding output's script, never an OP_RETURN) and runs `extractOpReturnSignal` on it, always returning `null`. The signal should be read from the *current* transaction's last `vout` (as `indexer` correctly does at line 87-106). Result: full-node discovery finds zero signals, ever. Fails safe (no forgery), but resolution via the full-node path silently returns stale documents while reporting success.

### H6. Single-message cohort kill: untrusted-input throws escape `receive()` and fail the whole cohort
**Files:** `packages/aggregation/src/service/service.ts:509,680,754,806,810`; `packages/aggregation/src/core/cohort.ts:278-284,393-399`; `packages/aggregation/src/core/signing-session.ts:98-128,142-166,216-220`; `packages/aggregation/src/service/service-runner.ts:724-726,751-753,799-801,824-826,855-857,881-883`

`#handleSubmitNonInclusion` deliberately converts non-member input into a silent rejection because a throw would "fail the whole cohort, a DoS any non-member could trigger", but the same pattern was not applied elsewhere: `addUpdate` throws `UNKNOWN_PARTICIPANT` for opted-in-but-not-accepted senders; `addValidation` throws for any non-member VALIDATION_ACK (no precondition); `addNonceContribution`/`addPartialSignature` throw `DUPLICATE_NONCE`/`UNKNOWN_PARTICIPANT`; `generateFinalSignature` throws `BAD_PARTIAL_SIG`. Every runner handler wraps `session.receive()` in try/catch that calls `#failCohort`, deleting cohort state. `autoFallbackOnStall` cannot help (fires on stall timer, not failure).

**Exploitation:** Over HTTP, any party that bootstrap-registers a self-certifying x1 DID (http-server.ts:599-626 accepts any valid genesis) sends one VALIDATION_ACK naming a victim `cohortId` during `DataDistributed`; the cohort dies. A single member can kill the cohort at will with a duplicate nonce or garbage partial signature.

### H7. Participant state machine never verifies the service is the sender
**File:** `packages/aggregation/src/participant/participant.ts:337-353, 434-474, 528-549, 633-645, 694-727`

`#handleCohortReady`, `#handleDistributeAggregatedData`, `#handleAuthorizationRequest`, `#handleAggregatedNonce`, `#handleFallbackAuthorizationRequest` check only `cohortId` and phase, never `message.from === state.serviceDid`. `serviceDid` itself is adopted from an unauthenticated advert (participant.ts:256). Directly exploitable end-to-end over Nostr (C1); over HTTP only because the server is the sole inbox writer. One-line check missing per handler.

### H8. VALIDATION_ACK is not bound to the distributed data
**Files:** `packages/aggregation/src/core/messages/factories.ts:170-173`; `packages/aggregation/src/service/service.ts:670-689`

The ack body is only `{ cohortId, approved }`; it does not commit to `signalBytesHex`, the CAS announcement hash, the SMT root, or a round/session id. The service accepts it as approval of whatever data it most recently distributed. Combined with C1 or any injection path, an attacker fabricates `approved: true` and the service starts signing without the victim reviewing the data. The ack should carry (and the service check) the signal hash being approved.

---

## Medium

### M1. Patched document's `id` never checked against the resolved DID
**File:** `packages/method/src/core/resolver.ts:630-649`
Spec ("Apply update") requires verifying `current_document.id === did`. `applyUpdate` only calls `DidDocument.validate(updatedDocument)`, which checks the id parses as *some* valid did:btcr2 identifier, not that it equals the queried DID. The write path enforces id equality (`updater.ts:229-234`); the resolve path does not. Anyone able to get an update applied (see H1) can rebind the document id.

### M2. `versionId` check runs after applying an update, returning a newer version than requested
**File:** `packages/method/src/core/resolver.ts:484-494`
Spec evaluates `current_version_id >= resolutionOptions.versionId` before processing each tuple; here it runs after apply+increment. With `versionId: "1"` and updates present, the resolver returns the version-2 document. Time-travel resolution is broken.

### M3. `#processedServices` keyed by `service.id`: beacon address rotation silently drops updates
**File:** `packages/method/src/core/resolver.ts:199, 722-737`
`#requestCache` dedupes discovery rounds by *address*, but `#processedServices` dedupes processing by *service id*. If an update rotates a beacon to a new address while keeping the service id, round 2 queries the new address but the BeaconProcess loop skips the service as already processed. All updates on the rotated address are silently ignored; resolution completes with a stale document and no error.

### M4. No `minConf` enforcement on beacon signals
**File:** `packages/method/src/core/beacon/signal-discovery.ts:111-124`, `packages/method/src/core/interfaces.ts:19-49`
Spec: a tx MUST have at least `resolutionOptions.minConf` confirmations (6 default). `ResolutionOptions` has no `minConf` field; `indexer` accepts any confirmed tx regardless of depth. Shallow-block announcements are applied and then erased by reorgs.

### M5. Participants sign transactions checking only the OP_RETURN signal
**File:** `packages/aggregation/src/participant/participant.ts:46-61, 559-573, 596-631, 752-768`
Both `approveNonce` and `approveFallback` validate the service-supplied transaction solely via `txEmbedsSignal`; they never verify the input spends the cohort's beacon UTXO, that `prevOutScriptHex` matches the locally computed beacon address script, or that non-signal outputs (change, fee) are sane. A malicious coordinator can direct change to itself or burn the UTXO as fee. Direct theft once the reserved `participant-funded` model (recovery-policy.ts:37) lands; griefing today.

### M6. Unbounded state growth / participant-count DoS
**Files:** `packages/aggregation/src/service/service.ts:331` (unbounded `pendingOptIns`), `packages/aggregation/src/core/conditions.ts:45` (`maxParticipants` optional), `packages/aggregation/src/service/service-runner.ts:273` (default auto-accept), `packages/aggregation/src/service/rate-limiter.ts:16-26` (bucket map never evicted), `packages/aggregation/src/participant/participant.ts:262` (`#cohortStates` never pruned)
HTTP bootstrap lets an attacker mint unlimited self-certifying DIDs, multiplying rate limits and memory. Sustained low-bandwidth attack inflates service memory and can produce thousand-key MuSig2 cohorts (finalize-time CPU/memory blowup).

### M7. Basic-auth RPC credentials sent over cleartext HTTP with no warning
**File:** `packages/bitcoin/src/client/rpc/protocol.ts:44-78`
`JsonRpcProtocol` accepts any `host` scheme; `http://remote-node` with credentials sends the Basic `Authorization` header unencrypted with no scheme check or warning. Same for `--btc-rpc-header Authorization: ...` (config.ts:620).

### M8. No confirmation before on-chain broadcast; uncapped `--fee-rate`
**Files:** `packages/cli/src/commands/update.ts:110-122`, `deactivate.ts:110-122`, `packages/cli/src/config.ts:811-821` (`parseFeeRate` rejects only `<= 0`)
Update/deactivate construct, sign, and broadcast spending the beacon UTXO in one step; deactivation is self-described as irreversible yet has no confirmation even on mainnet. A fat-fingered `--fee-rate 50000` is accepted with no sanity ceiling and no display of the absolute fee before broadcast.

### M9. Batch RPC response re-sorting uses mutable request counter at parse time
**File:** `packages/bitcoin/src/client/rpc/protocol.ts:136-157`
`parseBatchResponse` reconstructs expected IDs from `this._id` at parse time. Any interleaved `buildRequest` between `buildBatchRequest` and `parseBatchResponse` shifts `startId` and maps every result to the wrong method; misaligned `getrawtransaction` results are then trusted downstream. IDs should be captured on the request descriptor at build time.

### M10. Two inconsistent ECDSA signing contracts
**Files:** `packages/keypair/src/secret.ts:275-277`, `packages/keypair/src/public.ts:309-311` vs `packages/keypair/src/signer.ts:40-46`, `packages/key-manager/src/local-key-manager.ts:183-190`
`signWithScheme('ecdsa')` uses `{ format: 'der', lowS: true, prehash: false }`; the class-level `Secp256k1SecretKey.sign(..., 'ecdsa')` / `verify` use noble defaults (`compact`, `prehash: true` in v2). Passing a 32-byte sighash to the class path signs `sha256(sighash)` and yields compact format: unspendable txs / cross-API verification failures. Latent (no current src caller uses the class-level ecdsa path).

### M11. Unvalidated trust of Esplora/RPC response data
**Files:** `packages/bitcoin/src/client/rest/transaction.ts:30-33`, `rest/index.ts:56-73`, `rpc/index.ts:87-100`
Responses parsed and trusted without structural validation; amounts, UTXO sets, confirmation status flow into resolution and funding decisions. A malicious Esplora endpoint can censor updates or crash the client. No response size limit (`res.json()` on unbounded body is memory-DoS).

### M12. SMT zero-hash proof generation is O(256^2 * n) per proof, uncached
**File:** `packages/smt/src/zero-hash.ts:66-107`, `packages/smt/src/btcr2-tree.ts:87-101`
`generateZeroHashProof` scans all leaves at each of 256 levels with O(leaves x height) `subtreeHash` per level; `BTCR2MerkleTree.proof()` recomputes from scratch per call. For a 10k-entry cohort: hundreds of millions of SHA-256 compressions per proof. Builder-side DoS; pushes operators toward smaller, less private cohorts.

---

## Low

- **L1.** `LocalKeyManager.getPublicKey()`/`getEntry()` return live store buffers by reference (`local-key-manager.ts:122-124, 133-136`); callers can corrupt stored entries in place.
- **L2.** Zeroization claims partially false: `#multibase` string and `#seed` bigint persist after `destroy()`; `wipe()` never called after signing pulls raw bytes (`keypair/src/secret.ts:87,139-143`, `utils.ts`). Documentation overstates the guarantee.
- **L3.** `created`/`expires` never enforced at verification (`cryptosuite/index.ts:207-215`, `data-integrity-proof/index.ts:83-162`); captured proofs remain valid indefinitely.
- **L4.** `addProof` domain/challenge checks are vacuous (proof object aliases caller's config, self-comparison never fails); caller's document mutated in place (`cryptosuite/index.ts:87-103`, `data-integrity-proof/index.ts:45-68`).
- **L5.** `Secp256k1SecretKey.decode()` returns 34 bytes including multicodec prefix instead of slicing (`secret.ts:291-319`). Test-only today; footgun.
- **L6.** `SchnorrKeyPair.secretKey` getter returns the live instance despite "copy" comment (`pair.ts:89-101`); holders can `destroy()` or export the secret.
- **L7.** Untyped raw throws on malformed untrusted data crash resolution instead of typed errors: `cas-beacon.ts:114`, `smt-beacon.ts:85-88`, `resolver.ts:355,453,640`, `identifier.ts:147`. A malicious CAS aggregate operator can crash every resolver of every DID in an announcement.
- **L8.** `metadata.confirmations`/`updated` overwritten by later duplicate announcements (`resolver.ts:413-417, 432-435`); misleading confirmation counts.
- **L9.** `dereferenceZcapId` length check is dead code; trailing segments silently ignored (`appendix.ts:164-169`).
- **L10.** `JSONPatch.validateOperations` unbounded patch size/complexity (`common/src/json-patch.ts:102-113`); prototype pollution itself blocked by fast-json-patch defaults.
- **L11.** Credentials logged on invalid RPC URL (`protocol.ts:58-60` prints raw URL before userinfo strip); REST errors embed URL with possible userinfo (`rest/index.ts:56-73`); `response.json()` before `response.ok` masks HTTP errors.
- **L12.** `profile add __proto__` unguarded (`cli/src/commands/profile.ts:14-24`; `config set` is guarded).
- **L13.** `key import --secret-file` no permission check on the secret file (`cli/src/commands/key.ts:162-170`).
- **L14.** `btcToSats` exponential-notation and `Number.EPSILON` edge cases (`bitcoin/src/connection.ts:79-87`).
- **L15.** `config set` plaintext RPC password at rest with no warning (`cli/src/config.ts:145-151`); `resolveSecretRef` prefix ambiguity and silent-undefined typos (`config.ts:756-766`).
- **L16.** Recovery secret key not wiped (`aggregation/src/core/recovery-spend.ts:129,189`); secret nonce overwritten without wipe on repeated `generateNonceContribution` (`signing-session.ts:235`).
- **L17.** HTTP body cap (64 KiB, http-server.ts:137) contradicts update-size cap (256 KiB, service.ts:127); legitimate updates 64-256 KiB rejected.
- **L18.** Nonce-cache single global FIFO eviction reopens a small replay window (`aggregation/.../nonce-cache.ts:28-37`); `remoteAddr` accepted but never used.
- **L19.** Update document id not checked against sender DID (`service.ts:578-605`); member can anchor an update naming a different DID in its own slot (griefing only; resolution-side rejection expected).
- **L20.** Nostr stale-history replay: directed subscription has no `since` filter, messages carry no timestamp/nonce (`nostr.ts:395-399`).
- **L21.** Fallback authorization request not bound to in-flight session id on the participant side (`participant.ts:694-727`).

## Info

- **I1.** Identifier bech32m decode has no length cap (`identifier.ts:147`); work is O(n) and downstream length checks gate acceptance.
- **I2.** Complete-phase metadata echoes the *requested* `versionId` when no updates applied (`resolver.ts:803-811`).
- **I3.** DID-document type sniffing by substring `id.includes('k1')` misclassifies EXTERNAL DIDs whose payload contains `k1` (`did-document.ts:198-200`).
- **I4.** `capabilityAction: 'Write'` signed but never checked at resolve time (`resolver.ts:570-653`).
- **I5.** Custom-network KEY-type DIDs decode but cannot be re-encoded (`identifier.ts:181-183` vs 76-82); unresolvable.
- **I6.** `deactivated` type confusion: any truthy non-boolean accepted (`resolver.ts:497`).
- **I7.** Plain-object vs class-instance hashing asymmetry between patched and genesis documents (`resolver.ts:631`); interop divergence risk.
- **I8.** Session passphrase cached as base64url, protected by 0600 perms only (ADR 081 tradeoff; `cli/src/keystore/session.ts:13-18`).
- **I9.** No Bitcoin Core cookie auth; only static rpcuser/rpcpassword (`rpc/protocol.ts:48`).
- **I10.** `BTCR2_KEYSTORE_PASSPHRASE` env var readable via `/proc/<pid>/environ` (documented).
- **I11.** Default 5 sat/vB static fee on all networks (`fee-estimator.ts:39`).
- **I12.** `canonicalize()` leaks raw `TypeError` on non-JSON input (`common/src/canonicalization.ts:60`).
- **I13.** `DateUtils.dateStringToTimestamp` silently returns epoch on invalid input (`common/src/utils/date.ts:40-46`).
- **I14.** `@web5/dids@1.2.0` pulled into cli for a single type; heavy dependency tree.

## Verified safe (no finding)

- **Randomness:** all key/nonce generation via `randomBytes` from `@noble/hashes`; no `Math.random` anywhere.
- **BIP340:** noble uses proper tagged hashes, `lift_x` validation, rejects infinity/zero/out-of-range; deterministic nonces.
- **ECDSA:** noble v2 defaults `lowS: true` in sign and verify; high-S rejected.
- **Taproot tweak:** `@scure/btc-signer` `taprootTweakPrivKey` correctly negates odd-Y secrets; `bip341` verify correctly refused.
- **Public key validation:** length + on-curve + pairing checks on import; watch-only entries throw on `sign()`.
- **Cryptosuite hashing:** `sha256(sha256(canonConfig) || sha256(canonDoc))` per spec; canonicalization before hashing.
- **Constant-time comparisons** for secret/public key equality (noble `equalBytes`).
- **Genesis-identifier binding:** KEY derives from pubkey; EXTERNAL recomputes and byte-compares canonical hash (`resolver.ts:263-328`).
- **Update chain integrity:** sourceHash binding, strict version sequencing, duplicate confirmation, targetHash verification all enforced.
- **Proof verification:** whole-update binding via `H(H(config)||H(doc))`, proofPurpose/cryptosuite/type checks, verificationMethod binding; key from current document.
- **CAS/SMT:** both hash hops verified; SMT proofs verified against on-chain root with MSB-first walk, constant-time compare, exact hash-count exhaustion; non-inclusion proofs verified.
- **JSON patch:** fast-json-patch 3.1.1 bans `__proto__`/`constructor`/`prototype` by default; not disabled.
- **MuSig2 core:** BIP-327 via scure `keyAggregate` (rogue-key resistant); fresh `randomBytes(32)` per nonceGen; secret nonce wiped on all terminal paths; per-signer `partialSigVerify`; duplicate guards; sign-once-per-nonce (two-signatures-one-nonce key extraction not reachable).
- **HTTP transport:** signed envelopes, JCS-hashed canonical form, 60s skew, replay cache, per-DID token bucket, sender binding, genesis bootstrap cross-check, no TOFU.
- **Keystore:** argon2id (64 MiB/3/4) + XChaCha20-Poly1305, AAD, verifier sentinel, constant-time compare, 0600 perms, atomic writes, locking, mainnet dev-keystore refusal.
- **CLI secrets hygiene:** passphrase prompt non-echoing, never via argv; `key export --secret` refuses overwrite, writes 0600; config redacts secrets by default including URL userinfo scrubbing; prototype-pollution keys blocked in `config set`.
- **Fallback spend assembly:** asserts `payment.script === prevOutScript`, dedupes sigs, verifies each before injecting.
- **Errors:** no raw secret material in any error `data` payload or log statement (except the indirect multikey path, H3).

## Top recommendations

1. **C1:** Gate the Nostr transport behind envelope signatures or mark dev-only.
2. **H1:** Enforce `capabilityInvocation` membership in `resolver.applyUpdate`.
3. **H2:** Fix the inverted domain check (one-line) and add tests for both pass and fail directions.
4. **H3:** Make `SchnorrMultikey.toJSON()` public-only; keep explicit `exportJSON()`.
5. **H6:** Convert all `receive()`-reachable throws on untrusted input into recorded rejections (the `SUBMIT_NONINCLUDED` pattern); add blame-and-exclude retry.
6. **H7/H8:** Add `message.from === state.serviceDid` checks; bind VALIDATION_ACK to the signal hash.
7. **H4/M7/M8:** Drop `--btc-rpc-pass`; warn on cleartext+auth; add pre-broadcast fee/tx confirmation on mainnet.
8. **H5/M1/M2/M3/M4:** Resolver correctness fixes (signal extraction, id equality, version check order, service dedupe key, minConf).

---

## Second-pass verification

All findings were re-verified against source by independent agents attempting to disprove each one (checking callers, wrappers, and upstream validation for mitigations).

### Verdicts

- **C1: CONFIRMED.** Service binds `from` only for SUBMIT_UPDATE and FALLBACK_SIGNATURE; OPT_IN, SUBMIT_NONINCLUDED, VALIDATION_ACK, NONCE_CONTRIBUTION, SIGNATURE_AUTHORIZATION trust `message.from` blindly. `service.ts:533` comment ("Membership is proven by the signed transport envelope") is true for HTTP, false for Nostr.
- **H1: CONFIRMED.** `getSigningMethod` searches `verificationMethod` by fragment only; the sole `capabilityInvocation` authorization check is the write path (`did-btcr2.ts:174-177`). `proofPurpose` is signer-controlled data.
- **H2: CONFIRMED**, one nuance: no in-repo caller passes `expectedDomain` (latent in first-party flows), but it is externally triggerable via the public `DataIntegrityProofApi.verifyProof` (`api/src/crypto.ts:265-281`).
- **H3: CONFIRMED.** `CryptosuiteError` data payloads at `cryptosuite/index.ts:195,203,233,258` embed the cryptosuite instance, whose multikey serializes its secret via `toJSON` -> `exportJSON`.
- **H4: CONFIRMED.**
- **H5: CONFIRMED as a code defect; fails closed.** The strict shape check in `extractOpReturnSignal` (signal-discovery.ts:26-45) means no phantom signal can be forged; net effect is the fullnode path silently never finds any signal (availability/correctness, not forgery). Severity kept High for silent-stale-resolution impact.
- **H6: CONFIRMED.** Throw sites: `cohort.ts:277-285`, `cohort.ts:393-399`, `signing-session.ts:105-122,149-160,168-226`; catch-to-`#failCohort` at all six runner handlers; `#failCohort` (service-runner.ts:559-566) removes the whole cohort. `#handleSubmitUpdate` reachable by any opted-in (not accepted) sender; `#handleValidationAck` has no membership guard at all.
- **H7: CONFIRMED** for all five handlers; `state.serviceDid` itself sourced from an unauthenticated advert (participant.ts:257,265). `validateMembership` and the signal-anchor check are partial mitigations only.
- **H8: CONFIRMED.** `signalBytes` is stored (`service.ts:633`) but never compared at ack time; acks replayable across rounds.
- **M1-M4, M7-M9, M11, M12: CONFIRMED as written.** Additional details: M2 loop order is apply(451) -> increment(485) -> check(491-494); M4 also accepts mempool txs (NaN confirmations) since `status.confirmed` is not even filtered, and resolver.ts:411 has a TODO acknowledging it.
- **M5: CONFIRMED**, nuance: `approveFallback` recomputes the fallback leaf locally (participant.ts:763-766) but still skips prevOutScript/change/fee checks; the optimistic path has no such mitigation.
- **M6: CONFIRMED**, nuance: `acceptedParticipants` is capped when `maxParticipants` is set, but the pending queue never is.
- **M10: CONFIRMED**, mitigated in practice: all production signing goes through the `Signer` interface -> `signWithScheme`; the inconsistent class-level path appears only in keypair tests.
- **L1, L3, L7 (all five cited sites): CONFIRMED.**

**Result: 24/24 re-checked findings confirmed** (three with severity-affecting nuances recorded above). No finding was refuted.

### New findings from gap coverage (api package, CI/CD, scripts, lib tooling)

The first pass did not cover `packages/api`, CI workflows, or repo tooling. Second-pass audit of those areas found:

- **[MEDIUM] N1. CI actions pinned by mutable major-version tags, not SHAs** - `.github/workflows/ci.yml:17,20,23` (`actions/checkout@v4`, `pnpm/action-setup@v4`, `actions/setup-node@v4`) in a job holding a `contents: write` token. Pin to full commit SHAs.
- **[LOW] N2. Job-wide `contents: write`** - `ci.yml:12-13`; the write token is needed only by the badge-publish step but `pnpm install`/build/test (which execute dependency code) also run with it. Split into read-only test job + write-scoped badge job. Also: no `pull_request` trigger, so external PRs get no CI vetting.
- **[LOW] N3. `api.updateDid` ignores `deactivated` metadata** - `packages/api/src/api.ts:234-263`; signs and broadcasts updates for deactivated DIDs that no conformant resolver will apply, burning real BTC fees per retry.
- **[LOW] N4. Unbounded CAS response buffering** - `packages/api/src/cas.ts:121-125, 177-181`; `await res.arrayBuffer()` with no size cap. A hostile IPFS gateway can exhaust resolver memory.
- **[LOW] N5. CAS executors do not verify retrieved bytes against the requested hash** - `cas.ts:117-128, 174-185`. Safe inside resolution (`Resolver.provide()` re-hashes everything), but public `api.cas.retrieve()` returns unverified bytes to direct callers.
- **[LOW] N6. Hardcoded Polar RPC credentials applied to any network** - `packages/method/lib/generate-vector.ts:267`, `lib/wallet/tx-builder.ts:54`, `lib/bitcoin-endpoints.ts:35-38`; `polaruser`/`polarpass` sent to any `--network` RPC host override, contradicting the api-layer invariant (`api/src/bitcoin.ts:24-25`).
- **[INFO] N7.** `generateDid` defaults: network `regtest`, `setActive: true` (`api.ts:132-138`, `did.ts:46-47`).
- **[INFO] N8.** Mainnet signal discovery defaults to mempool.space (`api/src/bitcoin.ts:32`); censorship possible, forgery not (hash-chained).
- **[INFO] N9.** Plaintext secrets in generated test vectors (by design; disposable regtest keys); committed fixed mutinynet secret keys in `lib/scenarios/*.json`; mainnet keys recoverable from git history, self-documented in `lib/recovery/RECOVERED-KEYS.md` (funds at those addresses must be considered compromised until swept).
- **[INFO] N10.** No publish workflow: releases run locally via `pnpm publish:all`; no provenance attestation. Recommend CI `npm publish --provenance` / OIDC trusted publishing.
- **[INFO] N11.** `packages/keypair/package.json` `version:new` interpolates `$NEW_VERSION` unquoted (local-only, self-inflicted).

Gap areas verified clean: no secret logging in `api` (Logger carries DIDs/hashes only); `KeyManagerApi.export` gates on `canExport`; deactivate throws `NotImplementedError`; no `preinstall`/`postinstall` hooks in any package.json; no committed `.npmrc` tokens; lockfile committed with `--frozen-lockfile` in CI; `onlyBuiltDependencies` allowlist restricts install scripts; `@did-btcr2` npm scope is claimed (low dependency-confusion risk); no `pull_request_target` or untrusted-context interpolation in CI; `scripts/coverage-report.mjs` clean; no test helpers shipped (`files: ['dist','src']`); browser bundle RNG throws rather than falling back to `Math.random`; `lib/wallet/store.ts` writes wallet.json 0600.

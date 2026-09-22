# ADR 120: The SMT Follows the Leaf Values, the Proof Bit Sequence, and the Signal Results of Spec PR 365

- **Status:** Accepted
- **Date:** 2026-09-22
- **Packages:** `@did-btcr2/smt` (MINOR), `@did-btcr2/common` (MINOR), `@did-btcr2/method` (MINOR), `@did-btcr2/aggregation` (MINOR), `@did-btcr2/api` (MINOR); dependency uptake in `@did-btcr2/cli`

## Context

Specification pull request 365 (merged 2026-09-22, commit `e9ecde66`) closed issues 341, 342, 343, and 177. It pins seven rules that the SMT path of this repository did not follow.

1. `bitAt(i)` counts from the left. `bitAt(0)` is the most significant bit of the first byte. The walk starts at the leaf with `bitAt(255)`. Bit `i` of `collapsed` is `bitAt(i)` of the decoded value.
2. The fields `nonce` and `updateId` of a proof select one of four leaf values: `hash(hash(nonce) + updateId)`, `hash(hash(nonce))`, `updateId`, or `cachedZero[0]` for an empty index. A `nonce` has any length.
3. The result of SMT Proof Verification is `false` if `updateId`, `collapsed`, or an entry of `hashes` does not decode to 32 bytes. It is also `false` if the number of entries in `hashes` plus the number of set bits in `collapsed` is not 256.
4. Process SMT Beacon raises `MISSING_UPDATE_DATA` when the proof table has no entry for `smt_root`. It raises `INVALID_SIGNAL_DATA` when the `id` of the proof is not `smt_root`, or when the algorithm returns `false`. A proof without `updateId` announces no update for the DID.
5. Find Beacon Signals finds only the transactions at or above `current_block_height`. Apply Update sets `current_block_height` from the block of the applied update.
6. The resolver hashes a retrieved update and compares the hash to `update_hash`. A mismatch is `INVALID_SIGNAL_DATA`. A retrieved CAS announcement whose hash is not the announced hash is not available: `MISSING_UPDATE_DATA`.
7. The sidecar holds one proof for each SMT Beacon Signal that Find Beacon Signals finds.

At `main` `e30f005f` the tree read the bits of `hash(did)` in the other sequence. The least significant bit selected the child of the root, and the leaf level was the most significant bit. ADR 036 mapped the index `i` of the pseudocode to bit position `i` of the value as an integer. The leaf had two values, and both required a `nonce`. A proof that did not decode raised a `RangeError` out of `Resolver.resolve()`. The error codes had no `INVALID_SIGNAL_DATA`, and the SMT beacon raised `INVALID_SMT_PROOF`. The resolver filtered the signals by `minConf` only. `BTCR2MerkleTree.proof` threw for a DID that was not in the tree. The api raised a plain `Error` for a missing proof.

Evidence: the specification has two example proofs (an update and an empty index) for the DID `did:btcr2:x1qhm2yjspwgyeq7k8980n2twxmezmd0pzyd4qpwm7h7c23wgr6u3rj3gm8cg`. Both verify under the bit sequence and the four leaf values of the specification. Both fail under smt 0.3.0.

## Decision

**The smt package follows the specification.** `bitAt(value, i)` counts from the left. `collapsed` sets bit `i` (from the left) when the sibling at level `i` is empty. `leafValue(nonce?, updateId?)` returns one of the four leaf values. `TreeEntry` is `{ did, nonce?, updateId? }`. The `updateId` is the 32-byte JSON Document Hash of the signed update, not the bytes of the update. The data model of the specification is `(nonce?, updateId?)`, and the no-nonce arm needs the hash itself.

**`verifyProof(proof, did)` returns `false` and never throws.** It decodes the proof, selects the leaf value from the proof fields, and walks to the root. A proof that does not decode gives `false`. So does a field that is not 32 bytes, a `hashes` count that does not agree with `collapsed`, or a root that is not `id`. `verifySerializedProof` also returns `false` on a decode failure.

**`BTCR2MerkleTree.proof(did)` serves a member or not.** A DID with no entry, or with an entry that has neither field, gets the proof of an empty index. The no-nonce non-update needs it. One method, one meaning.

**The method package raises the codes of the specification.** `SMTBeacon.processSignals` checks that the `id` of the proof is the signal root, then verifies the proof with `verifyProof`. Either failure raises `SMTBeaconError` of type `INVALID_SIGNAL_DATA`. A proof without `updateId` produces no tuple. `Resolver.provide()` raises `INVALID_SIGNAL_DATA` for:

- a signed update whose hash is not the announced hash,
- an SMT proof of another shape,
- an SMT proof whose `id` is not the root or does not decode.

It raises `MISSING_UPDATE_DATA` for a CAS announcement whose hash is not the signal. A malformed update and a malformed announcement stay `INVALID_DID_UPDATE`.

**The resolver keeps `current_block_height`.** Apply Update sets it from the block of the applied update. The sans-I/O authority of Find Beacon Signals drops a signal whose block is below it. A beacon address that an update added has no signals for the DID before the block of that update.

**The api raises a typed `MISSING_UPDATE_DATA`** for a resolution that needs an SMT proof that the sidecar does not hold.

**Nonce mode stays the default.** The single-party `SMTBeacon.broadcastSignal` and the aggregation cohort build their entries with a 32-byte random nonce. No-nonce mode is a controller choice. The tree supports it, and no caller selects it yet.

## Scope boundary

- No `fromHeight` hint on `NeedBeaconSignals`. No consumer reads it today. It is additive and can come later.
- No report of unused sidecar data (a MAY of the specification).
- The legacy `OptimizedSMT` and `SMTProof` classes stay in the smt package. Their removal is a separate task.
- The V5 test vectors (the SMT recipes on the four networks) come after this change is published.

## Consequences

**Positive.** The example proofs of the specification verify. A proof from another conformant implementation verifies here, and a proof from here verifies there. A malformed proof is a typed resolution failure, not an exception. A DID controller can publish an update in no-nonce mode.

**Negative.** Every SMT root and every SMT proof changes. The mutinynet vectors 11a, 11b, 12a, and 12b and every SMT recipe of the V0 to V4 vectors regenerate in V5. A proof that smt 0.3.0 produced does not verify under smt 0.4.0. `TreeEntry.signedUpdate` is gone: a caller passes `updateId`. `inclusionLeafHash` and `nonInclusionLeafHash` are gone: a caller uses `leafValue`. The SMT beacon raises `INVALID_SIGNAL_DATA` where it raised `INVALID_SMT_PROOF`. `provide()` raises `INVALID_SIGNAL_DATA` and `MISSING_UPDATE_DATA` where it raised `INVALID_DID_UPDATE`.

**Superseded.** The bit mapping and the leaf table of ADR 036. The zero-hash model, the seed of 32 zero bytes, and the build of ADR 036 stand: the specification now pins the seed. The wire format of ADR 035 stands.

**Unchanged.** The processed-signal keying of ADR 118. The `minConf` filter of ADR 105. The publication policy of ADR 073.

## Implementation

- `packages/smt/src/btcr2-leaf.ts`: `leafValue`, `didToIndex`.
- `packages/smt/src/zero-hash.ts`: `bitAt(value, i)` from the left, the `collapsed` bit sequence.
- `packages/smt/src/btcr2-proof.ts`: `verifyProof`; `verifySerializedProof` returns `false` on a decode failure; a nonce of any length.
- `packages/smt/src/btcr2-tree.ts`: `TreeEntry { did, nonce?, updateId? }`; the empty-index proof of a non-member.
- `packages/smt/README.md` and the three smt specs: the bit-sequence pins from the text of the specification.
- `packages/common/src/errors.ts`: `INVALID_SIGNAL_DATA`.
- `packages/method/src/core/beacon/smt-beacon.ts`: the `id == smt_root` check, `verifyProof`, `INVALID_SIGNAL_DATA`, the `updateId` entry of the broadcast.
- `packages/method/src/core/resolver.ts`: `#currentBlockHeight`, the height filter of `#eligibleSignals`, the `provide()` codes, the `isSMTProof` shape.
- `packages/method/src/core/interfaces.ts`, `types.ts`, `docs/beacon-system-overview.md`: the `SMTProof` and `smtProofs` documentation.
- `packages/method/tests/beacon.spec.ts`, `beacon-did-injection.spec.ts`, `resolver.spec.ts`: the four arms, the codes, the height filter.
- `packages/aggregation/src/core/cohort.ts`, `beacon-strategy.ts`: `updateId` entries, `verifyProof`.
- `packages/api/src/method.ts`, `README.md`, `lib/build-artifacts.ts`, `tests/did-method-api-cas-policy.spec.ts`: the typed `MISSING_UPDATE_DATA`, the `updateId` entries of the vector build.
- `packages/cli/docs/resolve.md`: the `MISSING_UPDATE_DATA` list.
- Versions: smt 0.4.0, common 9.7.0, method 0.66.0, aggregation 0.7.0, api 0.27.0 (MINOR); cli 0.24.6 (PATCH, dependency uptake).

## References

- Specification pull request 365, "Specify the SMT leaf values, the proof bit sequence, and the aggregate signal results" (merged 2026-09-22, commit `e9ecde66`; issues 341, 342, 343, 177).
- [SMT Proof Verification](https://dcdpr.github.io/did-btcr2/algorithms.html#smt-proof-verification), [SMT Proof](https://dcdpr.github.io/did-btcr2/data-structures.html#smt-proof), [Process SMT Beacon](https://dcdpr.github.io/did-btcr2/operations/resolve.html#process-smt-beacon).
- [ADR 035](035-smt-proof-base64url-wire-format.md): the proof wire format.
- [ADR 036](036-zero-hash-smt-model.md): the zero-hash model.
- [ADR 118](118-resolver-keys-processed-signals-by-beacon-address.md): the processed set by beacon address.

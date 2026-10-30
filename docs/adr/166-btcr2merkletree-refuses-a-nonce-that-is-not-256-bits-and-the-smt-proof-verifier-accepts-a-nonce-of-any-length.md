# ADR 166: BTCR2MerkleTree Refuses a Nonce That Is Not 256 Bits, and the SMT Proof Verifier Accepts a Nonce of Any Length

- **Status:** Accepted
- **Date:** 2026-10-30
- **Packages:** `@did-btcr2/smt` (MINOR: `BTCR2MerkleTree.addEntries` refuses a `nonce` that is not 32 bytes with a `RangeError`); `@did-btcr2/api` (MINOR: `SmtApi.build` gets the refusal through smt; the browser bundle holds the smt package); `@did-btcr2/method` (PATCH: the JSDoc of `SMTProof`; dependency uptake; the browser bundle holds the smt package); `@did-btcr2/aggregation` (PATCH: dependency uptake; the browser bundle holds the smt package); `@did-btcr2/cli` (PATCH: dependency uptake through api)

## Context

### The tree accepted a nonce of any length

`BTCR2MerkleTree.addEntries` checks the `updateId` of each entry. It refuses an `updateId` that is not 32 bytes with a `RangeError`. `addEntries` did not check the `nonce`. `SmtApi.build` decodes the `nonce` of each entry and gives it to `addEntries`, also with no check. ADR 120 says: "A `nonce` has any length."

Thus a caller could build a tree with a 0-byte or a 1-byte nonce and publish its root in a Beacon Signal. `verifyProof` returns `true` for the proof of the DID with that nonce.

### A short nonce does not hide the update

With a nonce, the leaf value of an index is `hash(hash(nonce) + updateId)` for an update, or `hash(hash(nonce))` for no update. The SMT appendix gives the purpose of the nonce: "With a `nonce`, other parties (aggregators, other DID controllers, verifiers) cannot know if there is an update, or its contents. Only the DID controller can tell them."

Other parties can see a leaf value. The Aggregate Beacons example, "Respond to Update Opportunities", says that the Aggregation Participant sends `hash(hash(nonce) + updateId)` or `hash(hash(nonce))` to the Aggregation Service. A party with a leaf value can compare it with `hash(hash(n))` for each guess `n`. For a 0-byte nonce, one guess is sufficient. For a 1-byte nonce, 256 guesses are sufficient. A match shows that the signal announces no update for the DID.

The Beacon Signal stays on Bitcoin, so the DID controller cannot replace the nonce later.

### The specification gives the nonce 256 bits

Data Structures, "SMT Proof", says: "`nonce`: OPTIONAL 256-bit nonce, one for each index in each [Beacon Signal]."

The SMT appendix says: "The `nonce` is an OPTIONAL 256-bit value that is unique for each DID and each signal." It also says: "The inner hash `hash(nonce)` is 32 bytes for a `nonce` of any length. Thus [SMT Proof Verification] accepts a `nonce` of any length."

No BCP 14 keyword sets the length of the nonce. The data structure gives 256 bits. The rule "any length" applies only to SMT Proof Verification.

## Decision

### 1. `addEntries` refuses a nonce that is not 32 bytes

`BTCR2MerkleTree.addEntries` refuses a `nonce` that is not 32 bytes with a `RangeError`. The refusal also applies to a `nonce` that is longer than 32 bytes. The message is `` `Invalid nonce: expected 32 bytes, got ${n}` ``. The message prints only a number (ADR 156). The check runs before the `updateId` check. An entry without a `nonce` (no-nonce mode) does not change.

`SmtApi.build` calls `addEntries`, so it gives the same refusal. A `nonce` of `''` decodes to 0 bytes, so `SmtApi.build` refuses it. A `nonce` that is not base64url without padding gives the `Error` of the decoder, as before.

### 2. Each producer in this repository uses the check

Each producer in this repository builds its tree with `addEntries`:

- `SmtApi.build`: the nonce of the caller.
- `SMTBeacon.broadcastSignal` (method): `randomBytes(32)`.
- `AggregationCohort.buildSMTTree` (aggregation): `randomBytes(32)`.
- The vector script `packages/api/lib/build-artifacts.ts`: a 32-byte nonce from `smtNonce`.

### 3. The verifier does not change

`leafValue`, `verifyProof`, `verifySerializedProof`, and `deserializeProof` accept a `nonce` of any length. `verifyProof` returns `true` for a valid proof from another implementation with another nonce length.

### 4. `serializeProof` gets no check

`serializeProof` writes the fields that the caller gives. `BTCR2MerkleTree.proof` gives it the nonce of an entry that `addEntries` checked. Thus a check in `serializeProof` adds nothing for the tree. A test uses `leafValue`, `zeroHashRoot`, `generateZeroHashProof`, and `serializeProof` to make a proof with a 16-byte nonce for the verifier.

### 5. The docs give the two rules

The JSDoc of `TreeEntry.nonce`, `SmtEntry.nonce`, `SMTProof`, and `SMTProof.nonce` says that a nonce is 256 bits. The JSDoc of `TreeEntry.nonce`, `SMTProof`, and `SMTProof.nonce` also says that the verifier accepts a nonce of any length. The smt README gives both rules.

### 6. Each judgment call conforms to the specification texts

| Judgment call | Text | Result |
|---|---|---|
| `addEntries` refuses a `nonce` that is not 32 bytes (decision 1). | Data Structures, "SMT Proof": "`nonce`: OPTIONAL 256-bit nonce, one for each index in each [Beacon Signal]." SMT appendix: "The `nonce` is an OPTIONAL 256-bit value that is unique for each DID and each signal." | Conforms. The data structure gives the length. |
| `addEntries` also refuses a `nonce` that is longer than 32 bytes (decision 1). | The same two texts. | Conforms. A longer nonce is not 256 bits. |
| The refusal is a `RangeError` (decision 1). | The specification does not define the errors of a library that builds a tree. | Conforms. `addEntries` refuses an `updateId` that is not 32 bytes with the same error class. |
| The verifier accepts a `nonce` of any length (decision 3). | SMT appendix: "The inner hash `hash(nonce)` is 32 bytes for a `nonce` of any length. Thus [SMT Proof Verification] accepts a `nonce` of any length." | Conforms. |
| `serializeProof` and `leafValue` get no check (decisions 3 and 4). | SMT Proof Verification uses the leaf value. The specification does not define the functions of a library. | Conforms. `leafValue` is a step of the verifier. |

## Alternatives

**Refuse only a nonce that is shorter than 32 bytes.** Rejected. The data structure gives 256 bits, not a minimum length. A longer nonce adds no privacy to a 256-bit random nonce.

**Check the nonce in `SmtApi.build` only.** Rejected. `BTCR2MerkleTree` is a public export of the smt package. A direct caller of `addEntries` then gets no check. One check in `addEntries` covers each producer.

**Check the nonce in `leafValue`.** Rejected. The verifier calls `leafValue`, and SMT Proof Verification accepts a `nonce` of any length.

**Use `validateHash` for the check.** Rejected. Its message says "hash", and a nonce is not a hash.

## Consequences

- The smt and api packages get a MINOR release. The method, aggregation, and cli packages get a PATCH release.
- `addEntries` now refuses a `nonce` that is not 32 bytes with a `RangeError`. Before, the tree accepted the nonce, and `verifyProof` returned `true` for the proof of the DID.
- `SmtApi.build` now refuses an entry `nonce` that decodes to a length other than 32 bytes with the same `RangeError`. A `nonce` that is not base64url without padding gives the `Error` of the decoder, as before.
- If `addEntries` refuses an entry, it keeps the entries before it in the tree, as for an `updateId` that is not 32 bytes. `SmtApi.build` makes a new tree for each call, so a refusal leaves no tree.
- `SMTBeacon.broadcastSignal` and `AggregationCohort.buildSMTTree` do not change. They use a 32-byte random nonce.
- No test vector changes. Each of the 28 nonces in `packages/api/lib/data` is 32 bytes.

These residuals stay:

- `leafValue` and `serializeProof` accept a nonce of any length. A caller that builds a tree with `leafValue`, `zeroHashRoot`, `generateZeroHashProof`, and `serializeProof` can use a short nonce.
- `addEntries` cannot check that a nonce is random or unique. A nonce of 32 zero bytes passes the check.

**Superseded.**

- ADR 120, rule 2 of the Context, the sentence "A `nonce` has any length." Decision 1 of this ADR gives the nonce of a tree entry 32 bytes. The rule stays for SMT Proof Verification (decision 3).

**Unchanged.**

- ADR 120: `TreeEntry` is `{ did, nonce?, updateId? }`. `verifyProof` returns `false` and never throws. Nonce mode stays the default, with a 32-byte random nonce. Decision 1 of this ADR adds the check of the nonce length in `addEntries`.
- ADR 156: an error message prints only a primitive value. Decision 1 of this ADR adds a message that prints only a number.

## Implementation

- `packages/smt/src/btcr2-tree.ts`: the module constant `NONCE_BYTE_LENGTH` and the check in `addEntries`; the JSDoc of `TreeEntry.nonce` and of `addEntries`.
- `packages/api/src/smt.ts`: the JSDoc of `SmtEntry.nonce` and of `SmtApi.build`.
- `packages/method/src/core/interfaces.ts`: the JSDoc of `SMTProof` and of `SMTProof.nonce`.
- Docs: `packages/smt/README.md`.
- Tests:
  - smt: `btcr2-tree.spec.ts` (refuses a nonce of 0, 1, 16, 31, and 33 bytes; accepts a nonce of 32 bytes, and `verifyProof` returns `true` for its proof), `btcr2-proof.spec.ts` (`verifyProof` returns `true` for the proof of a member with a 16-byte nonce).
  - api: `smt-api.spec.ts` (refuses the nonces `''`, `'AQ'`, and a 33-byte nonce).

## References

- did:btcr2 specification: [Data Structures](https://dcdpr.github.io/did-btcr2/data-structures.html) ("SMT Proof"), [Algorithms](https://dcdpr.github.io/did-btcr2/algorithms.html) ("SMT Proof Verification"), [Optimized Sparse Merkle Tree Implementation](https://dcdpr.github.io/did-btcr2/appendix/optimized-smt.html), [Aggregate Beacons](https://dcdpr.github.io/did-btcr2/beacons/aggregate-beacons.html) ("Respond to Update Opportunities").
- ADRs 120, 156.

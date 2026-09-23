# ADR 122: The api Exports the Steps of a Vector Tool, and the SMT Verifier Rejects an Empty Sibling in `hashes`

- **Status:** Accepted
- **Date:** 2026-09-23
- **Packages:** `@did-btcr2/api`, `@did-btcr2/smt`, `@did-btcr2/method`

## Context

The specification repository makes its example corpus with the script `bin/gen-examples.ts`. The script uses this implementation for each step that the implementation has. The script depends on six packages of this repository. The goal is two packages: `@did-btcr2/api` and `@did-btcr2/smt`. A test against api 0.27.0 and smt 0.4.0 found two gaps.

1. The api does not export three names that the script uses:
   - `canonicalHash` (common): the JSON Document Hashing of each signed update, and the check of the source, target, and genesis document hashes.
   - `JSONPatch` (common): the target document of each update. `Updater.construct` applies the patch, but it returns only the unsigned update.
   - `Appendix` (method): `Appendix.deriveRootCapability(did)`, the root capability of a DID.
2. Specification pull request 370 (issue 369) makes the `collapsed` bit a MUST at each level where the sibling is an empty subtree. SMT Proof Verification gets one more `false` condition: a `0` bit of `collapsed` selects an entry of `hashes` that is equal to `cachedZero[n]`. `verifyZeroHash` in smt 0.4.0 does not compare the entry. Thus `verifyProof` accepts a proof that the specification rejects.

Without the new rule, one leaf in one tree has more than one valid proof. A prover can send an empty sibling as a `hashes` entry or as a set bit, and the walk gives the same root.

ADR 096 sets the rule for the re-exports of the api: the write path, and the types in the signatures of the CRUD calls. The three names are not in a CRUD signature.

Two smaller items came from the same test:

- `serializeProof` writes the properties in the order `id`, `collapsed`, `hashes`, `nonce`, `updateId`. The SMT Proof data structure lists `id`, `nonce`, `updateId`, `collapsed`, `hashes`.
- `DidDocument.fromKeyIdentifier` sets the document `id` to `<did>#initialKey`. The constructor then throws `INVALID_DID_DOCUMENT` ("Invalid id") for each input.

## Decision

**The api exports the implementation steps of a vector tool.** The package root re-exports `canonicalHash` and `JSONPatch` from common, and `Appendix` from method. The re-exports are explicit named exports, not `export *`. This adds one rule to ADR 096. The api also exports a name that a tool needs to build specification examples or test vectors from signed parts, if the facade has no path for that step.

**The api gets no `smt` or `aggregation` sub-facade.** ADR 050 keeps aggregation out of the facade. A vector tool imports `@did-btcr2/smt` directly, as `packages/api/lib/build-artifacts.ts` does. The api covers the SMT CRUD through method.

**The SMT verifier rejects an empty sibling in `hashes`.** `verifyZeroHash` compares each entry of `hashes` with `cachedZero[n]` of its level. If they are equal, the result is `false`. `verifyProof` and `verifySerializedProof` get the rule through `verifyZeroHash`. `generateZeroHashProof` does not change, because it sets the bit for each empty sibling.

**`serializeProof` writes the order of the data structure:** `id`, `nonce`, `updateId`, `collapsed`, `hashes`. An absent `nonce` or `updateId` gives no property.

**`DidDocument.fromKeyIdentifier` makes the deterministic document of a k1 DID.** The document `id` is the DID. The one verification method is `<did>#initialKey`. The result is equal to the result of `Resolver.deterministic` for the same key and services.

## Scope boundary

- No sign-only update call on the api. A tool that signs with its own signer calls `Updater.construct` and signs the result.
- No `auxRand` option on a signer.
- No re-export of `canonicalize`, `getNetwork`, or the hash helpers. A tool gets them from other paths.
- No re-export of the option and result types of the three names (`CanonicalizationOptions`, `JSONPatchApplyOptions`, `RootCapability`). Add them if a caller needs them.

## Consequences

**Positive.** The generator of the specification imports only `@did-btcr2/api` and `@did-btcr2/smt`. One leaf in one tree has one valid proof. The SMT beacon of method and the participant check of aggregation call `verifyProof`, so both reject a proof with an empty sibling in `hashes`. A serialized proof has the property order of the specification. `fromKeyIdentifier` returns a document.

**Negative.** A proof from another implementation with an empty sibling in `hashes` does not verify here. The api surface grows by three values that no CRUD call needs. The property order of a serialized proof changes. A test that compares the serialized text, not the parsed value, must change. The test vectors keep the old order until the next vector pass.

**Unchanged.** The SMT roots, the proofs that this repository makes, and all hashes: JCS sorts the properties, and the verifier reads the fields by name. The leaf values and the bit sequence of ADR 120. The re-export rules of ADR 096 for the write path.

## Implementation

- `packages/smt/src/zero-hash.ts`: `verifyZeroHash` returns `false` for a `hashes` entry equal to `cachedZero[n]`.
- `packages/smt/src/btcr2-proof.ts`: the property order of `serializeProof`; the `verifyProof` and `collapsed` documentation.
- `packages/smt/tests/btcr2-proof.spec.ts`: an empty sibling in `hashes` at the leaf level and at each collapsed level; the property order.
- `packages/smt/README.md`: the new `false` condition and the property order.
- `packages/api/src/index.ts`: the three re-exports.
- `packages/api/tests/index-exports.spec.ts`: the three names as values.
- `packages/api/README.md`: the "Vector tool steps" row.
- `packages/method/src/utils/did-document.ts`: `fromKeyIdentifier`.
- `packages/method/tests/did-document.spec.ts`: `fromKeyIdentifier` against `Resolver.deterministic`.

## References

- Specification pull request 370, "Require a `1` bit in `collapsed` at each empty-sibling level" (issue 369).
- [SMT Proof Verification](https://dcdpr.github.io/did-btcr2/algorithms.html#smt-proof-verification), [SMT Proof](https://dcdpr.github.io/did-btcr2/data-structures.html#smt-proof).
- The example generator of the specification: `bin/gen-examples.ts` in `dcdpr/did-btcr2`.
- [ADR 050](050-split-aggregation-packages.md): aggregation stays out of the api facade.
- [ADR 096](096-facade-signer-factory-and-write-path-re-exports.md): the re-export rules of the api.
- [ADR 120](120-smt-leaf-values-proof-bit-sequence-and-signal-results.md): the SMT leaf values and the proof bit sequence.

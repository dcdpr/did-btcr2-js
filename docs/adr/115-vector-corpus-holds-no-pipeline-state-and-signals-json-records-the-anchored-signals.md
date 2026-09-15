# ADR 115: The Vector Corpus Holds No Pipeline State, signals.json Records the Anchored Signals, and Two Recipes Cover a Duplicate Signal and a Removed Beacon Address

- **Status:** Accepted
- **Date:** 2026-09-15
- **Packages:** development scripts under `lib/` in `@did-btcr2/api`; the test-suite corpus; no shipped package changes

## Context

ADR 113 fixed the layout of a vector set and stated that no state file leaves the submodule. The generator of ADR 113 wrote two more files into each set: `scenario.json`, a copy of the recipe, and `funding.json`, the anchors and the beacon addresses of the scenario. The pipeline steps after generation (funding, anchoring, the verifiers) read them. Both files describe the pipeline, not the DID operations.

On 2026-09-14 the maintainers of the Danubetech harness sent questions about the regenerated vectors. Their harness reads `scenario.json` and `funding.json`. A consumer that reads those files couples its harness to our tooling, and a change to our pipeline breaks it. The maintainers also asked for the chain data of each anchored update: the transaction, the block, and the block times. Without that data, a consumer cannot check its own signal discovery against the corpus, and a consumer that reads no chain cannot fulfill the signals of a sans-I/O resolver.

Two rules for the corpus follow from that exchange:

- R1: a vector set holds the files a consumer needs: the inputs and outputs of the create, update, and resolve operations, and the keys. Nothing else.
- R2: everything the pipeline needs between its steps lives with the pipeline, in this repository.

Three coverage gaps became visible at the same time:

- The negative vector `n03` tampers the network nibble of a k1 identifier to the custom value 12. The Danubetech implementation accepts the custom values 12 to 14, so the vector passes there for the wrong reason. The specification reserves the values 6 to 11; every implementation must reject them.
- Specification pull request 364 (merged 2026-09-11) put the duplicate check of "Process Next Update" before the `versionTime` step. ADR 068 implemented the rule. No vector covers it: a duplicate signal of an applied version, mined after a later version, must not end a `versionTime` resolution early.
- Specification pull request 367 (merged 2026-09-14) makes the resolver ignore the signal of a beacon address that an applied update removed. ADR 114 implemented the rule. No vector covers it.

The offline verifier of the pipeline keyed its synthetic signals by beacon service id. A beacon rotation keeps the service id and changes the address. The verifier delivered the signal of the rotated beacon to the old address in the first discovery round. The filter of ADR 114 ignores that tuple, so the rotation recipe failed offline while it resolves on a chain.

## Decision

**The corpus holds no pipeline state (R1, R2).** A vector set is `{network}/{k1|x1}/{hash}/` with `create/`, `update/` (or `update/NN/`), `resolve/` (or `resolve/NN/`), `other.json`, and `signals.json`. The generator writes no `scenario.json` and no `funding.json`. The state of a generated scenario (the DID, the anchors, the beacon addresses, the cohort) goes to `lib/scenarios/<network>/state/<scenario-id>.json` in this repository. The state holds no secret: the anchor step reads the keys from `other.json`. The vector index of the pipeline keys a set by the `scenarioId` of its `other.json`. The build state of a network (the cohort artifacts, the manifests, the funding summary, the state files) is committed with the pass of that network.

**`signals.json` records the Beacon Signals of a set.** The live verifier writes the file with `--record` for every set that has a Beacon Signal on the chain. The file is an array with one entry per signal:

- `update`: the `update/NN/` number of the signed update that the signal commits to
- `duplicate`: present and `true` on a second signal of the same update, in a later block
- `beaconId`, `address`, `txid`, `blockHeight`, `blockHash`, `blockTime`, `mediantime`, `signalBytes`
- `cohort` with `id` and `members` on a cohort member: the signal is the shared signal of the cohort

The verifier reads the signals from the chain the way the api does, with the indexer discovery of the method package. A consumer compares its own signal discovery with the file, or takes the signals from the file when it reads no chain. The README of each network states the rule.

**Two new entry forms in a recipe.** An update with `removedBeacon: true` is announced at a beacon that an earlier update removed from the document. The generator takes the anchor address from the genesis document and refuses the flag when the source document still carries the beacon. The update is signed and stays in the sidecar, so a resolver finds its data and ignores its signal. The expected document does not advance. A duplicate entry `{ "duplicateOf": N, "beaconId": "#..." }` announces the signed update of entry N again, in a later block. The entry has no `update/NN/` directory and no sidecar entry. The update directories count the update entries only. An anchor of the pipeline state records the entry it announces and the update directory whose signed update is its signal.

**Two new recipes on every network.** `23-k1-duplicate-signal`: update 1 (version 2) and update 2 (version 3) are anchored at one beacon, and a third entry announces the signed update of version 2 again at the same beacon, in a later block. The set resolves to version 3. A sub-vector asks for a `versionTime` after the block of version 3 and before the block of the duplicate, and expects version 3: a resolver that runs the `versionTime` stop before the duplicate check returns version 2. `24-k1-removed-beacon-signal`: update 1 removes the `#initialP2PKH` service, and update 2 is announced at the removed address. The set resolves to version 2, and a sub-vector for `versionId` 3 expects `NOT_FOUND`.

**The `n03` negative uses a reserved network value.** The tampered identifier carries the nibble 6. The recipe descriptions on every network name the reserved value.

**The offline verifier keys its signals by address.** The synthetic signals of a set sit at the anchor addresses, as they do on a chain. A discovery round for a rotated address finds the signals of that address, and the first round finds none there.

## Scope boundary

- No shipped package changes. The resolver, the api, and the cli do not change.
- The layout of the operation files, the `signingMaterial` field, and the resolve output of ADR 113 do not change. A consumer that reads only the operation files sees two removed files and one added file.
- `signals.json` is a record of the chain, not an input of an operation. The pipeline does not read it.
- The SMT recipes stay skipped until specification pull request 365 merges.
- A vector set with an anchor that is not confirmed on the chain fails the live verify with `--record` at the signal read, before the resolve. That is the same pass or fail as before, with an earlier message.

## Consequences

**Positive.** The corpus holds what a consumer needs and nothing that couples a consumer to our pipeline. A consumer can check its signal discovery and its block times against the recorded chain data. The corpus covers the duplicate rule of ADR 068 and the removed-beacon rule of ADR 114, and the `n03` negative tests a rule that every implementation must apply. The pipeline state sits with the recipes that produced it, in one directory per network.

**Negative.** A consumer that reads `scenario.json` or `funding.json` must stop. The Danubetech maintainers received that directive on 2026-09-14. Every committed vector set changes in the next regeneration pass of its network, because the files leave and `signals.json` arrives. A duplicate entry adds an anchor and a block to a pass.

**Unchanged.** The generator, the signing path, the fixed vector layout of the operation files, the resolve output shape, and the one-pass rule of ADR 113. The four networks and the per-network secrets.

**Superseded.** From ADR 113: the statement that no state file leaves the submodule. The state files leave; the operation files stay. The rest of ADR 113 stands.

## Implementation

- `packages/api/lib/_scenario-helpers.ts`: the `state/` paths, `ScenarioState`, `readState`, the vector index by `other.json`, the `DuplicateEntry` and `ScenarioEntry` types, `removedBeacon`, `realUpdates`, the `signalOf` and `duplicateOf` fields of an anchor.
- `packages/api/lib/generate-scenario.ts`: the state file, the reserved nibble, the duplicate entries, the `removedBeacon` anchor, `--clean` of the state directory.
- `packages/api/lib/{route-delivery,anchor-scenarios,aggregate-funding,fund-scenarios,verify-scenarios}.ts`: the state file, the update entries, the signals by address.
- `packages/api/lib/verify-live.ts`: one indexer pass per set, `signals.json` on `--record`.
- `packages/api/lib/readme-scenarios.ts`: the layout and the comparison rule for `signals.json`.
- `packages/api/lib/scenarios/<network>/`: recipes 23 and 24 with fixed keys, the `n03` description.
- `packages/api/docs/test-vectors.md`: the recipe options, the layout, `signals.json`.
- No package version change.

## References

- [ADR 068](068-resolver-versiontime-duplicate-order.md): the duplicate check before the `versionTime` step (specification pull request 364).
- [ADR 113](113-test-vector-pipeline-and-submodule-live-in-the-api-package.md): the pipeline home and the fixed layout that this decision amends.
- [ADR 114](114-resolver-ignores-the-signals-of-a-removed-beacon-address.md): the removed-beacon rule (specification pull request 367).
- Specification, "Identifiers": the reserved network values 6 to 11.
- Specification, "Resolve": "Process Next Update", the duplicate check and the removed-beacon step.
- [did-btcr2-test-suite](https://github.com/dcdpr/did-btcr2-test-suite): the vector corpus.

# ADR 121: A Vector Pass Adds Recipes to Anchored Sets, the SMT Recipes Cover the Four Leaf Values, and signals.json Records the Chain Tip

- **Status:** Accepted
- **Date:** 2026-09-22
- **Packages:** development scripts under `lib/` in `@did-btcr2/api`; the test-suite corpus; no shipped package changes

## Context

ADR 120 made the SMT path follow specification pull request 365. Every SMT root and every SMT proof changed. The SMT recipes of the test-vector pipeline (11a, 11b, 12a, 12b) were skipped until that change. The four networks (regtest, mutinynet, signet, testnet4) each carry 48 anchored or offline vector sets without them.

Four rules of the specification had no vector:

- The four leaf values of an SMT proof: `hash(hash(nonce) + updateId)`, `hash(hash(nonce))`, `updateId`, and the leaf of an empty index.
- `INVALID_SIGNAL_DATA` for an SMT proof that does not verify, and `MISSING_UPDATE_DATA` when the sidecar has no proof for the signal root.
- Find Beacon Signals finds only the signals at or above `current_block_height`.
- A signal applies at `minConf` confirmations or more. The one `minConf` sub-vector sets 1,000,000. It catches a resolver that ignores the option, but not a resolver that compares with `>` in place of `>=`.

The maintainers of the Danubetech harness asked for the chain tip height at record time (2026-09-16). With the tip, a consumer can pin a chain and reproduce `confirmations` and a `minConf` result.

The pipeline assumed one pass from a clean tree. `generate:scenario --clean` deletes every set. `scenario:fund` paid every beacon address of the network. `scenario:artifacts` wrote each cohort artifact again without its `txid`, so the anchor step broadcast the cohort again. On a network with anchored sets, that is wrong: a new signature needs a new anchor, and a second signal at an anchored address makes the DID unresolvable.

## Decision

**A pass can add recipes to a network with anchored sets.** The pass generates the new recipes only, by id. `generate:scenario --add-resolves <id>` writes the `resolve/NN/` sub-vectors that a generated set does not have yet. It writes no other file, and `scenario:route` adds the sidecar. The other steps are safe for the anchored sets:

- `scenario:artifacts` keeps the `txid` of an anchored cohort. It stops if the signal of an anchored cohort changes.
- `scenario:fund` skips an anchor with a `txid`, a cohort with a `txid`, and a cohort with no artifact. It reads the UTXOs of each address one time and skips an address that already holds the amount.
- `scenario:keys` prints the ids of the recipes that it fixed, in place of a `--clean` command.

**The SMT recipes cover the four leaf values and three proof failures.** The pass removes `skip` from 11a, 11b, 12a, and 12b (a nonce and an update). A new cohort `smt-25` anchors one signal for six members:

| Set | Tree entry and sidecar proof | Expected |
|---|---|---|
| `25a-x1-smt-update-no-nonce` | no nonce, an update: the leaf is `updateId` | version 2 |
| `25b-x1-smt-nonce-no-update` | a nonce, no update: the leaf is `hash(hash(nonce))` | version 1 |
| `25c-x1-smt-empty-index` | no entry: the proof of an empty index | version 1 |
| `n29-x1-smt-proof-hash` | one byte of a sibling hash differs | `INVALID_SIGNAL_DATA` |
| `n30-x1-smt-proof-root-id` | the proof `id` is not the signal root | `MISSING_UPDATE_DATA` |
| `n31-x1-smt-proof-withheld` | no proof in the sidecar | `MISSING_UPDATE_DATA` |

The specification builds the proof table from `sidecar.smtProofs`, keyed by the proof `id` (Resolve, "Process SMT Beacon"). A proof whose `id` is not the root is not in the table for the root, so the result of n30 is `MISSING_UPDATE_DATA`. The case catches a resolver that takes a sidecar proof without a match of its `id`.

A recipe sets the tree entry and the proof of a member with `smt`: `nonce: false`, and `proof` as `hash`, `id`, or `withhold`. A member with no update and no nonce has no tree entry. The pipeline builds the tree with `BTCR2MerkleTree` directly, so a member can use the no-nonce mode that no api caller selects.

**Recipe 26 covers `current_block_height`.** Update 1 adds the beacon `#lateBeacon` and is anchored in round 2. Update 2 is anchored at `#lateBeacon` in round 1, one block before update 1. The signal of update 2 is below `current_block_height`, so the set resolves to version 2. A sub-vector for `versionId` 3 expects `NOT_FOUND`. A resolver without the height filter returns version 3. Two recipe options make the case: `round` sets the anchor round of an entry, and `belowCurrentHeight` marks the update that does not advance the expected document. The generator refuses `belowCurrentHeight` unless the round is before the round of the previous anchor. It also refuses two anchors of one scenario in one round.

**A `minConf` of the form `depth:N` names the confirmation count of the anchor of entry N.** The live verifier reads the count from the chain, and the record step writes the number into the committed input. The regtest recipe 22 gets `resolve/10/` with `depth:2`: updates 1 and 2 apply, update 3 does not, and the expected version is 3. A resolver that compares with `>` returns version 2. The case holds only at the recorded tip, so only the regtest recipes use the form.

**`signals.json` records the chain tip.** Each entry gets `recordedTip`: the tip height after the resolves of the set. At that tip, each recorded `confirmations` is at least the recorded value. A cohort member with no update records the shared signal without `update`, because the signal commits to no update of the DID. The entry stays in an array, so a reader of the array shape does not change.

**The regtest record holds one tip.** On regtest, `scenario:verify:live --record` reads the tip at the start and at the end. It fails if the tip moved. The operator turns off auto-mine before the record and exports the Polar network after it, with no block between. The export then holds the chain at `recordedTip`, and `resolve/10/` of recipe 22 holds for a consumer that mines no block.

**The offline verifier follows the rounds and the depths.** The synthetic block of an anchor is its round. The synthetic tip is block 50, so block N has `51 - N` confirmations, above the default `minConf` of 6. A `NeedSMTProof` yields `MISSING_UPDATE_DATA`, the code that the api raises for a sidecar with no proof.

## Scope boundary

- No shipped package changes. The resolver, the api, and the cli do not change.
- The layout of the operation files, `signingMaterial`, and the resolve output of ADR 113 do not change.
- The proofs of the signed updates carry no `invocationTarget`, as in ADR 113 and ADR 115. Test-suite issue 2 stays open. The maintainers defer it.
- The SMT vectors deliver the proofs in the sidecar only. No vector covers a proof that a resolver fetches through `NeedSMTProof`.
- Only regtest carries a `depth:N` case. On a public network the tip grows, and the case changes its result within minutes to hours.

## Consequences

**Positive.** The corpus covers the four leaf values, three SMT proof failures, the `current_block_height` filter, and the `>=` boundary of `minConf`. A consumer can pin the chain of a set at `recordedTip`. A later pass can add recipes to a network with anchored sets, and it pays and anchors only the new addresses. The six members of `smt-25` share one anchor, so the new SMT cases cost one transaction per network.

**Negative.** `update` in a `signals.json` entry is optional. A consumer that requires it must change. The regtest record needs a manual step: auto-mine off before the record, and the export after it. The pass records every set of every network again, so every `resolve/output.json` and every `signals.json` changes (`confirmations`, `recordedTip`).

**Unchanged.** The one-pass rule of ADR 113 within one generation: do not generate a set again between its artifacts and its anchor. The per-network secrets. The anchor rounds of ADR 116. The CAS publication of ADR 117.

## Implementation

- `packages/api/lib/_scenario-helpers.ts`: `SmtMemberOptions`, `SmtProofTamper`, the `round` and `belowCurrentHeight` options, the `round` of an anchor, `anchorRound`, the `depth:N` form (`isMinConfForm`, `resolveMinConf`).
- `packages/api/lib/generate-scenario.ts`: `--add-resolves`, the round checks, `belowCurrentHeight`.
- `packages/api/lib/build-artifacts.ts`: the member options, a member with no update, the invalid proofs, the `txid` of an anchored cohort.
- `packages/api/lib/{anchor-scenarios,fund-scenarios,scenario-keys}.ts`: the recipe round, the skip of anchored and funded addresses, the printed ids.
- `packages/api/lib/verify-scenarios.ts`: the blocks by round, the synthetic confirmations, the `depth:N` form, `NeedSMTProof`.
- `packages/api/lib/verify-live.ts`: the `depth:N` form, `recordedTip`, a cohort member with no update, the regtest tip check.
- `packages/api/lib/readme-scenarios.ts`: the README text for `recordedTip`, `update`, the `depth:N` case, and the SMT members.
- `packages/api/lib/scenarios/<network>/`: recipes 11a, 11b, 12a, 12b without `skip`; recipes 25a, 25b, 25c, 26, n29, n30, n31; the cohort `smt-25`; regtest recipe 22 with `resolve/10/`.
- `packages/api/docs/test-vectors.md`: the pass that adds recipes, the recipe options, `signals.json`, the regtest record.
- No package version change.

## References

- [ADR 113](113-test-vector-pipeline-and-submodule-live-in-the-api-package.md): the pipeline home and the fixed layout.
- [ADR 115](115-vector-corpus-holds-no-pipeline-state-and-signals-json-records-the-anchored-signals.md): `signals.json` and the recipe entry forms.
- [ADR 116](116-anchor-step-broadcasts-one-round-per-command-and-no-script-mines.md): the anchor rounds.
- [ADR 120](120-smt-leaf-values-proof-bit-sequence-and-signal-results.md): the SMT leaf values, the bit sequence, and the signal results (specification pull request 365).
- [Process SMT Beacon](https://dcdpr.github.io/did-btcr2/operations/resolve.html#process-smt-beacon), [SMT Proof Verification](https://dcdpr.github.io/did-btcr2/algorithms.html#smt-proof-verification).

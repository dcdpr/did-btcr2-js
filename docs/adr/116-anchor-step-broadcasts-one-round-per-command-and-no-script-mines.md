# ADR 116: The Anchor Step Broadcasts One Round per Command, and No Pipeline Script Mines a Block

- **Status:** Accepted
- **Date:** 2026-09-15
- **Packages:** development scripts under `lib/` in `@did-btcr2/api`. No shipped package changes.

## Context

The test-vector pipeline anchors the Beacon Signals of every scenario of a network in one command (ADR 113). On regtest the anchor step mined one block after each anchor and six blocks at the end. It used the Bitcoin Core RPC of the Polar stack, and then it waited for the Esplora indexer. On the public test networks it broadcast every anchor at once. The anchors of one scenario chained in the mempool and landed in one block.

Two recipes of ADR 115 add resolve sub-vectors with a `versionTime` form. The forms `before:N`, `at:N`, and `after:N` name the block `mediantime` of the anchor of entry N, minus one second, exactly, or plus one second. The forms need a strictly rising `mediantime` from one anchor of a scenario to the next. Two anchors in one block share a `mediantime`, and no form can separate them. Blocks that a script mines in one batch on regtest share a header time, so the `mediantime` does not rise between them either. The old Polar network of the regtest vectors holds seven blocks with one timestamp.

The maintainer runs the pipeline step by step. A step is a command that does one bounded action and exits. A script that waits for a block with a timer or a poll loop hides the state of the chain from the maintainer. Its failures are hard to read.

## Decision

**One round per command.** `scenario:anchor` broadcasts the next round of anchors and exits. Round k holds the k-th anchor of every scenario. The cohort anchors are round 1, because a cohort member has one update. The maintainer runs the command again after the next block, until the command reports that every anchor is broadcast. The anchors of one scenario then sit in different blocks, and the `mediantime` rises from one anchor to the next.

**The state records the broadcast.** The command writes the `txid` of each broadcast anchor into the `anchors` entry of the scenario state file (`lib/scenarios/<network>/state/<scenario-id>.json`) or into the cohort artifact (`cohorts/<cohort-id>.json`). A second run of the same round skips an anchor that has a `txid`. The next run completes a round that failed in part.

**A check, not a wait.** Before it broadcasts round k, the command reads the indexer one time. It stops with a message if an anchor of round k-1 is not confirmed. At round 1 it stops if an address of the round already carries a Beacon Signal. A signal of an earlier pass at the same address makes the DID unresolvable (`MISSING_UPDATE_DATA`). The remedy is a key roll (`scenario:keys --force`) or a fresh chain. `--dry` lists the rounds with their txids and reports whether the next round is ready.

**No script mines.** `scenario:fund` on regtest sends the sats over RPC and exits. `scenario:anchor` mines no block on any network. The regtest vectors come from a Polar network with auto-mine on, at an interval of 30 seconds, that runs for the whole pass. Every network then follows one code path: one round per block.

## Scope boundary

- No shipped package changes.
- `scenario:verify:live` does not change. The maintainer runs it when the last round has six confirmations.
- The e2e walkthrough scripts in `lib/` (`e2e-*.ts`) still mine their own blocks on regtest. They are demonstrations, not the vector pipeline.
- The confirmation check reads round k-1 only. Each earlier round passed the same check before its successor went out.
- The check requires one confirmation. The `versionTime` forms need different blocks, not a depth.

## Consequences

**Positive.** The `versionTime` forms hold on every network. The maintainer sees the state of every round in the state files and in `--dry`. A partial failure costs one more run of the command, not a new pass. Regtest, mutinynet, testnet4, and signet share one anchor path.

**Negative.** A pass takes one command per round, at one block per round. A round takes about 30 seconds on regtest and mutinynet, and about 10 minutes on testnet4 and signet. The old Polar network cannot serve a pass, because its batch-mined blocks share a timestamp. The regtest vectors move to a new network. The state files and the cohort artifacts of a network change after every round. The maintainer commits them with the pass.

**Unchanged.** The state file layout of ADR 115, apart from the `txid` field. The one-pass rule of ADR 113. The corpus.

**Superseded.** From ADR 113: the statement that the fund step and the anchor step on regtest use `generatetoaddress`. The pipeline uses the RPC for `sendtoaddress` only.

## Implementation

- `packages/api/lib/anchor-scenarios.ts`: the rounds, the readiness check, the `txid` record.
- `packages/api/lib/fund-scenarios.ts`: no block after the regtest sends.
- `packages/api/lib/_scenario-helpers.ts`: `txid` on `AnchorEntry`, `writeState`.
- `packages/api/docs/test-vectors.md`: the anchor rounds and the regtest network.
- No package version change.

## References

- [ADR 111](111-resolver-processes-one-update-per-pass-and-validates-the-resolution-options.md): `versionTime` compared with the block `mediantime`.
- [ADR 113](113-test-vector-pipeline-and-submodule-live-in-the-api-package.md): the pipeline home, and the regtest RPC statement that this decision amends.
- [ADR 115](115-vector-corpus-holds-no-pipeline-state-and-signals-json-records-the-anchored-signals.md): the state files and the recipes with `versionTime` forms.
- Specification, "Resolve": `versionTime` and the block `mediantime`.

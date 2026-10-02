# ADR 136: A Negative Vector Names the Rule That It Breaks, and the Pipeline Checks the Cause

- **Status:** Accepted
- **Date:** 2026-10-02
- **Packages:** development scripts under `lib/` in `@did-btcr2/api`; the test-suite corpus; no shipped package changes

## Context

Each network of the test-vector corpus has 27 negative vector sets. A negative set records only the DID Resolution error code in `didResolutionMetadata.error`. The README of a network told a consumer to compare the code only, because `errorMessage` is the text of this implementation.

An error code does not identify a rule. `INVALID_DID_UPDATE` covers 14 rules of the negative sets. A resolver that fails a set for another rule gets the correct code and passes the comparison.

The pipeline had the same gap. The verifiers compared the code only. The pinned set n27 must break the rule "`update.proof.expires` is before `update.proof.created`". Its recorded `errorMessage` is "proof.expires is before the mediantime", so the set breaks another rule of the same section. No step of the pipeline found the defect.

An implementer who runs the vectors in another test harness asked for two properties:

1. A cause check for every negative set. The pipeline must not record a set that fails for another rule.
2. Stable ids. The implementer maps the causes of the harness to the ids, so an id must not change between two generations of the corpus.

The specification defines the error codes. It does not define a cause code or a rule id.

## Decision

### `other.json` names the rule of a negative set

The `other.json` of a negative set gets the key `expectedFailure`, after `scenarioId`. The value is a rule id. A positive set has no `expectedFailure`. The layout of ADR 113 does not change otherwise.

### One id names one rule

An id names a rule of the specification, not a set. Two sets that break the same rule share the id. The 27 negative sets of a network use 24 ids. The pairs n10 and n11, n16 and n17, and n30 and n31 share an id.

### The ids are stable

- An id never changes.
- An id never names another rule.
- A new rule gets a new id.
- If a rule goes out of the specification, its id retires. No other rule takes it.

### One table holds the rules

`FAILURE_RULES` in `packages/api/lib/_scenario-helpers.ts` maps each id to:

- `error`: the DID Resolution error code of the rule.
- `rule`: the rule, in the words of the specification.
- `section`: the section of the specification, relative to `SPEC_URL` (`https://dcdpr.github.io/did-btcr2/`).
- `message`: a pattern of the `errorMessage` of this implementation for the rule.
- `blockTimes`: set if the resolver checks the rule against the times of the block of the signal.

A negative recipe has `expect: { error, rule }`. `loadRecipes` refuses a recipe if `expect.rule` is not an id of the table, or if the error of the rule is not `expect.error`.

| Rule id | Error | Sets | Section | `blockTimes` |
|---------|-------|------|---------|--------------|
| `did-checksum-invalid` | `INVALID_DID` | n01 | [did-btcr2-identifier-decoding](https://dcdpr.github.io/did-btcr2/algorithms.html#did-btcr2-identifier-decoding) | |
| `did-padding-nonzero` | `INVALID_DID` | n02 | [did-btcr2-identifier-decoding](https://dcdpr.github.io/did-btcr2/algorithms.html#did-btcr2-identifier-decoding) | |
| `did-network-reserved` | `INVALID_DID` | n03 | [did-btcr2-identifier-decoding](https://dcdpr.github.io/did-btcr2/algorithms.html#did-btcr2-identifier-decoding) | |
| `genesis-hash-mismatch` | `INVALID_DID` | n04 | [process-sidecar-data](https://dcdpr.github.io/did-btcr2/operations/resolve.html#process-sidecar-data) | |
| `update-missing` | `MISSING_UPDATE_DATA` | n05 | [find-beacon-signals](https://dcdpr.github.io/did-btcr2/operations/resolve.html#find-beacon-signals) | |
| `update-context-mismatch` | `INVALID_DID_UPDATE` | n10, n11 | [check-update-proof](https://dcdpr.github.io/did-btcr2/operations/resolve.html#check-update-proof) | |
| `proof-context-mismatch` | `INVALID_DID_UPDATE` | n12 | [check-update-proof](https://dcdpr.github.io/did-btcr2/operations/resolve.html#check-update-proof) | |
| `proof-capability-action-mismatch` | `INVALID_DID_UPDATE` | n13 | [check-update-proof](https://dcdpr.github.io/did-btcr2/operations/resolve.html#check-update-proof) | |
| `proof-capability-mismatch` | `INVALID_DID_UPDATE` | n14 | [check-update-proof](https://dcdpr.github.io/did-btcr2/operations/resolve.html#check-update-proof) | |
| `proof-purpose-mismatch` | `INVALID_DID_UPDATE` | n15 | [check-update-proof](https://dcdpr.github.io/did-btcr2/operations/resolve.html#check-update-proof) | |
| `proof-method-unauthorized` | `INVALID_DID_UPDATE` | n16, n17 | [check-update-proof](https://dcdpr.github.io/did-btcr2/operations/resolve.html#check-update-proof) | |
| `proof-not-verified` | `INVALID_DID_UPDATE` | n18 | [check-update-proof](https://dcdpr.github.io/did-btcr2/operations/resolve.html#check-update-proof) | |
| `source-hash-mismatch` | `INVALID_DID_UPDATE` | n19 | [apply-update](https://dcdpr.github.io/did-btcr2/operations/resolve.html#apply-update) | |
| `target-hash-mismatch` | `INVALID_DID_UPDATE` | n20 | [apply-update](https://dcdpr.github.io/did-btcr2/operations/resolve.html#apply-update) | |
| `version-skip` | `LATE_PUBLISHING` | n21 | [check-update-version](https://dcdpr.github.io/did-btcr2/operations/resolve.html#check-update-version) | |
| `patch-apply-failure` | `INVALID_DID_UPDATE` | n22 | [apply-update](https://dcdpr.github.io/did-btcr2/operations/resolve.html#apply-update) | |
| `document-id-mismatch` | `INVALID_DID_UPDATE` | n23 | [apply-update](https://dcdpr.github.io/did-btcr2/operations/resolve.html#apply-update) | |
| `document-not-conformant` | `INVALID_DID_UPDATE` | n24 | [apply-update](https://dcdpr.github.io/did-btcr2/operations/resolve.html#apply-update) | |
| `proof-created-after-block` | `INVALID_DID_UPDATE` | n25 | [check-update-proof](https://dcdpr.github.io/did-btcr2/operations/resolve.html#check-update-proof) | yes |
| `proof-expires-before-mediantime` | `INVALID_DID_UPDATE` | n26 | [check-update-proof](https://dcdpr.github.io/did-btcr2/operations/resolve.html#check-update-proof) | yes |
| `proof-expires-before-created` | `INVALID_DID_UPDATE` | n27 | [check-update-proof](https://dcdpr.github.io/did-btcr2/operations/resolve.html#check-update-proof) | yes |
| `duplicate-hash-mismatch` | `LATE_PUBLISHING` | n28 | [confirm-duplicate-update](https://dcdpr.github.io/did-btcr2/operations/resolve.html#confirm-duplicate-update) | |
| `smt-proof-not-verified` | `INVALID_SIGNAL_DATA` | n29 | [process-smt-beacon](https://dcdpr.github.io/did-btcr2/operations/resolve.html#process-smt-beacon) | |
| `smt-proof-missing` | `MISSING_UPDATE_DATA` | n30, n31 | [process-smt-beacon](https://dcdpr.github.io/did-btcr2/operations/resolve.html#process-smt-beacon) | |

### The verifiers check the cause

The main resolve of a negative set must fail for the rule of the set. The verifiers first compare the error code with the expected output. If the code matches, they compare the message with the pattern of the rule (`causeDiff`). A mismatch fails the case.

- `scenario:verify:live` takes `errorMessage` from the api result: the root cause message of the failure. `--record` does not write a set with a failed case.
- `scenario:verify` takes the root cause message of the resolver error. A missing CAS object or SMT proof gets the message text of the api. The synthetic blocks of the offline step do not have the times of the chain, so the step does not check the cause of a rule with `blockTimes`. It prints "cause not checked offline" for such a set. The live step checks it.

### A proof time tamper breaks only its rule

The 3 rules with `blockTimes` compare the proof times with the block of the signal. A proof time that breaks one rule can break a second rule of the window, and the resolver can stop at the second rule first. Thus `scenario:verify:live` checks each update with a proof time tamper against the block of its signal. The update must break the rule of its tamper and no other rule. Else the set fails, and it needs a new key and a new anchor.

### The README lists the rules

The README of a network shows the rule id of each negative set next to its error code. A section "Expected failures" lists each rule id with its error code, the rule, the link to the specification section, and the sets that break it. The comparison rules tell a consumer to compare the code, then to check the cause against `expectedFailure`, and not to compare `errorMessage`.

## Alternatives

- **One id per set (27 ids).** Each set of a pair breaks the same rule, and the cause check cannot tell the two sets apart. A harness maps its causes to rules, not to sets.
- **A structured cause code in the errors of `method`.** For example, `ResolveError` could carry the rule id in its data, and the result could carry it next to the code. This needs a `method` release and a change of the resolution result. The specification defines no cause code, so the field would be local to this implementation.
- **The line number or the section anchor of the specification as the id.** A line number changes with each edit of the specification. One section holds many rules: `check-update-proof` holds 10 rules of the negative sets.
- **Compare the exact `errorMessage` text.** The text belongs to this implementation. Another implementation cannot produce it.

## Consequences

**Positive.**

- A negative set shows the rule that it tests. A consumer can check that its resolver fails for that rule.
- A pipeline defect such as the pinned n27 fails the verify step, and `--record` does not write the set.
- The ids give a consumer a fixed key for its own cause table.
- The README links each rule to its section of the specification.

**Negative.**

- The message texts of `method`, of the api, and of `@scure/base` are now a contract of the pipeline. If a text changes, the cause check fails, and the pattern in `FAILURE_RULES` must change with the text. The patterns of `did-checksum-invalid` and `did-padding-nonzero` match `@scure/base` text.
- The pinned corpus has no `expectedFailure` until the next generation. Until then, the pinned n27 fails the cause check of `scenario:verify:live` on each network.
- The offline step cannot check the cause of the 3 rules with `blockTimes`.

**Neutral.**

- No shipped package changes. The resolution result and the layout of the operation files do not change.
- A new negative recipe needs an id in `FAILURE_RULES`, or the id of the rule that it shares with another set.

## Implementation

- `packages/api/lib/_scenario-helpers.ts`: `FailureRule`, `FAILURE_RULES`, `SPEC_URL`, `causeDiff`, the `expect.rule` check of `loadRecipes`, `OtherFile.expectedFailure`.
- `packages/api/lib/scenarios/<network>/n*.json`: `expect.rule` in the 27 negative recipes of each network.
- `packages/api/lib/generate-scenario.ts`: `expectedFailure` in `other.json`.
- `packages/api/lib/verify-live.ts`: the cause check, the rule id in a PASS line, the proof time tamper check.
- `packages/api/lib/verify-scenarios.ts`: the cause check, the message texts of the api for a missing object, the skip of the `blockTimes` rules.
- `packages/api/lib/readme-scenarios.ts`: the rule id in the negative table, the section "Expected failures", the comparison rule.
- `packages/api/docs/test-vectors.md`: `expect.rule`, `expectedFailure`, the checks of the verify steps.
- No package version change.

## References

- [ADR 113](113-test-vector-pipeline-and-submodule-live-in-the-api-package.md): the pipeline home and the fixed layout.
- [ADR 115](115-vector-corpus-holds-no-pipeline-state-and-signals-json-records-the-anchored-signals.md): the corpus files and `signals.json`.
- [ADR 121](121-vector-pass-adds-recipes-smt-leaf-values-and-recorded-tip.md): the SMT proof failures and `recordedTip`.
- [Resolve](https://dcdpr.github.io/did-btcr2/operations/resolve.html), [did:btcr2 Identifier Decoding](https://dcdpr.github.io/did-btcr2/algorithms.html#did-btcr2-identifier-decoding).

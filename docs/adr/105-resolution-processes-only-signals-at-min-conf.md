# ADR 105: Resolution processes only beacon signals with at least `minConf` confirmations

- **Status:** Accepted
- **Date:** 2026-09-04
- **Packages:** `@did-btcr2/method`, `@did-btcr2/bitcoin`, `@did-btcr2/common`, `@did-btcr2/api`, `@did-btcr2/cli`

## Context

The did:btcr2 specification, section "Process Beacon Signals", states the rule for a Beacon Signal transaction:

> A transaction MUST be included in a Bitcoin block and have at least `resolutionOptions.minConf` confirmations (`6` when not provided). Unconfirmed mempool transactions MUST NOT be processed.

The data structures section defines the option:

> `minConf`: OPTIONAL positive integer (minimum `1`). The minimum number of Bitcoin block confirmations required on a Beacon Signal transaction during resolution. Defaults to `6`.

The specification explains the default. Six confirmations is the accepted standard for a settled Bitcoin transaction. A resolution request can raise or lower `minConf` for its own threat model. A lower value raises the exposure to a block reorganization. The `confirmations` field of the resolution metadata lets a consumer judge that exposure.

The implementation applied neither rule. Indexer signal discovery pushed every transaction from the Esplora address listing that spends the beacon and carries a well-formed OP_RETURN. A mempool transaction has no block height and no block time. Discovery then produced a signal with an undefined time and a `NaN` confirmation count. The resolver built a date from the undefined time and failed with `Invalid date: Invalid Date`. The api surfaced that text as the failure of the whole resolution. `ResolutionOptions` had no `minConf` field. The resolver applied a signal at one confirmation, and at zero.

A user meets this state on an indexer that lags, or when a signal is still in the mempool. The end-to-end script hit it on regtest on 2026-09-04. The script mined six blocks and resolved before the indexer had them.

The write side already had a confirmation rule. ADR 063 and ADR 102 spend only a confirmed UTXO. ADR 063 rejected a configurable depth because the specification then mandated none. The specification now mandates a depth on the read side.

The Esplora status type declared the block fields as required. That declaration hid the defect from the compiler. A read of `block_height` on a mempool transaction type-checked.

## Decision

**Indexer discovery skips a transaction whose `status.confirmed` is not `true`.** An absent flag counts as unconfirmed, as it does for UTXO selection (ADR 063). The check runs before the OP_RETURN parse, so a mempool transaction costs no prevout fetch. The fullnode path needs no check. It walks mined blocks. The `confirmations` count keeps its formula, tip minus block height plus one, with the tip fetched before the listing. A block that arrives between the two calls yields a count of zero for its transactions. The resolver then excludes them. An under-count is the safe direction.

**The Resolver applies `minConf` at signal intake.** `ResolutionOptions` gains `minConf`. `DidBtcr2.resolve` passes it to the Resolver. In the BeaconProcess phase, the Resolver keeps only the signals of a service with an integer confirmation count of at least `minConf`. It then hands them to the beacon. An excluded signal emits no `NeedSignedUpdate`, `NeedCASAnnouncement`, or `NeedSMTProof`. The api then fetches nothing for it. One check covers the three beacon types. A service whose signals are all excluded is treated like a service with no signals.

**The threshold excludes. It does not halt.** The specification removes the transaction from the set of Beacon Signals. It does not stop the loop. The rest of the signals are processed. If version 2 sits below the threshold and version 3 sits above it, the update loop sees a gap and raises `LATE_PUBLISHING_ERROR`. That is the true state of the chain at that depth. The error clears when version 2 reaches the threshold. A singleton beacon that spends its own change output cannot produce this order. Version 3 spends the output of version 2, so version 3 cannot be deeper.

**`DEFAULT_MIN_CONF` is `6` and applies by default.** The constant is a named export of the method package. The api re-exports it. A limit that the specification does not mandate ships off by default in this codebase. This threshold is a validity rule that the specification mandates, so it ships on.

**The Resolver constructor validates `minConf`.** `undefined` selects the default. An integer of at least 1 is accepted. Every other value fails with a `ResolveError` of type `INVALID_OPTIONS`, before any data need is emitted. `INVALID_OPTIONS` is the DID Resolution v1.0 error code. Specification pull request 359 reuses it for did:btcr2 resolution options. The code is added to the shared error enum in the common package.

**An eligible signal with no valid block metadata fails fast.** A signal that passes the count but has no finite block height or block time is malformed. The Resolver throws a `ResolveError` of type `INVALID_DID_UPDATE` at intake, in the style of the `provide()` guards (ADR 055). The `Invalid date` failure class is gone.

**The Esplora status type is a union.** `TransactionStatus` is now `{ confirmed: true, block_height, block_hash, block_time }` or `{ confirmed: false }` with the block fields typed as absent. A read of a block field must narrow on `confirmed` first. Two method sites narrow: indexer discovery through the skip, and the UTXO comparator through a type predicate on the confirmed filter.

**The cli exposes `resolve --min-conf <n>`.** The flag accepts a positive integer. It overrides a `minConf` inside the JSON resolution options of `-r` or `-p`. The `update` and `deactivate` commands do not resolve today. They take the flag when they move onto the api methods that resolve first.

## Scope boundary

**`Resolver.updates()` does not change.** It is a public static method that takes update tuples. The specification rule sits upstream of the tuples.

**The write path does not change.** ADR 063 and ADR 102 keep the one-confirmation spendability rule for the UTXO that a signal spends. This record does not edit ADR 063.

**No metadata for excluded signals.** The specification defines none. The exclusion happens inside the sans-I/O Resolver, so the api logs nothing about it. The documentation carries the guidance instead.

**The other resolver changes of specification pull request 359 are not in scope.** They follow when the pull request merges.

## Consequences

**Positive.** Resolution conforms to the specification on both rules. A mempool signal no longer breaks resolution with a misleading date error. A consumer can raise `minConf` for a stricter settlement model. The compiler now rejects a read of a block field on an unconfirmed transaction.

**Negative.** A fresh update is invisible to a default resolve until its transaction has six confirmations. That is about three minutes on Mutinynet and about one hour on mainnet. A demo or a test that resolves right after a broadcast must pass `minConf: 1` or wait. The default resolve output changes for a DID with a shallow signal.

**Neutral.** The regtest end-to-end script mines six blocks per broadcast and waits for the indexer, so it passes at the default. The test vectors resolve with empty or six-deep signals and pass unchanged.

## Implementation

- `packages/bitcoin/src/types.ts`: the `TransactionStatus` union.
- `packages/common/src/errors.ts`: `INVALID_OPTIONS` in `MethodErrorCode` and in the export list.
- `packages/method/src/core/interfaces.ts`: `ResolutionOptions.minConf`.
- `packages/method/src/core/resolver.ts`: `DEFAULT_MIN_CONF`; `validateMinConf` in the constructor; the private intake filter; the BeaconProcess call; the JSDoc note on `updates()`.
- `packages/method/src/did-btcr2.ts`: passes `minConf` to the Resolver.
- `packages/method/src/core/beacon/signal-discovery.ts`: the skip in `indexer`.
- `packages/method/src/core/beacon/beacon.ts`: the `isConfirmedUtxo` predicate and the narrowed comparator.
- `packages/api/src/index.ts`: re-exports `DEFAULT_MIN_CONF`. `resolveDid`, `tryResolveDid`, `updateDid`, and `deactivateDid` carry `minConf` through `ResolutionOptions` with no code change (ADR 098).
- `packages/cli/src/commands/resolve.ts`: `--min-conf <n>`.
- `packages/api/lib/_e2e-helpers.ts` and `packages/api/lib/e2e-full-lifecycle.ts`: `confirmBroadcast` waits for a confirmation depth; `E2E_MIN_CONF` sets both the wait and the resolve threshold.
- `packages/method/lib/generate-vector.ts`: `resolve --min-conf <n>`.
- Tests:
  - Discovery skips a mempool transaction, a mempool-only listing, the mempool half of a mixed listing, and a transaction with no flag, with no prevout fetch.
  - The Resolver excludes at 5 and applies at 6 by default; `minConf` 1 and 10; six invalid values; a `NaN` or absent count; the gap case; the malformed metadata case; the `confirmations` metadata; the multi-round case.
  - The api passes `minConf` by reference and reports an invalid value with the root cause.
  - The cli forwards the flag, gives it precedence over the JSON, and rejects an invalid value.

## References

- Specification, "Process Beacon Signals" and "Resolution Options": the two rules quoted above.
- Specification pull request 359: the reuse of `INVALID_OPTIONS` from DID Resolution v1.0.
- DID Resolution v1.0, section "Errors": the definition of `INVALID_OPTIONS`.
- ADR 055 (harden the Resolver `provide()` trust boundary): the fail-fast style of the intake check.
- ADR 063 (harden beacon UTXO selection): the write-side confirmation rule and its "absent counts as unconfirmed" reading.
- ADR 085 (typed errors across core packages): the error classes and codes.
- ADR 097 (resolution failures carry their root cause): how the api surfaces the `INVALID_OPTIONS` message.
- ADR 098 (update source resolution accepts the caller's resolution options): how `updateDid` and `deactivateDid` inherit `minConf`.
- ADR 102 (the funding guard applies the beacon's spendability rule): the second write-side rule.

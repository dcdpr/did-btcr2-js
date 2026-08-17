---
title: "ADR 089: Aggregation Signing Preconditions for Cohort Members"
---

# ADR 089: Aggregation Signing Preconditions for Cohort Members

**Status:** Accepted

**Date:** 2026-08-19

**Branch / PR:** `fix/critical-high-security-findings`

**References:** [ADR 038](038-musig2-key-custody.md), [ADR 039](039-cohort-condition-model.md),
[ADR 040](040-multi-cohort-service-runner.md), [ADR 042](042-fault-tolerant-beacon-output.md),
[ADR 043](043-k-of-n-fallback-protocol.md), [ADR 044](044-beacon-change-output-address.md),
[ADR 045](045-analytical-vsize-aggregation-fees.md),
[ADR 059](059-unbounded-beacon-discovery-default.md), [ADR 066](066-x1-transport-authentication.md)

## Context

An aggregate beacon round has one asymmetry at its center: the coordinator builds everything and
the members sign it. The coordinator collects the members' updates, aggregates them (a CAS
Announcement Map or a Sparse Merkle Tree), derives the 32-byte beacon signal, selects a UTXO at
the cohort's beacon address, and constructs the transaction. Each member then contributes either a
MuSig2 partial signature on the optimistic key path or, when that path stalls, a standalone BIP-340
signature over the k-of-n script-path leaf ([ADR 042](042-fault-tolerant-beacon-output.md),
[ADR 043](043-k-of-n-fallback-protocol.md)). Both commit to the whole transaction under
`SIGHASH_DEFAULT`, including outputs no member chose.

Before this decision a member checked two things: that its own slot in the distributed data was
correct (its update hash appears in the CAS map, or its SMT proof verifies), and that *some* output
of the transaction was an `OP_RETURN` carrying the announced signal. Neither check connected to the
other, and neither connected to what a resolver would actually read:

- The announced `signalBytesHex` arrived verbatim on the distribution message and was never
  recomputed from the data the member had just validated. "My update is in this map" and "this map
  is what gets anchored" were independent statements, and only the first was checked. A coordinator
  could hand a member a map that includes it while anchoring the signal of a map that omits it, and
  every member-side check passed.
- Resolution reads a beacon signal from the transaction's **last** output only:
  `packages/method/src/core/beacon/signal-discovery.ts:140` (indexer path) and `:268` (full-node
  path) both take `vout.slice(-1)[0]`. Scanning every output therefore accepted transactions whose
  last output announced a different aggregation.
- A fallback authorization request carried its own transaction, and nothing compared it to the
  transaction of the optimistic round, so a member could be induced to authorize two competing
  spends of one UTXO through two different witnesses.
- On the service side, several receive handlers let an underlying cohort or signing-session
  invariant throw on sender-supplied input, and the runner turns any error escaping `receive()`
  into `removeCohort` plus a rejected completion. The per-cohort failure isolation of
  [ADR 040](040-multi-cohort-service-runner.md) does not help when the message is the thing that
  fails the cohort: one message from anyone able to reach the service ended an in-flight round.

This record fixes the preconditions a member applies before it signs and, just as importantly,
states what a member deliberately does not check, and why that is defensible.

## Decision

### 1. A member's signature is bound to the data that member validated

`AggregateBeaconStrategy` gains a required member, `deriveSignal(result)`
(`packages/aggregation/src/core/beacon-strategy.ts:60-72`). It recomputes the 32-byte signal from
the validation result the strategy just produced, using the same formula the service used on the
cohort:

- CAS returns `hash(canonicalize(casAnnouncement))` (`beacon-strategy.ts:99-104`), which is the
  derivation the service performs when it builds the announcement
  (`packages/aggregation/src/core/cohort.ts:380`). JCS sorts keys, so map insertion order cannot
  make the two disagree.
- SMT returns `base64UrlToHash(smtProof.id)` (`beacon-strategy.ts:148-158`), the root the member's
  inclusion (or cooperative non-inclusion) proof was just verified against.

The participant marks the round validated only when the strategy's own result is true **and** the
announced `signalBytesHex` equals the derived value
(`packages/aggregation/src/participant/participant.ts:519-528`), and every signing path requires
that flag (decision 2). Validation now covers both halves of the statement a member needs: this
data is right, and this data is what gets anchored.

The check lives on the strategy, not inline in each `validateParticipantView`, so the participant
enforces the binding for **every** beacon type. A custom strategy registered through
`registerBeaconStrategy` cannot silently reopen the gap by forgetting it, and a strategy with
nothing to derive from returns `undefined`, which the participant treats as a validation failure.
A strategy that cannot bind its signal fails closed rather than signing unbound. The derivation
must come from the validated data, never from the announced signal echoed back out of the message
body, which would bind the data to itself and authorize anything.

This is a **compile break for any external strategy implementor**: `deriveSignal` is a required
interface member, so an out-of-tree `AggregateBeaconStrategy` fails to typecheck until it
implements one. That is deliberate; a silently-optional member would leave the binding to whoever
remembers it.

### 2. A signable beacon transaction has a fixed shape

`#assertSignableBeaconTx` (`packages/aggregation/src/participant/participant.ts:663-747`) runs on
both signing paths (`approveNonce` and `approveFallback`) and refuses to sign unless all of the
following hold:

1. the member validated the distributed data and the announced signal is bound to it (decision 1);
2. the transaction spends **exactly one** input;
3. the **last** output's script is byte-for-byte `OP_RETURN OP_PUSHBYTES_32 <validated signal>`;
4. that output's amount is zero;
5. it is the transaction's only `OP_RETURN` output;
6. the sum of the outputs does not exceed the value of the input.

Rule 3 is the load-bearing one and it comes straight from the read path. Because discovery reads
only the last output (`signal-discovery.ts:140`, `:268`), a signal placed anywhere else announces
nothing any resolver will ever read, and a member asked to sign such a transaction is being asked
to authorize a no-op while some other aggregation occupies the position that counts. Pinning the
exact script bytes also makes "I signed this" and "resolvers will read this" one statement, since
the required bytes are precisely the shape the extraction routine accepts.
[ADR 044](044-beacon-change-output-address.md) decision 4 already fixed the signal as the last
output on the build side; this makes it a signing precondition rather than a builder convention.

Rule 2 is not cosmetic. The protocol conveys a single prevout script and value, which is less than
a BIP-341 sighash over multiple inputs needs, so a multi-input transaction is one a member can
neither check nor correctly sign. Refusing it outright replaces a silently wrong sighash with a
typed error. Rules 4, 5 and 6 keep the transaction to a shape that can confirm and whose implied
fee is a real number.

These rules are an **interop contract on any coordinator implementation**, not only on ours: a
coordinator that assembles beacon transactions differently (signal not last, a second data output,
multiple inputs) will collect no signatures from a conforming member. Our own builder,
`buildAggregationBeaconTx` (`packages/method/src/core/beacon/beacon.ts`), already emits exactly
this shape (one input, change first, `OP_RETURN` last at value zero).

### 3. Change destination and fee are not member-checkable; the beacon address already surrendered custody

A member does **not** check where the change goes or how large the fee is. A recommendation
considered for this code was to require "exactly one change output paying the cohort beacon
address" plus an input-minus-change figure inside an agreed fee envelope, on the theory that a
coordinator could otherwise build `[OP_RETURN <valid signal>, <entire balance to itself>]` and
collect honest signatures for a drainer. **The change-destination half of that prescription is
rejected. The fee half is accepted in principle and deferred as a follow-up (see below).**

**Why the change-destination rule is refused.** It directly contradicts
[ADR 044](044-beacon-change-output-address.md) decisions 1 and 5, which made the change destination
a caller-supplied address defaulting to the beacon address, precisely so that change rotation is
available as a privacy lever, and which name the operator's funding wallet as the legitimate
change destination for an operator-funded cohort. That is not an aspiration: it is implemented as
the `changeAddress` option on `buildAggregationBeaconTx`
(`packages/method/src/core/beacon/beacon.ts:384-396`). A member has no way to distinguish a
rotated change address from a drain address, because there is nothing to distinguish: both are
"an address the funder named that is not the beacon address". The rule would therefore forbid a
shipped, deliberate design while blocking nothing an attacker cannot do another way.

**The argument that does not work, and must not be repeated.** It is tempting to say the
coordinator is the funder by construction, so a drain only takes the coordinator's own money.
Nothing in the code or the protocol establishes that:

- Nothing authenticates who funded the beacon address. `fetchSpendableUtxo`
  (`packages/method/src/core/beacon/beacon.ts:349-352`) selects whatever spendable UTXO sits at the
  address; the chain records no notion of a legitimate funder.
- Anyone can pay a Bitcoin address, and under ADR 044's default the change of each round returns to
  the beacon address, so a cohort's balance accumulates from whatever sources reached it.
- Running a coordinator is not privileged. `AggregationService` needs a DID and a public key; any
  party with a keypair can advertise a cohort.
- Participant funding is documented, not hypothetical: `packages/method/docs/aggregation.md:752-757`
  describes a "first-update funding" pattern in which a participant's own transaction funds the
  beacon address.

**The argument that does work.** The beacon address's script tree has already surrendered custody
before any transaction is built. The output commits to two script leaves alongside the MuSig2
internal key ([ADR 042](042-fault-tolerant-beacon-output.md)):

- the CSV recovery leaf, `<recoverySequence> CHECKSEQUENCEVERIFY DROP <recoveryKey> CHECKSIG`
  (`packages/aggregation/src/core/recovery-policy.ts:183-198`), spendable **unilaterally** by the
  holder of the recovery key the cohort advert named, once the relative timelock elapses; and
- the k-of-n fallback leaf (`recovery-policy.ts:154-166`), spendable **immediately** by any k
  cohort members, with k defaulting to n-1 when the advert does not set it
  (`recovery-policy.ts:119-128`).

So anyone who funds a cohort beacon address, operator, participant or bystander, has already handed
the advertised recovery-key holder (after a delay) and any k members (at once) everything at that
address. A coordinator that drains the UTXO through a signed round removes the timelock delay; it
does not take anything that was not already exposed by the act of funding. Refusing to sign would
not protect the funds, because the fallback leaf can spend them without the honest members'
cooperation in the first place. This is a property of the fault-tolerant output design, and it is
the thing operators and funders must be told before they send coins to a cohort address: **funding
a beacon address is trusting the recovery-key holder and any k members with the balance.**

**Residual, stated plainly.** With no fee ceiling, a member will sign a transaction whose fee is
anything up to the input value minus the outputs. The griefing variant of the attack (burn the
entire UTXO as fees, announcing nothing of value to anyone) is therefore not structurally refused;
only the drain-to-an-address variant is genuinely indistinguishable from legitimate change. The
recommended follow-up is an **absolute fee cap on the participant side**, checked in
`#assertSignableBeaconTx` against the input value and the analytical vsize the fee model already
computes ([ADR 045](045-analytical-vsize-aggregation-fees.md)). Unlike the resource guards this
repository ships off by default ([ADR 059](059-unbounded-beacon-discovery-default.md)), that cap is
a validity guard on money the member is being asked to help commit, not a tunable resource bound,
so it belongs **on by default** with a sane ceiling rather than as an opt-in limit.

**The participant-funded gap.** All of the above holds only while the participant-funded model
remains unreachable. `buildRecoveryLeaves` throws `UNSUPPORTED_FUNDING_MODEL` for
`participant-funded` (`packages/aggregation/src/core/recovery-policy.ts:226-230`), and that throw
sits upstream of the only place the MuSig2 key-path tweak is ever set:
`AggregationCohort.computeBeaconAddress` calls `buildRecoveryLeaves` before assigning `tapTweak`
(`packages/aggregation/src/core/cohort.ts:244` and `:262`), and that method is what both the
service (when it finalizes the cohort) and every participant (inside `validateMembership`) call to
obtain the beacon address. A participant-funded cohort therefore cannot derive an address, cannot
reach the ready phase, and cannot produce any signature at all. When participant funding is
implemented, per-participant funds are at stake in a way they are not today, and the change and fee
envelope must be reconsidered as part of that work: the reasoning above expires with the throw.

### 4. A fallback signature is bound to the optimistic round

A `FALLBACK_AUTHORIZATION_REQUEST` is accepted only when it carries the optimistic round's session
id and a byte-identical transaction (`packages/aggregation/src/participant/participant.ts:919-922`),
and `approveFallback` re-asserts the transaction comparison at the signature boundary
(`#assertMatchesOptimisticTx`, `participant.ts:750-760`). Without it, a coordinator that has already
collected a member's optimistic partial signature for transaction A can obtain that member's
script-path signature for a different transaction B, and then holds two competing spends of one
UTXO: a complete key-path signature for A and a k-of-n script-path witness for B, free to broadcast
whichever suits it.

The comparison runs **before** the secret-nonce wipe and the phase change, not after. The wipe was
previously unconditional, so a single unsolicited message from anyone able to reach the member
destroyed the member's in-flight optimistic round for free. A member that has sent its validation
but was never sent an authorization request has no optimistic transaction on record and is not held
to the comparison: it authorizes exactly one transaction either way, and refusing there would break
the legitimate case the fallback exists for, a member that never heard from the coordinator.

**Known residual: the fallback sighash is not bound to the member's own beacon output.**
`approveFallback` computes the BIP-341 script-path sighash over the coordinator-supplied
`req.prevOutScriptHex` (`participant.ts:954` and `:970`) and never compares it to the member's own
cohort. This is asymmetric with the optimistic path, where a key-path partial signature is computed
under the member's locally derived `tapTweak` and is worthless against any other output. A fallback
signature is a plain BIP-340 signature whose only cohort-specific ingredients are the leaf script
and the asserted prevout, and `buildFallbackLeaf` derives the leaf from the sorted cohort key set
and k alone (`recovery-policy.ts:162-166`), so two cohorts run by **different services over the same
member set with the same k have byte-identical fallback leaves**. A service can therefore ask its
members to fallback-sign a transaction that spends another cohort's UTXO (naming that cohort's
outpoint, script and value) while anchoring its own signal, and k signatures suffice to complete
that spend. The fix is one comparison: require the request's `prevOutScriptHex` to equal the output
script of `state.cohort.beaconAddress`, which the member computed for itself in
`validateMembership` (`packages/aggregation/src/core/cohort.ts:279-298`) and already holds. It is
recorded here as a follow-up rather than folded into this change, and it is the highest-value of
the residuals in this record.

### 5. `receive()` never throws

`AggregationService.receive()` carries an invariant: **no single inbound message, from anyone able
to reach the service, may fail a cohort.** Every receive handler validates what the message claims
(membership in the cohort, whether this sender has already answered this round or session, and the
cryptographic validity of what it carries) **before** it touches cohort or signing state, and
records a `Rejection` for what it drops instead of letting an underlying invariant throw. The
invariant is stated on the method rather than delegated to a list of handlers, so it continues to
hold as handlers are added or extended. Operator-facing action methods (`acceptParticipant`,
`startSigning` and their siblings) still throw: those report programming errors in the caller, not
untrusted input, and the runner's catch-all remains as a backstop for genuine internal faults.

Nonce contributions and partial signatures are verified **on arrival** rather than at round
completion (`packages/aggregation/src/core/signing-session.ts` exposes the checks that nonce
aggregation and final-signature assembly ran internally). This is what makes a bad contribution
blame its sender instead of failing the round: the contribution is not stored, so the same sender
can immediately send a correct one and still complete the round it was blamed in. The cost is that
a round whose members never send valid contributions now stalls instead of failing fast, which is
exactly the posture already in place for a silent member and is covered by the existing
`phaseTimeoutMs`, `cohortTtlMs` and `autoFallbackOnStall` settings.

Because the receive path records a rejection for messages from non-members, the rejection log is
written by anyone who can reach the service, and it is therefore bounded unconditionally at
`MAX_RETAINED_REJECTIONS` (`packages/aggregation/src/service/service.ts`). This is not the class of
limit this repository ships off by default ([ADR 059](059-unbounded-beacon-discovery-default.md)):
it refuses no protocol traffic, it only discards diagnostics, and what it bounds is memory an
unauthenticated sender can force the service to hold. Two weaknesses of the current bound are
accepted for now and recorded:

- it is a module constant, not caller-configurable, unlike the update-size cap declared immediately
  above it (`maxUpdateSizeBytes`, defaulting to `DEFAULT_MAX_UPDATE_SIZE_BYTES`), which a caller can
  size to its deployment; and
- it drops the **oldest** entries with no overflow counter, so a caller that drains lazily loses the
  first evidence of an attack and cannot tell that anything was lost. A counter, or dropping the
  newest once full, would preserve the opening of the sequence; neither is implemented here.

## Consequences

- A member's signature now asserts a single connected statement: "the data I validated is the data
  this transaction anchors, in the position a resolver reads, spending one input I was told about."
  Coordinator equivocation between distributed data and anchored signal is closed for both built-in
  beacon types and for any future one, because the binding is enforced by the participant over the
  strategy interface.
- `AggregateBeaconStrategy.deriveSignal` is a required member: out-of-tree strategies fail to
  compile until they implement it. `PendingValidation.matches` is now false in cases it was
  previously true (validated slot, unbound signal), so the default approve-if-matches policy
  rejects those rounds, and a custom policy that approves anyway is still refused at the signature
  boundary. `approveNonce` and `approveFallback` raise typed errors for transactions they previously
  signed. These ride an `@did-btcr2/aggregation` minor bump under 0.x semantics.
- Coordinators are constrained: signal last, exactly one data output, one input, no value burned in
  the signal output, outputs within the input. Multi-input beacon spends are refused outright rather
  than mis-signed; supporting them later requires the authorization message to carry every prevout
  script and value, which the signing session's sighash already accepts as arrays.
- Cohort funding is a custody decision, not merely an operational one. Whoever funds a beacon
  address trusts the advertised recovery-key holder and any k members with the balance. That should
  be stated wherever operators are told how to fund a cohort.
- A cohort can no longer be killed by one message, at the price of stalling instead of failing fast
  when contributions never arrive; deployments must set the timeout and auto-fallback knobs so
  stalls terminate in bounded time.
- Follow-ups this record deliberately leaves open, in priority order: bind the fallback sighash's
  prevout script to the member's own beacon output (decision 4); add a default-on absolute fee cap
  on the participant side (decision 3); make the rejection bound configurable and count overflow
  (decision 5); revisit change and fee validation in full when the participant-funded model is
  implemented (decision 3).

## Rejected alternatives

- **"Exactly one change output paying the cohort beacon address", plus an input-minus-change fee
  envelope.** Rejected for the change destination (see decision 3): it contradicts
  [ADR 044](044-beacon-change-output-address.md) decisions 1 and 5, forbids the shipped change
  rotation lever and the operator's funding wallet as a destination, and protects funds that the
  beacon output's own script tree has already surrendered to the recovery-key holder and to any k
  members. Accepted in principle for the fee ceiling, deferred as a follow-up.
- **Recomputing the signal inside each strategy's `validateParticipantView`.** Keeps the change
  local, but leaves the binding optional for every future strategy: an implementor who returns
  `matches: true` without the comparison silently reopens the equivocation. A separate required
  member lets the participant, which is the party with something at stake, enforce it once for all
  beacon types and fail closed when a strategy cannot derive.
- **Deriving the expected signal from the announced value in the message body.** Trivially
  self-satisfying: it binds the data to itself and authorizes anything. Called out explicitly in the
  strategy documentation so an implementor does not reach for it.
- **Checking only that the signal appears in some output (the previous behavior).** Accepts
  transactions whose last output announces a different aggregation, which is the equivocation of
  decision 1 achieved without touching the distributed data at all. The position is part of the
  announcement, not a formatting detail.
- **Continuing to fail the cohort on an invalid contribution ("fail fast").** Turns every validation
  error into a denial of service that any reachable party can trigger, and defeats the
  blame-and-retry intent already present in the signing session. Stalling plus the existing timeouts
  is the same posture the protocol already takes for a member that says nothing at all.
- **Making the rejection-log bound opt-in, consistent with the resource guards this repository
  defaults to off.** Rejected because the log is written by unauthenticated senders and bounding it
  refuses no protocol traffic: only diagnostics are discarded. An unbounded log would be a memory
  exhaustion vector available to anyone who can reach the service.

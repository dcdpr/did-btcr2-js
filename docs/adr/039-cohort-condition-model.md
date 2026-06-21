---
title: "ADR 039: Cohort Condition Model"
---

# ADR 039: Cohort Condition Model

**Status:** Accepted

**Date:** 2026-06-21

**Branch / PR:** `feat/aggregation-cohort-conditions`
**References:** [ADR 008](008-aggregation-subsystem-inception.md), [ADR 020](020-aggregation-layered-architecture.md), [ADR 027](027-aggregation-security-hardening.md), [ADR 038](038-musig2-key-custody.md)

## Context

When an Aggregation Service creates a cohort, it advertises the conditions under which prospective participants may enroll. The did:btcr2 specification ([Aggregate Beacons, "Step 1: Create Aggregation Cohort"](https://dcdpr.github.io/did-btcr2/beacons/aggregate-beacons.html#step-1-create-aggregation-cohort), source `src/beacons/aggregate-beacons.md`, last substantively edited 2026-05-26) enumerates the conditions a service **can** define:

> When defining an Aggregation Cohort, the Aggregation Service **can** define conditions **such as**:
> - Beacon Type (CAS or SMT);
> - Minimum and/or maximum number of Aggregation Participants;
> - Minimum and/or maximum number of DIDs per Aggregation Participant;
> - Cost of enrollment;
> - Cost per announcement per DID or Aggregation Participant;
> - Minimum and/or maximum time between announcements; and
> - Number of pending updates that trigger an announcement.

The phrasing ("**can** define conditions **such as**") makes this an **illustrative, optional menu**, not a closed normative set: the spec also declares the full coordination protocol out of scope. The repo's `TODO.md` records the same seven and notes the implementation "only defines three."

**What the implementation models today** (verified against `service.ts`, `cohort.ts`, `messages/bodies.ts`):

- `CohortConfig` has exactly three fields: `minParticipants`, `network`, `beaconType`. Of the spec's seven conditions, only **beacon type** and **a participant floor** are modeled (`network` is a separate cohort parameter, not one of the seven).
- The participant floor is carried on the wire as `cohortSize` (`CohortAdvertBody.cohortSize`), sourced from `config.minParticipants` and read back by the participant as `minParticipants`. The name implies an exact target; the service enforces it **only as a lower bound** at `finalizeKeygen` (`accepted >= minParticipants`). A participant cannot tell from the advert whether the number is a floor, a target, or a cap.
- **No maximum exists anywhere.** `acceptParticipant()` appends unconditionally, so a cohort can grow without bound (the unbounded-growth concern carried over from the [ADR 038](038-musig2-key-custody.md) milestone notes).
- **No validation.** `createCohort()` accepts any `minParticipants` (including 0 or negative); `AggregationCohort` silently coerces a falsy value to 2 via `|| 2`; the participant defaults a missing `cohortSize` to `0`; advert guards check only that `cohortSize` is a number, never its range.
- The other five conditions (DIDs-per-participant, cost of enrollment, cost per announcement, timing/cadence, pending-update-count trigger) are **entirely absent** from the config, the wire format, and the state machines.

**Prior decisions to reconcile:**

- [ADR 008](008-aggregation-subsystem-inception.md) deliberately put economics out of scope: *"No incentive mechanism ... the protocol makes the cryptography possible without mandating an economic model."* Two of the seven conditions (cost of enrollment, cost per announcement) are economic.
- [ADR 027](027-aggregation-security-hardening.md) introduced a **Cohort TTL** (timed-out cohorts transition to `Failed`) and **idempotent membership** (a re-opt-in from an accepted DID does not get a second slot). These are the hooks any timing and DIDs-per-participant conditions must build on.
- The aggregation milestone **locked an advertise-only economics decision**: model and advertise the cost conditions, do not implement payment/settlement now. The spec agrees: it lists costs as advertised conditions but defines no settlement, escrow, or billing.

| # | Spec condition | Modeled today | This ADR: how handled |
| --- | --- | --- | --- |
| 1 | Beacon Type (CAS / SMT) | yes | keep; validate at `createCohort` |
| 2 | Min / max participants | floor only (as `cohortSize`) | **enforced**: rename to `minParticipants` + optional `maxParticipants`; gate accept + finalize |
| 3 | Min / max DIDs per participant | no | model now; **enforcement staged** (couples to the submission model / AGG-5) |
| 4 | Cost of enrollment | no | model now; **advertised-only**, no settlement |
| 5 | Cost per announcement | no | model now; **advertised-only**, no settlement |
| 6 | Min / max time between announcements | no (TTL is adjacent) | model now; **enforcement staged** (generalizes the ADR 027 TTL; couples to multi-round/AGG-5) |
| 7 | Pending-update-count trigger | no (`hasAllUpdates` only) | model now; **enforcement staged** (generalizes `hasAllUpdates`; couples to AGG-5) |

## Decision

Adopt the spec's seven conditions as an explicit, mostly-optional **cohort-condition model** carried in `CohortConfig` and the `COHORT_ADVERT` body. Enforce the self-contained structural conditions now; model the rest as a stable wire format with enforcement staged to the tracks they couple to; advertise economics without settlement.

1. **Introduce a `CohortConditions` structure** (embedded in `CohortConfig` and serialized into `CohortAdvertBody`). `beaconType` and `minParticipants` are required; every other condition is **optional, and absent means unconstrained** - matching the spec's "can define ... such as" menu. Sketch:

   ```ts
   interface CohortConditions {
     beaconType: 'CASBeacon' | 'SMTBeacon';        // 1  required
     minParticipants: number;                       // 2  required (lower bound)
     maxParticipants?: number;                      // 2  optional (upper bound)
     minDidsPerParticipant?: number;                // 3  optional
     maxDidsPerParticipant?: number;                // 3  optional
     costOfEnrollment?: CohortCost;                 // 4  optional, advertised-only
     costPerAnnouncement?: CohortCost;              // 5  optional, advertised-only
     minSecondsBetweenAnnouncements?: number;       // 6  optional
     maxSecondsBetweenAnnouncements?: number;       // 6  optional
     pendingUpdateTrigger?: number;                 // 7  optional
   }
   interface CohortCost { amount: number; unit: string; basis?: 'per-did' | 'per-participant'; }
   ```
   `network` stays a separate cohort parameter (it is not one of the seven conditions).

2. **Replace the conflated `cohortSize` wire field** with an explicit `minParticipants` + optional `maxParticipants` pair. This is a breaking change to the `COHORT_ADVERT` body; pre-1.0, a clean rename is preferred over keeping a misleadingly-named field.

3. **Enforce the structural participant bounds now.** `maxParticipants` gates `acceptParticipant()` (reject once the cohort is full) and is a ceiling at `finalizeKeygen`; `minParticipants` remains the finalize floor. This closes the unbounded-growth path.

4. **Validate conditions fail-fast at `createCohort()`** rather than discovering invalidity at finalize: `minParticipants >= 1`, `maxParticipants >= minParticipants` when present, `min* <= max*` for every paired bound, non-negative costs and counts. Remove the `|| 2` silent default-drift (reject a missing/zero `minParticipants` instead of coercing it) and the participant's `?? 0` silent zero-floor (reject a malformed advert). Make the advert/opt-in guards range-check, not presence-check.

5. **Economics are advertised-only.** `costOfEnrollment` and `costPerAnnouncement` are operator-published metadata a participant uses to decide whether to join. The service performs **no payment, settlement, escrow, or enforcement** of them - consistent with [ADR 008](008-aggregation-subsystem-inception.md) ("no economic model mandated") and the spec (which advertises costs but defines no settlement). A future payment milestone, if any, gets its own ADR.

6. **Model the remaining conditions now, stage their enforcement.** Add the wire/config fields for DIDs-per-participant (3), timing/cadence (6), and the pending-update-count trigger (7) so the advert format is stable before multi-cohort (AGG-4) builds on it, but land full enforcement with the tracks they couple to: DIDs-per-participant and the update-count trigger depend on the multi-DID / long-standing-cohort submission model from non-inclusion (AGG-5); `maxSecondsBetweenAnnouncements` generalizes the [ADR 027](027-aggregation-security-hardening.md) Cohort TTL, and `pendingUpdateTrigger` generalizes `hasAllUpdates()` (announce at a threshold, not only when all participants have submitted). Fields modeled-but-not-yet-enforced are documented as such so the advert never implies enforcement that does not exist.

7. **Conditions are advisory to participants, structural to the service.** Per the spec, the advertised conditions let a participant decide whether to enroll; the service enforces only the structural subset (participant bounds now; DIDs-per-participant, timing, and trigger as they land).

### Rejected alternatives

- **Keep `cohortSize`, add `maxParticipants` beside it.** Perpetuates the floor-vs-exact ambiguity and the misleading name. Pre-1.0, a clean rename to a `minParticipants`/`maxParticipants` pair is clearer than layering a second field onto a misnamed one.
- **Implement payment / settlement for the cost conditions.** Out of scope per [ADR 008](008-aggregation-subsystem-inception.md), the spec (no settlement defined), and the locked milestone decision. Advertise-only keeps the protocol honest about what it enforces.
- **Model only the structural conditions, skip the rest.** Leaves the advert format unstable for multi-cohort (AGG-4) and diverges from the spec's menu. Modeling all seven now (even with staged enforcement) freezes the wire format once.
- **Treat the seven as a closed MUST-set.** The spec says "can define ... such as" - an open, optional menu. The model uses optional fields (absent = unconstrained) and stays extensible rather than mandating all seven.

## Consequences

**Positive**
- The advert format mirrors the spec's condition menu and is stable for multi-cohort (AGG-4) to build on without re-churn.
- The `minParticipants`/`maxParticipants` pair closes the unbounded-cohort growth path and removes the `cohortSize` floor-vs-exact ambiguity; participants can read the real bounds.
- Fail-fast validation surfaces a bad `CohortConfig` at creation instead of at finalize, and the guards stop accepting out-of-range adverts.
- Economics are represented honestly: advertised metadata, not enforcement the protocol cannot back.

**Negative**
- Breaking change to the `COHORT_ADVERT` body (`cohortSize` to `minParticipants` + `maxParticipants`, plus new optional condition fields) and to `CohortConfig` - a `method` version bump; advertise and participant-side parsing change together.
- Some conditions are modeled but not yet enforced (DIDs-per-participant, timing, update-count trigger). This must be clearly documented in code and types so callers do not assume enforcement that is staged.

**Accepted**
- Economics are advertise-only with no settlement for the foreseeable future; a payment model, if ever, is a separate milestone and ADR.
- DIDs-per-participant, timing/cadence, and pending-update-count enforcement are staged to AGG-4 (multi-cohort) and AGG-5 (non-inclusion / long-standing cohorts), which own the submission and multi-round mechanics those conditions need.
- **Spec-silent choices made here** (flagged for review): cost is modeled as `{ amount, unit, basis }` with an operator-defined `unit` (the spec gives no currency or units); conditions are serialized as explicit advert-body fields rather than a nested object (wire-shape detail the spec does not constrain). Both are reversible during implementation if preferred.

## References

- [did:btcr2 spec - Aggregate Beacons, Step 1: Create Aggregation Cohort](https://dcdpr.github.io/did-btcr2/beacons/aggregate-beacons.html#step-1-create-aggregation-cohort) (source: `src/beacons/aggregate-beacons.md`): the authoritative seven-condition menu.
- [`packages/method/src/core/aggregation/service.ts`](../../packages/method/src/core/aggregation/service.ts): `CohortConfig`, `createCohort`, `advertise`, `acceptParticipant`, `finalizeKeygen` - where conditions are set and (under-)enforced.
- [`packages/method/src/core/aggregation/messages/bodies.ts`](../../packages/method/src/core/aggregation/messages/bodies.ts): `CohortAdvertBody` and the guards to range-check.
- [`packages/method/src/core/aggregation/cohort.ts`](../../packages/method/src/core/aggregation/cohort.ts): `AggregationCohortParams`, the `|| 2` default to remove.
- [ADR 008](008-aggregation-subsystem-inception.md): economics out of scope (this ADR extends, does not contradict, that boundary). [ADR 020](020-aggregation-layered-architecture.md): the cohort-formation API surface. [ADR 027](027-aggregation-security-hardening.md): the Cohort TTL and idempotent-membership rules the timing and DIDs-per-participant conditions build on. [ADR 038](038-musig2-key-custody.md): the prior aggregation milestone stage.

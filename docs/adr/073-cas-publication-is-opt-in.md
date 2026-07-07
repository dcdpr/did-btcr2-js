---
title: "ADR 073: CAS Publication Is Opt-In - Default publishToCas to 'never' and Make 'auto' Non-Blocking"
---

# ADR 073: CAS Publication Is Opt-In - Default publishToCas to 'never' and Make 'auto' Non-Blocking

**Status:** Accepted

**Date:** 2026-07-07

**Branch / PR:** `feat/cli-cas-rpc-url`

**References:** [ADR 070](070-broadcast-result-and-cas-first-ordering.md), [ADR 071](071-api-cas-publication-policy.md)

## Context

[ADR 071](071-api-cas-publication-policy.md) introduced the api's `publishToCas` policy with a default of `'auto'`, where `'auto'` publishes when a writable CAS is configured and, for **CAS beacons only**, throws up-front when no writable CAS is available. The stated reasoning was that a CAS beacon signal points at an announcement that "must be retrievable somewhere," so refusing to broadcast prevents a resolution failure.

That reasoning was wrong on the method's own principle: **CAS publication is optional and never required.** Every update, for every beacon type including a CAS beacon, can be completed and distributed entirely via sidecar. A CAS beacon's announcement is returned in `DidUpdateResult.announcement` precisely so the caller can distribute it out-of-band; sidecar-only distribution is a first-class, always-available path, not a footgun to be guarded against.

Under ADR 071's default, two behaviors violated that principle:

1. **Publishing happened without being asked.** With the default `'auto'` and any writable CAS configured (including one set up only for reads), every canonical signed update was published to a possibly-public store as a side effect of configuration. That is opt-out.
2. **Sidecar-only was blocked for CAS beacons.** With the default `'auto'`, a CAS beacon update with no writable CAS threw up-front. Completing it sidecar-only required explicitly passing `'never'`. That makes CAS publication effectively required for CAS beacons, contradicting "never required."

In short, ADR 071 made CAS publication opt-out (and mandatory for one beacon type), when it must be opt-in.

## Decision

1. **The default is `'never'`.** Out of the box, `DidMethodApi.update`, `DidBtcr2Api.updateDid`, and `UpdateBuilder` publish nothing. A configured CAS never causes publication on its own; the caller opts in explicitly.

2. **`'auto'` is best-effort and never blocks.** It publishes the signed update (all beacon types) and the CAS Announcement (CAS beacons) when a writable CAS is configured; otherwise it skips publication silently for **every** beacon type (CAS beacons included) and returns the artifacts for sidecar distribution. The CAS-beacon up-front throw from ADR 071 is removed.

3. **`'always'` is unchanged.** It requires a writable CAS and throws up-front for every beacon type when none is available. This is the explicit opt-in for a hard guarantee that the artifacts reached the CAS; the caller asked for a promise that cannot be met, so failing is correct.

Resulting policy:

| Policy | Writable CAS | Read-only / no CAS |
|---|---|---|
| `'never'` (default) | publish nothing | publish nothing |
| `'auto'` | publish update (+ announcement for CAS) | skip silently, all beacon types |
| `'always'` | publish update (+ announcement for CAS) | throw up-front, all beacon types |

This supersedes ADR 071's decision 2 (the `'auto'` default and its CAS-beacon asymmetry). ADR 071's other decisions (the `canPublish`/`writable` capability detection, the update-then-announcement-then-broadcast ordering, the enriched `DidUpdateResult`, `broadcastOptions` passthrough, and the `resolve()` `NeedSMTProof` fail-fast) stand unchanged.

## Consequences

- CAS publication is now genuinely opt-in and never required. No update, for any beacon type, is ever blocked for lack of a writable CAS. Sidecar-only is the default distribution path.
- **Behavior change for library callers relying on the ADR 071 default:** a caller who previously depended on the implicit `'auto'` now publishes nothing unless it passes `'auto'` or `'always'`. This is a deliberate correction; it ships as a minor bump at 0.x. Callers that want the old auto-publish behavior pass `publishToCas: 'auto'` explicitly.
- A read-only or absent CAS under `'auto'` no longer errors; a CAS beacon update simply completes sidecar-only and returns its announcement. `'always'` remains the way to demand a writable CAS.
- **Privacy improves by default:** canonical signed updates are no longer published to a possibly-public CAS as a side effect of the default. Publication to a public store now requires an explicit `'auto'`/`'always'`.
- The cli, which already defaults its `--publish-to-cas` flag to `'never'`, is now simply consistent with the api default rather than diverging from it (see [ADR 072](072-cli-writable-cas-and-publish-flag.md)).

## Rejected alternatives

- **Keep the CAS-beacon up-front throw under `'auto'`, only change the default.** Fixes the opt-out default but leaves CAS publication mandatory-under-`'auto'` for CAS beacons, so an explicit `'auto'` on a CAS beacon with no writable CAS would still block a valid sidecar-only update. Half a fix.
- **Drop `'auto'` entirely; support only `'never'` and `'always'`.** Maximally explicit, but it removes the useful "publish if I can, otherwise proceed" mode and is a larger breaking change to the enum for no principled gain: an explicitly-chosen `'auto'` is already a clear opt-in.
- **Warn (log) when `'auto'` skips a CAS beacon publish.** A skipped publish under `'auto'` is the requested best-effort behavior, not an anomaly; the artifacts are returned for sidecar use. A warning would train callers to ignore logs. Callers who require publication use `'always'`.

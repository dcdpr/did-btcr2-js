---
title: "ADR 084: Publish the Coverage Badge from CI to a Dedicated Branch"
---

# ADR 084: Publish the Coverage Badge from CI to a Dedicated Branch

**Status:** Accepted

**Date:** 2026-07-16

**Branch / PR:** `chore/ci-badge-and-wallet-send`

**References:** [ADR 064](064-foss-coverage-and-dependency-audit-gate.md)

## Context

ADR 064 introduced FOSS, in-repo coverage reporting: every package's `c8` output is
aggregated by `scripts/coverage-report.mjs` into a self-rendered SVG badge and a
`COVERAGE.md` table, with no third-party coverage service involved. It deliberately made
regeneration a human-run step: the badge and report were normal tracked files on `main`,
refreshed by whoever ran `pnpm coverage`, and CI never committed anything. The accepted
consequence was drift: the badge only moved when an author remembered to regenerate it.

That drift turned out to be the norm, not the exception. CI already computes the real
number on every push (the `coverage:report` step feeds the job summary), while the badge
on `main` shows whatever the last manual regeneration happened to capture. A badge that
is routinely stale is worse than no badge: it reports a number nobody is maintaining as
if it were current. The requirement is now: **the badge must reflect every CI run on
`main`, automatically.**

The constraints from ADR 064 still stand and are not revisited here: no SaaS coverage
service, no badge-rendering service, the badge stays a locally generated SVG, and
`main`'s history stays human-authored (no automated commits interleaved with curated,
squash-rebased work).

## Decision

### CI publishes the badge and report to a dedicated `ci-badges` branch

- **On every `main` run**, after the existing `coverage:report` step, CI commits the
  regenerated `.github/badges/coverage.svg` and `COVERAGE.md` to a dedicated `ci-badges`
  branch and force-pushes it. The branch is created as an orphan on each publish, so it
  always contains exactly one commit holding exactly two files: it has no history worth
  preserving, and force-pushing makes concurrent runs a last-writer-wins non-event
  rather than a push race.
- **`main` no longer tracks the artifacts.** The committed copies are removed,
  `/.github/badges/` and `/COVERAGE.md` are git-ignored, and the README badge points at
  the `ci-badges` copy (`raw.githubusercontent.com/.../ci-badges/...` for the image,
  the branch's `COVERAGE.md` blob for the click-through). Local `pnpm coverage` runs
  still produce both files for inspection; they just no longer dirty the tree.
- **The publish step is `main`-gated and non-recursive.** It runs only for
  `refs/heads/main`. Pushes made with the workflow's own `GITHUB_TOKEN` cannot trigger
  workflows (a GitHub Actions guarantee), and the commit message carries `[skip ci]` as
  documentation of that intent. The job gains `permissions: contents: write` for the
  push; every other step only reads.
- **Failure stays advisory.** `coverage:report` keeps `continue-on-error: true`; if it
  produced no artifacts, the publish step logs and exits zero, leaving the previous
  badge in place. A missing badge never fails an otherwise green build.

### What this supersedes, and what stands

This ADR supersedes exactly one element of ADR 064: "regeneration is a committed,
human-run step, not a CI push" and the accepted badge-drift consequence that came with
it. It does so while honoring the reasons that decision was made: `main` still contains
no automated commits (the bot writes only to a disposable side branch), and the
loop-avoidance complexity that ADR 064 declined to take on is addressed by the platform
itself plus a one-line guard. Everything else in ADR 064 stands unchanged: the
aggregation script, the self-rendered SVG, the no-SaaS constraint, the per-package
reporters, report-only coverage with no threshold gate, and the dependency-audit gate.

## Consequences

- The README badge and the `COVERAGE.md` breakdown now reflect the latest `main` run,
  automatically. Stale-badge drift is eliminated.
- `main`'s history remains fully human-authored. The `ci-badges` branch is machinery,
  not history: single commit, force-pushed, safe to delete at any time (the next `main`
  run recreates it).
- The badge image is served by `raw.githubusercontent.com` from this repository's own
  branch. No coverage data leaves the repository and no external rendering service is
  involved, preserving ADR 064's constraint.
- Until the first `main` CI run after this change, the `ci-badges` branch does not
  exist and the README badge 404s. This heals on the first push to `main`.
- Contributors no longer regenerate the badge as part of a change; a PR's coverage
  effect becomes visible on `main` after merge rather than in the diff. The per-run job
  summary still shows the number for any branch.

## Rejected alternatives

- **CI commits the badge back to `main`.** The simplest wiring, but it interleaves bot
  commits with the project's curated, linearly rebased history: exactly what ADR 064
  rejected, and that reasoning still holds. The side branch delivers the same freshness
  without touching `main`.
- **A shields.io endpoint badge fed from a JSON artifact.** Routes badge rendering
  through an external service on every README view; rejected by ADR 064 and still out
  of scope under the no-SaaS constraint.
- **GitHub Pages as the badge host.** Works, but drags in a Pages deployment (or a
  `gh-pages` branch plus a deploy action) for two static files; a plain branch that
  `raw.githubusercontent.com` already serves is strictly less machinery.
- **Appending commits to `ci-badges` instead of orphan-and-force-push.** Accumulates an
  unbounded history of badge blobs nobody will read and reintroduces push races between
  concurrent runs. The branch's only job is to hold the current files.
- **Keeping the tracked copies on `main` alongside the published ones.** Two sources of
  truth, one guaranteed stale: the confusion this ADR exists to remove.

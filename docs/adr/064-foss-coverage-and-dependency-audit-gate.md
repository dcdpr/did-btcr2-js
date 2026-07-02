---
title: "ADR 064: FOSS In-Repo Coverage Reporting and a Dependency-Audit Gate"
---

# ADR 064: FOSS In-Repo Coverage Reporting and a Dependency-Audit Gate

**Status:** Accepted

**Date:** 2026-07-02

**Branch / PR:** `chore/monorepo-hygiene`

**References:** [ADR 058](058-remove-legacy-helia-cas-path.md), [ADR 023](023-cas-read-path.md)

## Context

Continuous integration (`.github/workflows/ci.yml`) linted, built, built tests, and ran
tests, but produced no coverage signal and ran no dependency-vulnerability check. Two gaps
were worth closing:

1. **Coverage was invisible.** Every package already runs `c8` (V8 coverage) under its test
   script via a per-package `.c8rc.json`, but the reporters were `cobertura` and `text` only:
   the number scrolled past in the test log and nothing aggregated it across the ten packages
   or surfaced it anywhere durable.
2. **No dependency-audit gate.** `audit-ci` was present as a root dev dependency but wired to
   nothing.

A hard constraint shapes the coverage decision: **no third-party / SaaS coverage service may
be used.** Codecov, Coveralls, SonarCloud, Codacy and the like are out of scope; coverage data
may not be uploaded off the repository. Whatever we build has to be fully FOSS and self-hosted.

A second fact shapes the audit decision. The production dependency tree currently carries a
large transitive-vulnerability surface that originates almost entirely from one dependency,
`helia` (the IPFS CAS stack). A `pnpm audit` of the production tree reports on the order of
28 high and 1 critical advisory, essentially all of them reached through
`helia > @ipshipyard/libp2p-auto-tls`, `helia > @libp2p/http-fetch > undici`, and
`helia > @libp2p/webrtc > react-native-webrtc > react-native > react-devtools-core >
shell-quote`. These live several layers deep in libp2p's graph; the method code cannot fix
them, and no direct version bump resolves them. The single critical (shell-quote command
injection, `GHSA-w7jw-789q-3m8p`) sits on the react-native code path, which is never loaded in
this project's node or browser usage. (This is the same `helia` weight that dominates the
browser bundle; reducing that dependency is tracked separately.)

## Decision

### Coverage: aggregate `c8` output into a committed badge and report, no external service

- **Add machine-readable reporters.** Each package's `.c8rc.json` gains `lcov` and
  `json-summary` alongside the existing `text` and `cobertura`. `json-summary` writes a
  `coverage/coverage-summary.json` per package (the aggregation input); `lcov` writes
  `lcov.info` plus a browsable local HTML report. All four reporters ship with `c8`, so no new
  dependency is added. The per-package `coverage/` directories remain git-ignored.
- **Aggregate with a dependency-free script.** `scripts/coverage-report.mjs` reads every
  package's `coverage-summary.json`, sums covered/total lines (and statements, functions,
  branches) into one repo-wide figure, and writes two committed artifacts: a self-rendered
  SVG badge at `.github/badges/coverage.svg` and a `COVERAGE.md` table (per package plus a
  total row). The SVG is generated from a small inline template with a threshold-based color;
  no badge-rendering service or dependency is involved. When run under GitHub Actions it also
  appends the table to the job summary (`$GITHUB_STEP_SUMMARY`).
- **Regeneration is a committed, human-run step, not a CI push.** `pnpm coverage` runs the
  tests and regenerates the badge and report for the author to commit; `pnpm coverage:report`
  re-aggregates existing output. CI runs `coverage:report` to surface the number in the job
  summary but does **not** commit back to the repository: the badge is a normal tracked file,
  kept current by the person making the change, consistent with the project's convention that
  commits are authored by a human, not by CI.
- **Report-only for now, no coverage threshold gate.** The repo-wide baseline (about 89% line
  coverage at adoption) is now visible and committed; a `c8 --check-coverage` floor can be
  added later against that known number. Gating before the baseline was visible would have
  picked an arbitrary threshold.

### Dependency audit: gate on new criticals, with a documented baseline allowlist

- **Wire `audit-ci` as a blocking CI step** (`pnpm audit-ci`, config `audit-ci.jsonc`), run
  right after install so it fails fast. `audit-ci` wraps `pnpm audit` (the package manager's
  own advisory feed): it is FOSS and self-contained, with no external service, satisfying the
  same no-SaaS constraint.
- **Gate at `critical`, not `high`.** Gating at `high` today would be red on arrival because of
  the ~28 transitive high advisories in the `helia` stack that we cannot action. Gating at
  `critical` means CI fails when a *new* critical advisory enters the tree, protecting against
  the most severe regressions while remaining green against the current baseline.
- **Allowlist exactly the one known, unreachable critical.** `audit-ci.jsonc` allowlists
  `GHSA-w7jw-789q-3m8p` (shell-quote, reached only via the never-loaded react-native-webrtc
  path) with an inline justification. The allowlist is deliberately a single entry: we do not
  mass-allowlist the high advisories to force a `high` gate, because that would silently accept
  a large surface. The highs stay visible through `pnpm audit`; the gate stays honest.
- **Document the upgrade path.** When the `helia` transitive surface is reduced (made optional,
  lazy-loaded, or replaced), the config comment directs tightening the gate to `"high": true`
  and dropping the allowlist entry.

## Consequences

- Repo-wide coverage is a committed, visible number: a badge in the root README linking to a
  `COVERAGE.md` per-package breakdown, refreshed by `pnpm coverage`, with the same figure echoed
  into each CI run's job summary. No coverage data leaves the repository and no SaaS account is
  required.
- `lcov.info` and a local HTML report are produced per package for anyone who wants line-level
  coverage in an editor or `genhtml`, again with no external tooling.
- CI now fails on any newly introduced critical advisory, closing the door on the most severe
  dependency regressions, while staying green against the documented `helia` baseline.
- The audit configuration records, in-repo, that the current high-advisory surface is a known
  consequence of the `helia` IPFS stack and names the condition under which the gate tightens.
- The coverage badge can drift if an author changes code without running `pnpm coverage`; this
  is accepted in exchange for never having CI push commits. The number is regenerated on the
  next `pnpm coverage` run.

## Rejected alternatives

- **Codecov / Coveralls / SonarCloud (hosted coverage services).** Forbidden by the no-SaaS
  constraint: they require uploading coverage off the repository to a third party. The whole
  point of this ADR is a self-hosted equivalent.
- **A shields.io endpoint badge.** Even the "endpoint" form routes badge rendering through an
  external service. A locally generated SVG keeps the badge fully in-repo with no runtime
  dependency on anyone else's uptime.
- **Having CI commit the regenerated badge back to the branch.** This would put automated
  commits into the history, against the project's human-authored-commit convention, and add
  write-permission and loop-avoidance complexity for a badge that a human can regenerate as
  part of the change.
- **Gating the audit at `high` now.** Red on arrival: ~28 transitive high advisories in the
  `helia` stack that the method code cannot fix. A gate that is always failing is ignored.
- **Mass-allowlisting the high advisories to force a `high` gate.** A ~26-entry allowlist would
  make CI green while hiding a genuinely large surface, and would need constant churn as the
  libp2p graph shifts. Gating at `critical` with a single justified allowlist entry is both
  greener and more honest.
- **A coverage threshold gate at adoption.** Without the baseline first committed and visible,
  any floor would be a guess. The baseline is now recorded; a floor can follow deliberately.

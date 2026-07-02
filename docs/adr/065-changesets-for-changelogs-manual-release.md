---
title: "ADR 065: Adopt Changesets for Per-Package Changelogs with Manual Publishing"
---

# ADR 065: Adopt Changesets for Per-Package Changelogs with Manual Publishing

**Status:** Accepted

**Date:** 2026-07-02

**Branch / PR:** `chore/monorepo-hygiene`

**References:** [ADR 001](001-monorepo-package-boundaries.md)

## Context

The monorepo publishes ten independently-versioned packages under the `@did-btcr2/` scope. Their
inter-package dependencies use the `workspace:^` protocol, and their release cadence is
independent: a breaking change lands as a `minor` in the affected package (0.x semantics), while
downstream packages that only take the dependency uptake move by a `patch`. None of the packages
carried a `CHANGELOG.md`, so the per-package release history lived only in git and in the ADRs.

`@changesets/cli` and `@changesets/changelog-github` were already installed as root dev
dependencies, but nothing was wired: the `.changeset/` directory existed with no `config.json`, so
the tool could not run. Two conventions constrain how this gets adopted:

- **A human runs every git and publish operation.** Commits, tags, and `npm publish` are performed
  by a maintainer, not by CI.
- **Releases are deliberate, not automatic.** The project picks the version bump per package as
  part of landing a change; there is no publish-on-merge pipeline.

## Decision

### Initialize Changesets for independent versioning

Add `.changeset/config.json`:

- `changelog`: `["@changesets/changelog-github", { "repo": "dcdpr/did-btcr2-js" }]`. The GitHub
  formatter (already installed) writes changelog entries with pull-request and author links. It
  queries the GitHub API, so `changeset version` needs a `GITHUB_TOKEN` in the environment; this is
  documented in `.changeset/README.md`.
- `commit`: `false`. Changesets never commits on the maintainer's behalf; the generated changeset
  files, version bumps, and changelogs are committed by a human, consistent with the project's
  authored-by-a-human convention.
- `fixed`: `[]` and `linked`: `[]`. The packages version independently; they are neither locked to
  a shared version nor linked, matching the established minor-here / patch-downstream cadence.
- `access`: `public`, `baseBranch`: `main`.
- `updateInternalDependencies`: `patch`. When a package bumps, its `workspace:^` dependents take at
  least a patch bump, which is exactly the "dependency-uptake patch" the cadence already uses.
- `ignore`: `[]`. The private root package is excluded automatically; all ten scoped packages are
  published and versioned.

### Add scripts, keep publishing manual

Three root scripts wrap the tool:

- `changeset` - author a changeset (pick packages and bumps, write a summary).
- `changeset:status` - preview pending bumps.
- `changeset:version` - consume pending changesets: bump versions, update internal dependents, and
  write each package's `CHANGELOG.md`.

Publishing is intentionally **not** automated. There is no changesets GitHub Action and no
publish-on-merge job; a maintainer publishes with the existing flow (`pnpm publish:all`, or
`changeset publish` to publish and tag only the changed packages). No npm token is added to CI.

### Do not enforce changesets in CI

`changeset status` is deliberately kept out of the CI workflow. Enforcing "every push must carry a
changeset" would false-fail on chore, docs, and infrastructure branches that legitimately change no
published behavior (this branch is one such example). Whether a change needs a release is a
maintainer judgment made at landing time, not a CI gate.

## Consequences

- Running `pnpm changeset` records intended bumps as small markdown files committed with the
  change; `pnpm changeset:version` turns accumulated changesets into version bumps and per-package
  `CHANGELOG.md` files with GitHub-linked entries.
- Internal `workspace:^` dependents are bumped consistently (patch) when a dependency releases,
  formalizing the cadence that was previously applied by hand.
- The release remains a deliberate, human-run step; no CI credentials or publish-on-merge machinery
  are introduced, and the maintainer keeps full control over timing and version choice.
- `changeset version` requires `GITHUB_TOKEN` for the GitHub changelog formatter; this is a known,
  documented step of the manual release, not a CI dependency.

## Rejected alternatives

- **Full automated releases (changesets GitHub Action).** The canonical setup opens a "Version
  Packages" PR on merge and publishes to npm plus cuts GitHub Releases when that PR merges. It
  requires an `NPM_TOKEN` secret and trusting CI to publish, and it inverts the deliberate,
  human-run cadence this project uses. Deferred; it can be layered on later if the team wants it.
- **Linked or fixed versioning.** Both would force packages toward a shared version and break the
  independent minor-here / patch-downstream model. The packages are versioned independently.
- **The basic (non-GitHub) changelog formatter.** It needs no token, but `@changesets/changelog-github`
  is already installed and produces richer, linked changelogs for a GitHub-hosted project. The token
  requirement is a documented step of the manual release, which is acceptable.
- **Enforcing `changeset status` as a CI gate.** It would block infrastructure and docs branches
  that need no release, for no benefit given releases are already a deliberate manual step.

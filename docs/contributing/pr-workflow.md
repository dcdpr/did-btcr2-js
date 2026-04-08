---
title: PR Workflow
---

# Pull Request Workflow

How to get a change merged into `did-btcr2-js`.

## Branch naming

Use a single-segment prefix that describes the kind of work, followed by a short kebab-case description:

| Prefix | Use for |
|---|---|
| `feat/` | New features (new public APIs, new beacon types, new packages) |
| `fix/` | Bug fixes |
| `chore/` | Tooling, build system, dependency updates, lint config |
| `docs/` | Documentation-only changes |
| `refactor/` | Internal refactoring with no behavioral change |
| `test/` | Test-only changes (adding coverage, fixing test infrastructure) |
| `release/` | Release preparation (version bumps, changelog) |

Examples: `feat/cas-beacon-publish`, `fix/resolver-discovery-loop`, `chore/lib-tsconfig-node-types`, `docs/typedoc-unified-site`.

## Before you start

1. **Pull the latest `main`:**
   ```bash
   git checkout main
   git pull origin main
   ```

2. **Create your branch:**
   ```bash
   git checkout -b feat/your-feature
   ```

3. **Verify the baseline builds and tests pass:**
   ```bash
   pnpm install
   pnpm build:ts
   pnpm build:tests && pnpm test
   pnpm lint
   ```

   If any of these fail on a fresh `main` checkout, that's a `main`-level bug — open an issue rather than starting feature work on top of broken state.

## While you work

### Commit conventions

Commit messages use the imperative mood ("Add", "Fix", "Refactor" — not "Added", "Fixed", "Refactoring"). Subject lines are short (<= 72 chars). Body explains *why*, not *what* — the diff already shows what.

Example:

```
fix: cap resolver beacon discovery rounds at 10

Without an upper bound, a malicious or buggy DID document could cause
the resolver to loop indefinitely re-discovering newly-added beacon
services. Cap at 10 rounds, which is well above any realistic update
chain depth, and throw a ResolveError on overflow.
```

### Atomic commits

Each commit should be a single coherent change. Don't bundle a refactor with a feature. Don't bundle multiple unrelated bug fixes. If you find yourself writing "and" in a commit message, the commit probably wants to be split.

### Run the local quality gates as you go

```bash
pnpm build:ts                       # incremental TypeScript build
pnpm build:tests && pnpm test       # full test suite
pnpm lint                           # zero-warning lint
```

The `lint` step is enforced as `--max-warnings 0`. CI will fail if any warning slips through. Fix as you go — `pnpm lint:fix` handles most autofixable issues.

### Touching the public API of a published package

If your change modifies anything exported from a package's `src/index.ts`, you're modifying its **public API**. That has versioning consequences:

- A backward-compatible addition (new exported function, new method, new property) is a **MINOR** bump.
- A backward-incompatible change (removed export, changed signature, renamed type) is a **MAJOR** bump.
- A pure bug fix with no public-API change is a **PATCH** bump.

Pre-1.0 packages (currently `keypair`, `cryptosuite`, `bitcoin`, `kms`, `smt`, `method`, `api`, `cli`) treat MINOR as breaking under strict semver. The `common` package is post-1.0 and follows full semver.

You don't bump versions yourself in your PR — that happens at release time. But your PR description should call out the bump category so the reviewer can sanity-check.

## When you're ready to push

1. **Squash WIP commits** if your branch has noisy intermediate commits. The history that lands on `main` should be reviewable.

2. **Rebase on the latest `main`** (don't merge `main` into your branch — that creates a merge commit that pollutes the history):
   ```bash
   git fetch origin
   git rebase origin/main
   ```

3. **Push the branch:**
   ```bash
   git push origin feat/your-feature
   ```

4. **Open a PR with `gh`:**
   ```bash
   gh pr create --base main --head feat/your-feature \
     --title "feat: short description" \
     --body "$(cat <<'EOF'
   ## Summary
   <1-3 bullets explaining what changed and why>

   ## Test plan
   - [ ] Steps you took to verify the change
   - [ ] Edge cases you considered
   - [ ] Anything you didn't test and why

   ## Version impact
   - <package>: PATCH | MINOR | MAJOR — <reason>
   EOF
   )"
   ```

## Review

A reviewer will look for:

- **Correctness** — does the change do what its description says? Are there edge cases that aren't handled?
- **Test coverage** — is the change tested? If it's a bug fix, is there a regression test?
- **Architectural fit** — does the change respect the patterns described in [Architecture Overview](../architecture/overview.md)?
- **Public API impact** — are versioning consequences correct?
- **Code style** — is the code readable, well-named, well-commented where non-obvious?
- **Breaking changes** — are they justified, documented, and noted in the version impact section?

Address review comments with new commits on your branch (don't force-push during review unless asked — it makes incremental review harder). After approval, the merge commit will preserve the commit history if you want it preserved, or squash if you prefer a single commit on `main`.

## Squashing for landing

For substantial multi-commit PRs (typically 3+ commits), the project convention is to **squash to a single commit on `main`** with a structured message that lists package versions and per-package changes. See the rebase template in `feedback-rebase-template.md` (maintainer-only memory file).

For small PRs (1-2 commits), preserve the individual commits with a merge commit.

## Merging

- **`gh pr merge --merge`** — preserves all commits, adds a merge commit. Use for multi-commit PRs where each commit is meaningful.
- **`gh pr merge --squash`** — collapses to a single commit. Use for trivial fixes or when commits are noisy.
- **`gh pr merge --rebase`** — rebases each commit individually onto main (no merge commit). Use sparingly — it rewrites your branch's commit hashes.

## After merge

1. Delete your local branch:
   ```bash
   git checkout main
   git pull origin main
   git branch -d feat/your-feature
   ```

2. Delete the remote branch (if `gh` didn't already):
   ```bash
   git push origin --delete feat/your-feature
   ```

3. If your change requires a release, see [Release Process](release-process.md).

---
title: Release Process
---

# Release Process

How to cut and publish a release of one or more `@did-btcr2/*` packages.

## When to release

Releases happen on demand. There's no automated cadence — a release is cut whenever:

- A bug fix needs to ship to consumers
- A new feature is ready to publish
- A breaking change has been finalized and signed off

A release can be a **single package** or a **batch** (every package, or a subset). Batched releases are common because most changes to a downstream package (e.g., `method`) cascade requirements onto its dependents (`api`, `cli`).

## Versioning

The project follows **semantic versioning** with one caveat: pre-1.0 packages treat MINOR as breaking under strict semver. Currently the only post-1.0 package is `common`. Everything else is pre-1.0.

| Bump | Pre-1.0 (most packages) | Post-1.0 (`common`) |
|---|---|---|
| **PATCH** | Bug fix, internal refactor, build tooling change with no public API impact | Same |
| **MINOR** | New feature OR breaking change | New feature, backward-compatible |
| **MAJOR** | (rarely used pre-1.0) | Breaking change |

When in doubt, bump higher rather than lower. A spurious MAJOR bump is harmless; a missed one breaks consumers silently.

## Release checklist

### 1. Verify the branch you're releasing from is clean

```bash
git checkout main
git pull origin main
git status
```

The working tree should be empty. If it isn't, stash or commit before proceeding.

### 2. Run the full quality gate

```bash
pnpm clean
pnpm install
pnpm build
pnpm build:tests && pnpm test
pnpm lint
```

All five must pass. If any step fails, do not release — fix `main` first, get the fix merged, then return to step 1.

### 3. Bump versions

Bump every package that has changed since its last published version. Edit each package's `package.json` directly — there's no automated bump tool currently in use.

For a small release, the relevant section of each `package.json`:

```json
{
  "name": "@did-btcr2/<pkg>",
  "version": "X.Y.Z",   // bump this
  ...
}
```

If a package has not changed since its last release, **do not bump it**. Republishing identical content with a new version number wastes consumer time and pollutes the registry.

### 4. Commit the version bumps

```bash
git add packages/*/package.json
git commit -m "chore: bump <package(s)> to <version(s)>"
```

For batched releases, list each package + version in the commit body:

```
chore: bump patch versions across all packages

- common       8.0.1  → 8.0.2
- keypair      0.11.3 → 0.11.4
- ...
```

### 5. Re-verify after bumping

```bash
pnpm install   # ensure pnpm-lock.yaml updates if any internal deps shifted
pnpm build
pnpm build:tests && pnpm test
```

### 6. Push and merge

If you bumped versions on a release branch, open a PR and merge per the [PR Workflow](pr-workflow.md). If you bumped directly on `main` (only for trivial PATCH releases on a clean tree), push directly:

```bash
git push origin main
```

### 7. Publish to npm

Make sure you're logged in:

```bash
npm whoami       # should print your npm username
# if not logged in: npm login
```

Have your 2FA token ready if your npm account requires it.

**Recommended: workspace publish (publishes all bumped packages in topological order automatically):**

```bash
# Dry run first — shows what would be published without actually doing it
pnpm -r publish --access public --dry-run

# If the dry run looks correct:
pnpm -r publish --access public
```

`pnpm -r publish` only publishes packages whose `version` field is newer than what's on the registry. It also rewrites `workspace:^` references to concrete semver in the published tarballs.

**Alternative: manual publish in dependency order** — useful when you want to verify each landing on npm before proceeding to the next:

```bash
cd packages/common      && pnpm publish --access public && cd -
cd packages/keypair     && pnpm publish --access public && cd -
cd packages/smt         && pnpm publish --access public && cd -
cd packages/cryptosuite && pnpm publish --access public && cd -
cd packages/bitcoin     && pnpm publish --access public && cd -
cd packages/kms         && pnpm publish --access public && cd -
cd packages/method      && pnpm publish --access public && cd -
cd packages/api         && pnpm publish --access public && cd -
cd packages/cli         && pnpm publish --access public && cd -
```

The dependency order matters — a package can't be installed by its dependents until it's on the registry.

### 8. Post-publish smoke test

Verify the published tarballs work via a fresh consumer in a scratch directory:

```bash
mkdir /tmp/btcr2-release-check && cd /tmp/btcr2-release-check
pnpm init -y
pnpm add @did-btcr2/method@<just-published-version>

# ESM consumer
node --input-type=module -e "
  const { DidBtcr2 } = await import('@did-btcr2/method');
  console.log('ESM:', typeof DidBtcr2);
"

# CJS consumer
node -e "
  const { DidBtcr2 } = require('@did-btcr2/method');
  console.log('CJS:', typeof DidBtcr2);
"
```

Both should print `function`. If either fails, the published tarball is broken — yank it (`npm unpublish @did-btcr2/method@X.Y.Z`) within the 72-hour window and investigate.

### 9. Tag the release (optional)

For major releases or whenever you want a git anchor:

```bash
git tag v<version> -m "Release v<version>"
git push origin v<version>
```

For batched releases, use the highest version bumped or a date-based tag.

## Things that can go wrong

### "Cannot publish over the previously published versions"

You bumped a version but pnpm/npm doesn't think the local version is newer. Verify by checking npm:

```bash
npm view @did-btcr2/<pkg> version
```

If the registry has a newer version than your local file, your bump didn't actually take effect or you're on a stale branch. Check `git log` and your working tree.

### "Need auth"

Run `npm login` and re-authenticate. If you have 2FA, you'll need to provide a token.

### A package fails publish midway through a batched release

Don't panic. The packages that already published are fine. Investigate the failure (often a permissions issue, a stale 2FA token, or a transient registry error). Re-run `pnpm -r publish --access public` — pnpm will skip packages whose published version already matches the local version, and only retry the ones that didn't make it.

### A consumer reports the published package is broken

If it's within 72 hours of publishing, you can yank with `npm unpublish @did-btcr2/<pkg>@<version>`. After 72 hours, npm policy prevents unpublishing (you'd have to publish a new patch version with the fix instead).

Test fixes locally before publishing again. The post-publish smoke test in step 8 exists specifically to catch this kind of thing before consumers hit it.

## CHANGELOG

There is currently no automated CHANGELOG generation. Significant releases should have a one-paragraph summary in the GitHub release notes (created via `gh release create v<version> --notes "..."`) describing:

- What changed at a high level
- Any breaking changes consumers need to know about
- Migration guidance for breaking changes

For small PATCH releases, the GitHub release entry is optional — the commit history is sufficient.

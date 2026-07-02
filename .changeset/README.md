# Changesets

This folder is managed by [`@changesets/cli`](https://github.com/changesets/changesets), the
tool this monorepo uses to record intended version bumps and generate per-package changelogs.

## How releases work here

Versioning and publishing stay manual (a human runs every git and publish step); changesets only
handles the bookkeeping:

1. **Record a change.** After making a change worth releasing, run `pnpm changeset` and follow the
   prompts: pick the affected packages and the bump each takes (`patch` / `minor` / `major`; on
   `0.x`, a breaking change is a `minor`), then write a one-line summary. This writes a markdown
   file into this folder. Commit it alongside your change.
2. **Preview.** `pnpm changeset:status --verbose` shows the pending bumps.
3. **Apply versions.** When preparing a release, `pnpm changeset:version` consumes the pending
   changeset files, bumps each package's `version`, updates internal `workspace:^` dependents by a
   patch, and writes/updates each package's `CHANGELOG.md`. Review, then commit.
4. **Publish.** Publish with the repo's existing flow (for example `pnpm publish:all`, or
   `changeset publish` to publish only the changed packages and tag them).

`pnpm changeset:version` uses the `@changesets/changelog-github` formatter, which queries the
GitHub API for pull-request and author links; set a `GITHUB_TOKEN` in the environment when running
it. See the [common questions](https://github.com/changesets/changesets/blob/main/docs/common-questions.md)
for more.

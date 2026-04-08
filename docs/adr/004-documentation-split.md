---
title: "ADR 004: Split User Docs from Contributor Docs"
---

# ADR 004 — Split User Docs (btcr2.dev) from Contributor Docs (this repo)

**Status:** Accepted
**Date:** 2026-04-08
**Branch / PR:** `docs/typedoc-unified-site`

## Context

Prior to this decision, `did-btcr2-js` had a single VitePress site under `docs/` that tried to be both a user-facing documentation site and a contributor-facing reference. It wasn't really either:

- **For users**, it was incomplete. Pages like `installation.md`, `configuration.md`, `usage.md`, and `change-log.md` were empty stubs. The home page had a nice hero layout, but every link led to a title with no content.
- **For contributors**, it was shallow. The architecture, build system, PR workflow, and release process were not documented at all. The auto-generated API reference was stale (committed to git, last regenerated before multiple major refactors; it still contained classes like `Btc1Deactivate` and `CIDAggregateBeacon` that had been renamed long ago).
- The VitePress setup itself was a moderate dependency weight: `vitepress`, `vitepress-plugin-mermaid`, `typedoc-plugin-markdown`, `typedoc-vitepress-theme`, `gh-pages`, plus a pile of transitive deps (`@braintree/sanitize-url`, `cytoscape`, `cytoscape-cose-bilkent`, `dayjs`). The two-step build (`typedoc → vitepress`) meant slow regeneration, and `docs/packages/` (the auto-generated part) was committed to git, polluting PR diffs whenever anyone touched source comments.

The question was: rebuild the existing site with fresh content and keep VitePress, or change direction entirely?

The client decision was to **split** the documentation surface:

- **`btcr2.dev`** — user-facing evangelism and demo site. Covers all four implementation languages (TypeScript, Java, Python, Rust) with per-implementation install, configure, and usage guides, an interactive CRUD demo using the did-btcr2-js implementation, and a user-level API reference. Hosted separately, out of scope for this repo.

- **`did-btcr2-js`** — contributor-facing reference only. Architecture, build system, PR workflow, release process, ADRs, and an auto-generated API reference for contributors who need to look up type signatures. No user content. The documentation tooling is chosen for this audience and not optimized for public evangelism.

## Decision

We adopted three sub-decisions that together implement the split:

### 1. Delete the VitePress site and rebuild with TypeDoc's `projectDocuments` feature

TypeDoc 0.26+ has a `projectDocuments` option that includes arbitrary markdown files in its HTML output alongside the auto-generated API reference. We use it to merge hand-written narrative pages (under `docs/architecture/`, `docs/contributing/`, `docs/adr/`) with the auto-generated API reference into a single unified site. One tool. One command. One output directory.

This replaces the VitePress + `typedoc-plugin-markdown` + `typedoc-vitepress-theme` + `vitepress-plugin-mermaid` stack. Net: 9 devDependencies removed from the root `package.json`.

### 2. Docs output is not committed

The built site lives in `.docs-site/` at the repo root and is gitignored. Contributors run `pnpm docs:build` locally to generate it, or `pnpm docs:serve` to preview at `http://localhost:3000`. The hand-written markdown sources are the only committed artifact — they are the single source of truth, fully readable in any editor or on GitHub.

This reverses the prior convention where `docs/packages/` was committed. The prior convention created noise in PRs and caused stale content to drift into git history. The new convention treats docs the same as any other build artifact.

### 3. User docs surface lives at btcr2.dev, not here

All user-facing content — installation instructions, usage tutorials, API examples aimed at consumers, demos, versioning and release notes for end users — goes to btcr2.dev, not `docs/`. The README's "Documentation" section explicitly directs users to btcr2.dev and contributors to `docs/`.

This lets us stop trying to serve two audiences with one set of files, stop leaving empty stub pages around, and stop conflating user tutorials with architecture docs.

## Consequences

**Positive:**

- **9 devDependencies removed**: `vitepress`, `vitepress-plugin-mermaid`, `typedoc-plugin-markdown`, `typedoc-vitepress-theme`, `gh-pages`, `@braintree/sanitize-url`, `cytoscape`, `cytoscape-cose-bilkent`, `dayjs`. `rimraf` was added for the `docs:clean` script — net 8 fewer deps.

- **~440 auto-generated markdown files deleted from git**: `docs/packages/` was scrubbed, along with the assorted stub pages (`docs/change-log.md`, `docs/configuration.md`, `docs/getting-started.md`, `docs/index.md`, `docs/installation.md`, `docs/packages.md`, `docs/usage.md`, `docs/diagrams.md`) and the VitePress config dir (`docs/.vitepress/`).

- **Single-tool build**: `pnpm docs:build` runs `typedoc` and emits the entire site. No two-step orchestration.

- **Clean PR diffs**: contributors changing source comments no longer see 200+ lines of regenerated docs in their PR.

- **Contributor-focused defaults**: every architectural decision about the docs site (theme, layout, navigation, search) is now made for contributors, not conflicted between users and contributors.

- **ADRs are now a thing**: we have a place to capture architectural decisions (this directory). This is the project's first serious attempt at an ADR habit.

**Negative:**

- **btcr2.dev is not yet built**: users currently have no landing page. The README directs them to btcr2.dev but that site is in progress. Until it exists, new users will have a worse experience than before. Tradeoff is accepted because the prior site was incomplete for users anyway.

- **No single deployed URL for contributors**: contributors have to run `pnpm docs:build` locally to see the site. This is lower friction than it sounds (one command), but it's a change from the prior gh-pages auto-deploy. Team members who prefer to read docs from a URL will need to adapt. If we ever want to restore a deployed URL, it's easy to add a CI job that publishes `.docs-site/` to GitHub Pages on main-branch pushes.

- **Mermaid support temporarily gone**: the VitePress mermaid plugin is removed. If a narrative page needs a diagram, we'll add `typedoc-plugin-mermaid` or embed static images. Acceptable because the prior sequence diagrams in `docs/sequence/` were rarely updated and mostly redundant with spec-level documentation.

- **TypeDoc theme is utilitarian**: TypeDoc's default HTML is functional but less polished than VitePress or Starlight. Dark mode works; the typography is fine; navigation is standard. It's not a showcase site — and it doesn't need to be, because users go to btcr2.dev.

## Alternatives considered

- **Astro Starlight + starlight-typedoc** — modern 2025-2026 trendy static site generator. Rejected for this project because it adds 6+ new dependencies for a contributor-only audience, and because Starlight's default theme polish is irrelevant when the primary consumers are devs with the repo checked out locally. Kept on the roadmap as a possible future upgrade if the docs audience grows.

- **No site generator at all (markdown + TypeDoc HTML separately)** — serve narrative docs as plain markdown read on GitHub, and generate TypeDoc HTML separately. Rejected because the split would lose cross-referenced navigation and unified search. The `projectDocuments` option gives us the unified experience for nearly zero additional cost.

- **Keep VitePress, just clean it up** — rebuild content in place. Rejected because the client explicitly asked for a clean rebuild, and VitePress brings more weight than needed for a contributor-only site.

- **Docusaurus 3** — Meta's React-based docs framework. Rejected because it's even heavier than VitePress and its killer features (versioning, i18n, blog, plugin ecosystem) are irrelevant for contributor docs.

- **Fumadocs** — the 2025 trendy Next.js-based docs framework. Rejected for the same reason as Starlight — over-engineered for a contributor-only audience.

## Verification

- `pnpm docs:build` emits `.docs-site/` with 7 hand-written narrative pages (`index`, `architecture/overview`, `architecture/package-graph`, `contributing/build-system`, `contributing/pr-workflow`, `contributing/release-process`, and this ADR directory) plus 240 auto-generated API reference pages.
- Zero errors, zero warnings after TypeDoc configuration tuning.
- Python `http.server` smoke test confirms all pages serve correctly at HTTP 200.
- `pnpm install` cleanly resolves after removing the 9 VitePress-related devDependencies.
- `pnpm build:ts`, `pnpm build:tests && pnpm test`, `pnpm lint` all still pass unchanged.

## Follow-ups

Tracked in repo `TODO.md`:

- Write btcr2.dev user-facing content (out of scope for this repo).
- Consider adding `typedoc-plugin-mermaid` when narrative pages need diagrams.
- Re-evaluate Astro Starlight if the contributor audience grows significantly or if we want a deployed contributor portal at `contributors.btcr2.dev`.
- Optional: set up a GitHub Actions workflow that builds `.docs-site/` on PRs to catch broken links early.

## References

- [ADR 001](001-tsconfig-normalization.md) — prior foundation work (tsconfig normalization + CJS via tsup)
- [TypeDoc `projectDocuments` documentation](https://typedoc.org/options/input/#projectdocuments)
- [VitePress documentation](https://vitepress.dev/) — the tool we're replacing
- `docs/index.md` — the new landing page with the same audience split explained for contributors
- `typedoc.json` — the new minimal TypeDoc config

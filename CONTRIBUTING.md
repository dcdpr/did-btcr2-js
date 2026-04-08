# Contributing to did-btcr2-js

Thanks for your interest in contributing! This repository is the TypeScript reference implementation of the [did:btcr2 DID method](https://dcdpr.github.io/did-btcr2/). Contributions are welcome.

## Quick links

All of the detailed contributor documentation lives under [`docs/`](docs/index.md). The most common starting points:

- **[Contributor documentation home](docs/index.md)** — orientation for new contributors
- **[Architecture Overview](docs/architecture/overview.md)** — high-level tour of the codebase and its design principles
- **[Package Graph](docs/architecture/package-graph.md)** — inter-package dependencies and import rules
- **[Build System](docs/contributing/build-system.md)** — tsconfig layout, ESM/CJS builds, tsup bundling, tests, publishing
- **[PR Workflow](docs/contributing/pr-workflow.md)** — branch naming, commit conventions, review process
- **[Release Process](docs/contributing/release-process.md)** — version bumping and npm publishing
- **[Architecture Decision Records](docs/adr/)** — past design decisions with context

If you want to preview the full contributor site (narrative docs + auto-generated API reference) locally:

```bash
pnpm install
pnpm docs:build
pnpm docs:serve   # http://localhost:3000
```

The build output lives in `.docs-site/` and is gitignored.

## Quick reference — the five-command contributor workflow

```bash
pnpm install                        # first-time or after dep changes
pnpm build:ts                       # incremental TypeScript build across all packages
pnpm build:tests && pnpm test       # full test suite (810 tests across 9 packages)
pnpm lint                           # zero-warning lint check
pnpm lint:fix                       # apply autofixes
```

Details on each command and when to use them are in [docs/contributing/build-system.md](docs/contributing/build-system.md).

## Reporting bugs and requesting features

- **Bugs** — open an issue with a reproduction (failing test case, minimal script, or explicit steps). Include Node version, pnpm version, and the package version you're running.
- **Feature requests** — open an issue describing the use case and the proposed behavior. For larger features, it's usually worth discussing the design before opening a PR.
- **Security issues** — do **not** file a public issue. Email the maintainers directly. See the repository root for security contact details.

## Code of conduct

Be kind. Assume good intent. Review code, not people. If something in this repository — code, docs, or review feedback — feels unfriendly or unwelcoming, please flag it to the maintainers so we can address it.

## License

By contributing, you agree that your contributions will be licensed under [MPL-2.0](LICENSE).

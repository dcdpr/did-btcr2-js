---
title: "ADR 013: CLI Per-Command Modules with Dependency Injection"
---

# ADR 013: CLI Per-Command Modules with Dependency Injection

**Status:** Accepted

**Date:** 2026-03-17

**Commit:** [`3d5135e`](https://github.com/dcdpr/did-btcr2-js/commit/3d5135e)

## Context

The `@did-btcr2/cli` package shipped as a single `DidBtcr2Cli` class (~400 lines) that registered all four user-facing commands: `create`, `resolve`, `update`, and what would become `deactivate`: along with their argument parsing, option validation, result formatting, and error handling. Four concrete problems had accumulated by the v0.3 line:

1. **God-class growth.** Command-specific logic (byte-length validation for `create`, JSON-option parsing for `update`, stdin handling for `resolve`) lived in private methods of `DidBtcr2Cli`. Adding a command meant touching the god class.
2. **Test monkey-patching.** The spec files overwrote static methods on the concrete `DidBtcr2` class to substitute behavior for tests. Every test file had its own ad-hoc monkey-patch pattern, and cleanup was fragile: a thrown error inside a test could leak the monkey-patched state into the next test.
3. **Silent-breakage bugs.** `update` passed field names (`patch`, `beacon`) that didn't match what `DidBtcr2.update()` expected (`patches`, `beaconId`). The command ran, emitted plausible-looking JSON, and produced no useful result. The mismatch was invisible without a live integration test.
4. **Version drift.** The `--version` output was a hardcoded string literal inside `cli.ts`. Every package version bump required a manual touch in an unrelated file that was easy to forget.

There was also one missing command: `deactivate`. The spec defines deactivation as an update applying a specific deactivation patch. That logic existed in the method package but had no CLI entry point.

## Options considered

1. **Keep the god class; add `deactivate`; add integration tests to catch field-name bugs.** Lowest churn. Doesn't address the testing pain, doesn't address per-command isolation, doesn't fix the hardcoded version.
2. **Extract command logic into plain functions exported from `cli.ts`.** Better than #1 but leaves tests still depending on the god class's wiring, and the functions would need a shared harness of some kind anyway.
3. **Per-command modules, each registering itself against a shared `Commander` program, with operations passed in via a DI interface.** Every command becomes a self-contained unit: its own validation, its own action handler, its own test file: and tests inject mock operations instead of monkey-patching globals.

## Decision

**Option 3.** Four changes, landing together:

- **Per-command modules.** `packages/cli/src/commands/{create,resolve,update,deactivate}.ts` each export a `registerXCommand(program, ops, globals)` function. The top-level `DidBtcr2Cli` class is now a ~50-line shell that wires globals, registers each command, and runs the commander program.
- **DI via `MethodOperations`.** A `MethodOperations` interface (in `cli/src/types.ts` at the time of this commit) defined the surface area the CLI needs from `@did-btcr2/method`: `create`, `resolve`, `update`. The constructor defaulted to an ops object backed by `DidBtcr2` statics. Tests constructed the CLI with `createMockOps()` and got full control without touching globals.
- **First-class `deactivate`.** Implemented as `update` with a hardcoded deactivation patch per spec (`[{ op: 'replace', path: '', value: { id, controller: [], verificationMethod: [], ... } }]`). Separate command, separate test file, separate error path.
- **Bug fixes carried with the refactor.** `update` field-name corrections (`patches`, `beaconId`). `--version` now reads from `packages/cli/package.json` at runtime via `version.ts`. `CLIError.name` correctly reflects the error type instead of always being `'CLIError'`. `--verbose` / `--quiet` / `--output json|text` added as global flags. Commander `argParser` callbacks validate JSON options at parse time so errors surface before the action runs. `-v` short flag removed from `update --source-version-id` to avoid conflict with `--version`. `build:esm` now runs `chmod +x` on the compiled binary for global `npm install`. Malformed `LICENSE` file (a GitHub API JSON blob that had been mistakenly committed as the license text) deleted.
- **Tests rewritten around DI.** `createMockOps()` produces a controllable ops object. `command.spec.ts` deleted. `output.spec.ts` and `version.spec.ts` added to cover the new utilities.

**Subsequent evolution:** `MethodOperations` was later replaced by the `ApiFactory` pattern when lazy API construction landed (see [ADR 024](024-api-facade-lazy-and-layered-config.md)). The per-command module split and the DI seam at the command boundary survived that migration: the commands just take a factory now instead of an ops object. The architectural decision captured here is the *split and inject* pattern, not the specific `MethodOperations` shape.

## Consequences

**Positive**
- Adding a command is a new file, not a diff inside a growing god class. Each command's code-review surface is bounded.
- Tests instantiate the CLI with a mock ops (or mock factory), pass argv, and assert on stdout/stderr/exit code. No monkey-patching, no globals, no test ordering pitfalls.
- The `update` field-name class of bug is harder to reintroduce: the DI boundary is a typed interface; a mismatch fails compilation.
- `--version` no longer drifts. The version flows through `version.ts`, which reads `package.json` at runtime. One source of truth.
- `deactivate` is a real command with its own tests, not a runbook step.

**Negative**
- Five files instead of one for the core CLI surface. New contributors need to learn the directory layout, which is trivial but still a learning step.
- Each command registers itself against a shared `program` instance. That shared instance is effectively a side-effect channel between commands. Global options defined on the program are read by each command via `globals()`: clear enough, but it is a coupling worth naming.

**Explicitly accepted trade-offs**
- **No plugin discovery.** Commands are explicitly registered in `cli.ts`. Dynamic discovery (scanning a commands directory at startup) would enable out-of-tree plugins but complicates the startup path and blurs the set of available commands. The four commands are a stable, small set; explicit registration is fine.
- **DI only at the method-operations seam.** The CLI does not inject the commander program or the output formatter. Those are internal wiring; substituting them doesn't serve any real test or extension need.
- **Integration tests still live at the method/API layer.** The CLI's tests validate CLI behavior: argument parsing, error formatting, flag propagation: against mock ops. End-to-end tests that actually hit a Bitcoin node live in `packages/method/lib/` vector-generation scripts.

## References

- [`packages/cli/src/cli.ts`](../../packages/cli/src/cli.ts): top-level `DidBtcr2Cli` shell and global options.
- `packages/cli/src/commands/`: per-command modules.
- [`packages/cli/src/version.ts`](../../packages/cli/src/version.ts): runtime `package.json` version read.
- [`packages/cli/src/output.ts`](../../packages/cli/src/output.ts): `formatResult()` used by every command.
- [`packages/cli/tests/helpers.ts`](../../packages/cli/tests/helpers.ts): `createMockOps()` replacement for monkey-patching.
- [ADR 024](024-api-facade-lazy-and-layered-config.md): later migration to `ApiFactory` that replaced the `MethodOperations` DI shape while preserving the per-command split.

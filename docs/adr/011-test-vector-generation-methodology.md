---
title: "ADR 011: Test Vector Generation Methodology"
---

# ADR 011: Test Vector Generation Methodology

**Status:** Accepted

**Date:** 2026-03-06

**Commit:** [`b47b92f`](https://github.com/dcdpr/did-btcr2-js/commit/b47b92f)

## Context

A reference implementation of a DID method lives or dies by its test vectors. Test vectors are canonical `(input, output)` pairs: the spec-compliant answer to "given this DID, these updates, this network, what does a compliant implementation produce?" Three distinct consumers need them:

1. **This library's own test suite**, to assert behavior stays correct across refactors.
2. **Downstream language implementations** (Rust, Python, Go) performing cross-implementation parity tests: "my Rust resolver produces the same output as your TypeScript resolver on this vector."
3. **Spec reviewers and auditors** who want to see concrete inputs and outputs for each flow, not just prose descriptions.

Before this commit, vectors were generated ad-hoc. Each test had its own setup: some built a DID inline, some loaded hand-crafted JSON, some mocked Bitcoin responses. The drift was predictable: vectors fell out of sync with the spec as it evolved, vectors for one flow were inconsistent with vectors for another, and when a downstream Rust implementation wanted parity vectors, there was no canonical set to hand over.

Three structural problems had to be solved together:

1. **Reproducibility.** A vector should be derivable from a seed. Anyone with the code should be able to regenerate the same vectors byte-for-byte. That means every step: key generation, genesis creation, update signing, funding, broadcasting, resolution: needs to be a step with deterministic inputs and outputs.
2. **Stepped workflow.** The full lifecycle (`create` to `update` to `fund` to `announce` to `resolve`) has real-world side effects: funding a beacon address costs sats on mainnet or testnet faucet grants on testnet. Running it as one monolithic script means every downstream step reruns every upstream step, which is wasteful in the best case and impossible in the worst (re-running `fund` after a successful fund is a double-spend).
3. **Shareability with external implementations.** TypeScript-generated vectors need to be consumable by a Rust parity test without coupling the TypeScript library to the Rust one. Vectors have to live somewhere both projects can point to.

The decision window also surfaced a sub-question about the workflow itself. The spec's create/update/resolve flows have been refining; some steps that used to be distinct (announce as a standalone step, resolve-live as a separate command from resolve) had become noise over time. The methodology commit was the natural place to collapse that noise.

## Options considered

**On vector generation shape:**

1. **Ad-hoc scripts per test.** What existed. Each test owns vector setup. Drift-prone; no canonical set.
2. **Generated in CI per build.** A build-time hook generates fresh vectors. Deterministic across builds only if the seeds are checked in; then effectively equivalent to committed vectors. Complicates CI with fund-dependent steps.
3. **Stepped CLI tool writing structured artifacts.** A command-line tool that exposes each lifecycle step individually, writes inspectable JSON artifacts, and can be re-run per-step. Vectors are committed.

**On storage location:**

1. **In-repo under `packages/method/tests/fixtures/`.** Simple; tightly coupled to the library's test layout. Hard for downstream Rust/Python projects to consume without git-subtreeing our test dir.
2. **In-repo under a top-level `test-vectors/` directory.** Slightly easier to consume externally, but downstream projects still pin to a specific library release to pick up vector updates.
3. **External repository consumed as a git submodule.** Vectors are their own project (`did-btcr2-test-suite`). This library references them via submodule at `packages/method/lib/data/`. Downstream implementations consume the same external repo directly.

**On workflow shape:**

1. **Single monolithic run.** One command, all phases. No intermediate inspection; no partial-failure recovery; re-running is all-or-nothing.
2. **Per-phase CLI subcommands.** `generate-vector create`, `generate-vector update`, etc. Each phase is a separate invocation with its own arguments.
3. **Per-phase subcommands with `--offline` flag for steps that would normally hit the network.** Keeps CI, offline runs, and partial-vector generation ergonomic.

## Decision

**Stepped CLI tool + structured artifacts + external submodule + `--offline` flag per phase.**

**The tool.** `packages/method/lib/generate-vector.ts` is a `tsx`-executed script exposing subcommands:

```
generate-vector create --type k --network regtest ...
generate-vector update --hash <vector-hash> [--offline]
generate-vector fund --hash <vector-hash>
generate-vector announce --hash <vector-hash>
generate-vector resolve --hash <vector-hash> [--offline]
generate-vector list [--network ...] [--type ...]
```

Each subcommand is independently invocable, writes its artifacts to disk, and can be re-run in the rare case that intermediate state changes.

**Structured storage.** Vectors live under `packages/method/lib/data/{network}/{type}/{hash}/` with three subdirectories:
- `create/`: genesis bytes, genesis document (for external), initial DID resolution
- `update/`: patch set, signed update, announcement artifacts
- `resolve/`: resolution input (sidecar), resolution output

The hash in the path is a stable identifier derived from the vector's genesis inputs: the same inputs always produce the same hash, so vectors are content-addressable within the tree.

**External submodule.** The `lib/data/` directory is a git submodule pointing at [did-btcr2-test-suite](https://github.com/dcdpr/did-btcr2-test-suite). Vector commits happen inside the submodule and are pushed to the test-suite repo; the parent repo just bumps the submodule pointer. Downstream language implementations clone the same submodule, giving every compliant implementation access to the same authoritative vector set without any of them depending on this TypeScript library.

**Workflow collapse.** This commit takes the opportunity to clean up accumulated noise:
- `--step <name>` flag replaced by a positional action argument (`generate-vector create` is ergonomic; `generate-vector --step create` is not).
- `announce` merged into `update`: `update` announces by default; `--offline` skips the announcement. Two commands were doing one conceptual thing.
- `resolve` and `resolve-live` merged into `resolve`: resolves live by default; `--offline` uses only sidecar data. Same reason.
- `resolve` no longer requires a prior `update` step: if no update exists, it resolves the initial DID state. This matches what a real consumer does: resolve anything at any point in its lifecycle.

**Supporting code changes.** Along with the methodology, the commit makes `DidBtcr2.create()` synchronous: there was no reason for it to be async and the async signature infected downstream call sites with `await` noise. `lib/` files across packages get linting and type-checking via `lib/tsconfig.json`; they were previously `**/lib/*`-ignored and prone to bit-rot.

## Consequences

**Positive**
- Cross-implementation parity is a first-class capability. The Rust, Python, Go, etc. did:btcr2 implementations consume the same submodule. A spec-behavior disagreement is diagnosable with a concrete vector.
- Each vector is inspectable as JSON files on disk. A spec reviewer opens `lib/data/bitcoin/k1/qqps9pu0/create/input.json` and reads the input directly; no need to run code to see what's being tested.
- Regenerating one vector step doesn't regenerate the whole lifecycle. Fund once; update many times against the funded beacon.
- `--offline` paths let CI and contributors without Bitcoin access run the generator meaningfully. `create`, `update --offline`, `resolve --offline` round-trips through the whole stepped workflow without any network access.
- Library refactors that should not change spec behavior are immediately detectable: if a refactor changes a generated vector, the diff surfaces in the submodule update.

**Negative**
- Submodules add friction. Contributors who've never used submodules hit "my tests don't see any vectors" after cloning: `git submodule update --init` is an easy fix but an easy-to-forget one.
- Two-step commit workflow: commit inside the submodule, push, then bump the submodule pointer in the parent repo. Forgetting the second step leaves the parent repo pointing at stale vectors. Partially mitigated by CI, but still a real operational cost.
- The `{network}/{type}/{hash}/` hierarchy is fixed. Changing the taxonomy (adding a dimension, renaming `k` or `x`) requires migrating every vector. Mitigation: the generator tool could handle migrations, but no one has had to yet.
- Vectors can go stale. A spec revision ([ADR 010](010-spec-v0.2-alignment-and-tracking-policy.md)) regenerates every vector; reviewers need to know whether they're looking at vectors for the current spec or an older one. The submodule's commit history is the truth, not the files in any given parent-repo snapshot.

**Explicitly accepted trade-offs**
- **Vectors are committed, not generated in CI.** A CI-generated approach would save disk space but requires CI to have Bitcoin funding access and deterministic funding behavior. Committed vectors trade storage for reproducibility across every environment without dependency chains.
- **The tool is a `tsx` script, not a compiled binary.** It lives under `lib/`, runs on demand via `pnpm generate:vector`, and has direct access to this library's current implementation. Users of the generator are contributors to this repo, not end users of did:btcr2: so shipping it as a published CLI would be overreach.
- **No versioning inside the vectors themselves.** A vector's `create/input.json` does not embed a spec-version field. Which spec version a vector corresponds to is known by which commit of the submodule it lives in. This keeps the JSON files uncluttered; version-correlation is a submodule-commit-history problem, not a schema problem.
- **No property-based / fuzz vector generation.** All vectors are hand-chosen scenarios. Property-based testing would shake out edge cases but would need a separate infrastructure layer; for now, a growing library of scenario-based vectors is doing its job, and property-based work is a future addition rather than this ADR's scope.
- **Single branch of the submodule.** The test-suite repo tracks `main` only; there are no long-lived branches per spec version. Vectors for older spec versions are accessible by checking out older submodule commits, not by switching branches.

## References

- [`packages/method/lib/generate-vector.ts`](../../packages/method/lib/generate-vector.ts): the generator CLI.
- `packages/method/lib/data/`: submodule pointing at the test-suite repo.
- [did-btcr2-test-suite](https://github.com/dcdpr/did-btcr2-test-suite): the authoritative vector repository.
- [ADR 010](010-spec-v0.2-alignment-and-tracking-policy.md): spec-tracking policy; vectors regenerate on spec revisions.
- [`packages/method/package.json`](../../packages/method/package.json): `generate:vector` script entry.

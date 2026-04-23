---
title: "ADR 024: API Facade: Lazy Construction and Layered Configuration"
---

# ADR 024: API Facade: Lazy Construction and Layered Configuration

**Status:** Accepted

**Date:** 2026-04-10

**Commit:** [`8fe1404`](https://github.com/dcdpr/did-btcr2-js/commit/8fe1404)

## Context

`@did-btcr2/api` is the high-level SDK façade that downstream CLI and application code uses to drive `@did-btcr2/method`. It composes several sub-façades (`crypto`, `did`, `kms`, `btc`, `method`, `cas`), each of which carries its own construction cost: Helia boot, Bitcoin RPC client, KMS backend, etc.

Two earlier attempts each had problems:

1. **Eager construction of everything up front.** Worked but forced every consumer (including a CLI that just wants to resolve a DID) to pay for Helia boot, Bitcoin connection, KMS init, etc. on every invocation. Slow, wasteful, and failure-prone (one subsystem misconfiguration blocks the whole façade).
2. **Manual composition by consumer code.** Every consumer had to know how to wire every sub-façade, which defeated the point of having a façade.

Separately, the CLI needed configuration from multiple sources: CLI flags, env vars, config files, built-in defaults: with clear precedence and validation. Ad-hoc merging in each command was producing inconsistent behavior.

## Options considered

1. **Eager construction, factored into builders.** Better factoring but still eager.
2. **Lazy construction via getters.** Sub-façades instantiate on first access. Composes naturally with layered config because configuration can be fully resolved before any sub-façade asks for it.
3. **Dependency injection container.** Overkill for a façade; would obscure the composition story.

## Decision

**Option 2 for API; a small typed layered-config module for CLI.**

**Lazy API construction.** `Api` exposes sub-façades as property getters. Each getter instantiates the underlying component on first access and caches it. Consumers that never touch `api.btc` never boot a Bitcoin connection.

**Layered config (CLI).** `packages/cli/src/config.ts` implements a strict precedence:

```
CLI flags  >  env vars  >  config file  >  built-in defaults
```

Each layer produces a partial `ResolvedConfig`; layers merge by deep-override. The resolved config is validated once at startup and passed to `Api`.

## Consequences

**Positive**
- CLI commands that only need a subset (e.g., `resolve`) pay only for what they touch. Startup time is dominated by the slowest subsystem actually invoked.
- Misconfiguration surfaces at the point of first use (clear stack trace) rather than at façade construction (obscure wiring error).
- Layered config is explicit, testable, and documented in one place. Adding a new config knob is one edit per layer.
- Config file precedence matches user expectation from similar tools (Git, npm, Docker).

**Negative**
- Lazy getters with caching are a small amount of boilerplate per sub-façade. Worth the pattern consistency.
- Consumers who want to validate configuration eagerly (e.g., "fail at startup if Bitcoin RPC is unreachable") have to explicitly touch `api.btc` after construction to trigger lazy init. Documented but not automatic.
- Layered config adds a module to maintain. Tests pin the precedence logic so regressions are caught.

**Explicitly accepted trade-offs**
- No dependency-injection container. The façade is shallow enough that the pattern would add indirection without clear benefit.
- Sub-façade caches are process-lifetime. Callers needing to rotate a sub-façade (e.g., swap KMS backends mid-run) must construct a new `Api`.

## References

- [`packages/api/src/api.ts`](../../packages/api/src/api.ts): lazy sub-façade getters.
- [`packages/cli/src/config.ts`](../../packages/cli/src/config.ts): layered-config module (flags to env to file to defaults).
- [`packages/cli/tests/config.spec.ts`](../../packages/cli/tests/config.spec.ts): precedence-regression test suite.

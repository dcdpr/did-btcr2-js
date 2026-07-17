---
title: "ADR 085: Typed Errors Across Core Packages, Enforced by Lint"
---

# ADR 085: Typed Errors Across Core Packages, Enforced by Lint

**Status:** Accepted

**Date:** 2026-07-17

**Branch / PR:** `refactor/typed-errors`

**References:** [ADR 050](050-split-aggregation-packages.md) (precedent for
package-scoped ESLint guard blocks)

## Context

`@did-btcr2/common` defines a typed error hierarchy rooted at `DidMethodError`:
every subclass carries a stable `name`, a machine-readable `type` string, and an
optional structured `data` payload, and the constructor normalizes prototype
chains and V8 stack capture. The method, aggregation, cryptosuite, keypair, and
key-manager packages all build their domain errors on this hierarchy, and prior
resolver hardening work added regression tests asserting that malformed input
surfaces as a typed error rather than a bare `TypeError`.

An audit of every error construction across the workspace found the hierarchy
was almost, but not quite, universal. The stragglers:

- **common**: `DateUtils` threw bare `Error` for invalid dates;
  `JSONUtils.deepEqual`/`clone` threw bare `Error` for depth and circularity
  guards; `JSONPatch.validateOperations` returned bare `Error` objects (which
  `apply()` then wrapped); and `NotImplementedError` extended `Error` directly,
  outside the hierarchy, with a one-off options-object constructor.
- **aggregation**: `InboxBuffer` threw bare `Error` for an invalid capacity;
  the service runner failed cohorts with `new Error(reason)` for TTL expiry,
  phase stalls, and validation rejections; the participant HTTP client's
  internal `sleep()` rejected with `new Error('aborted')`.
- **method**: `Appendix.getVerificationMethods` threw a bare `TypeError` for a
  missing `didDocument` parameter.

The cost of these gaps is that callers cannot uniformly `catch` on
`instanceof DidMethodError`, cannot inspect `.type`/`.data` on the escaping
errors, and the error contract differs from the one the rest of the codebase
documents and tests.

## Decision

### 1. Core-package sources construct only typed errors

In `common`, `keypair`, `cryptosuite`, `key-manager`, `method`, and
`aggregation`, every error object constructed in `src/` is a `DidMethodError`
subclass (from common's `errors.ts` or a package error module built on it),
with a SCREAMING_SNAKE `type` string and, where useful, a structured `data`
payload. The audit's specific fixes:

- `DateUtils` throws `MethodError(..., 'INVALID_DATE')`.
- `JSONUtils` guards throw `MethodError(..., 'MAX_DEPTH_EXCEEDED')` and
  `MethodError(..., 'CIRCULAR_STRUCTURE')`.
- `JSONPatch.validateOperations` returns `MethodError | null` with type
  `'JSON_PATCH_VALIDATION_ERROR'` (its wrapper `apply()` already threw
  `MethodError`).
- `InboxBuffer` throws
  `AggregationServiceError(..., 'INVALID_INBOX_CAPACITY', { capacity })`.
- The service runner fails cohorts with `AggregationCohortError` typed
  `'COHORT_TTL_EXCEEDED'`, `'COHORT_PHASE_STALLED'`, or
  `'VALIDATION_REJECTED'`, each carrying `{ cohortId }` (and the rejecting
  participant DID where relevant).
- The HTTP client's `sleep()` rejects with
  `HttpTransportError('aborted', 'SLEEP_ABORTED')`. This rejection is internal
  control flow (always caught inside the subscribe loops), but typing it keeps
  the package rule exception-free and lintable.
- `Appendix.getVerificationMethods` throws `DidDocumentError` for the missing
  parameter.

Error **messages** at every touched site are unchanged, so message-matching
callers and tests are unaffected; only the class, `name`, and `type` surface
changed.

### 2. `NotImplementedError` joins the hierarchy

`NotImplementedError` now extends `DidMethodError` and gains the same
positional constructor shape as every other subclass:
`(message, type = 'NotImplementedError', data?)`. The legacy options-object
second argument is retained as a deprecated overload so the change stays
within a minor version of `@did-btcr2/common`: common is a 9.x package on
strict semver, and a major there forces a coordinated republish of every
dependent (all pin `^9.x`, so a lone major would leave consumer trees with two
common instances and a split error hierarchy). The overload is slated for
removal at the next natural common major. The one in-repo call site that used
the object form (the api package's `DidMethodApi.deactivate`) now passes the
type string `'DID_API_METHOD_NOT_IMPLEMENTED'` positionally, and that error's
`name` now equals its `type` (previously the two were set to different
strings).

### 3. A lint rule prevents regression

A `no-restricted-syntax` ESLint block (following the ADR 050 precedent of
package-scoped guard blocks in `eslint.config.cjs`) bans construction of bare
`Error`, `TypeError`, `RangeError`, `SyntaxError`, `EvalError`,
`ReferenceError`, and `URIError` in the six packages' `src/` trees. The rule
matches any construction, not just throw statements, so returned and
promise-rejected errors are covered too. Tests are out of scope: they may
construct whatever they need.

### 4. Explicit exclusions

- **smt** keeps standard JS errors (`RangeError`, `Error`) by design: it is a
  zero-dependency package and importing common's hierarchy would break that.
- **api, bitcoin, cli** still contain bare error constructions (19 in api, 7
  in bitcoin, 1 in cli at the time of this audit). Sweeping them is
  deliberate follow-up work, after which the lint block's `files` list should
  be extended to cover them.
- **`@web5/dids` `DidError` sites in method** (capability-id validation in
  `Appendix.dereferenceZcapId`, resolution error codes in `did-btcr2.ts`)
  remain. These are typed errors pinned to W3C DID resolution semantics; they
  are just not from common's hierarchy. Whether to migrate them is left as an
  open question for a future ADR, since it changes a documented error contract
  for no functional gain.

## Consequences

- Everything escaping the six core packages' own code is `instanceof
  DidMethodError`, with `.type` and (where populated) `.data` available for
  programmatic handling; cohort failures now carry `cohortId` instead of only
  a prose reason string.
- The touched sites changed error class and `name` (for example an invalid
  date now surfaces `name: 'INVALID_DATE'` instead of `'Error'`). Callers
  matching on classes or names, rather than messages, will observe the change.
  All affected packages are 0.x; the change rides the next MINOR bumps.
- `NotImplementedError` gains `instanceof DidMethodError`; broad
  `catch (e) { if (e instanceof DidMethodError) ... }` handlers now also see
  not-implemented errors. External callers using the options-object
  constructor keep working through the deprecated overload.
- The lint rule turns the policy from convention into CI enforcement; a future
  bare `throw new Error(...)` in a covered package fails `pnpm lint`.
- Follow-up: sweep api, bitcoin, and cli to typed errors and extend the lint
  block; revisit the `@web5/dids` `DidError` question when that sweep lands.

## Rejected Alternatives

- **Dedicated classes per utility (`DateError`, `JsonError`, ...)**: two or
  three throw sites each do not justify new exported classes; `MethodError`
  plus a `type` string is the idiom common itself already used in
  `JSONPatch.apply`.
- **Repo-wide lint enforcement now**: api, bitcoin, and cli still contain bare
  constructions, so a workspace-wide rule would fail CI until that sweep
  lands; scoping the rule to the already-clean packages makes it land green
  and ratchet forward.
- **Migrating smt to common errors**: breaks the zero-dependency design for no
  consumer benefit; smt's `RangeError` usage is conventional for a standalone
  data-structure library.

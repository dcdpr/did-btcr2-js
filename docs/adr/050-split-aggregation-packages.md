---
title: "ADR 050: Split the Aggregation Package into Core, Participant, and Service Subpath Exports"
---

# ADR 050: Split the Aggregation Package into Core, Participant, and Service Subpath Exports

**Status:** Accepted (implementation pending)

**Date:** 2026-06-26

**Branch / PR:** `refactor/split-aggregation-packages`

**Implementation status:** This record fixes the design ahead of the change on this branch. At the time of writing the aggregation subsystem is a single package with a flat source layout and one entry point, the method package re-exports it wholesale, and the boundary between the participant and service roles is not enforced anywhere; the role reorganization, subpath exports, lint-enforced boundary, and method-package decoupling described below are the accepted target, not yet present in the code.

**References:** [ADR 008](008-aggregation-subsystem-inception.md), [ADR 020](020-aggregation-layered-architecture.md), [ADR 024](024-api-facade-lazy-and-layered-config.md), [ADR 028](028-http-transport-additive.md), [ADR 037](037-single-party-beacon-and-two-axis-model.md), [ADR 046](046-extract-aggregation-package.md)

## Context

The aggregation subsystem was extracted into a single package ([ADR 046](046-extract-aggregation-package.md)), keeping its original flat layout. That package bundles three roles: a shared protocol-and-crypto core, a participating client, and a coordinating service, plus every transport (Nostr, in-memory, and both the HTTP client and server). The real consumers of aggregation are server and client applications, and those consumers are asymmetric: a participating client, often a browser, never hosts a server, and a coordinating service never runs the client side.

A single flat package forces both sides onto every consumer, and the coupling is concrete. The transport factory selects a transport from a config and statically imports every transport, including the HTTP server transport with its server-side machinery (SSE writing, inbox buffering, rate limiting, nonce caching, request authentication). Any consumer that reaches the factory drags all of it in, including a browser client that can never host a server, and a static import cannot be tree-shaken away. The HTTP server transport is itself sans-I/O, so this is dead weight in the bundle rather than a hard incompatibility, but it is dead weight a client should not have to carry.

Two earlier ideas to give aggregation a "product" home were rejected. Driving it from the command-line tool fails because a command-line tool is one-shot and request/response, a poor host for long-lived multi-party coordination. Wrapping it behind the SDK facade fails because the facade exists to drive the method package's sans-I/O state machines ([ADR 024](024-api-facade-lazy-and-layered-config.md)) and offer a browser-compatible convenience layer; aggregation already has its own driver layer in the runners and transports, so wrapping them behind the SDK is a facade over a facade in a package whose job is unrelated. The one method-specific touchpoint, resolving a sender's key from a did:btcr2 identifier, is injected into the transport and already lives in the method package.

The single package also earns the method package an unused dependency: it re-exports aggregation wholesale for backward compatibility with the pre-extraction import path, and parks a set of aggregation integration tests in its own suite. Nothing downstream imports aggregation through the method package; the method runtime never calls into it; the only consumers of aggregation in the entire repository are that re-export and those method-resident tests. The compatibility shim protects a compatibility nobody relies on.

The remaining question is how to draw the role boundary. Three separate packages draw it hardest, but add three publishable units to an already-large monorepo, force a shared-base-plus-two-role-packages structure, and orphan the two cross-role pieces (the in-process single-party runner and the transport factory) that need both roles at once. A single package with per-role subpath entry points draws the same boundary for bundling purposes at far less structural cost.

## Decision

### 1. One package, three role entry points via subpath exports

Keep the single `@did-btcr2/aggregation` package and reorganize its source into three role directories - core, participant, and service - each with a barrel, exposed as subpath exports: `@did-btcr2/aggregation/core`, `@did-btcr2/aggregation/participant`, `@did-btcr2/aggregation/service`. A consumer imports the role it is. Because the participant entry's module graph reaches the core and participant sources but never the service sources, and the service entry's reaches core and service but never participant, a client application that imports only the participant entry never pulls service code into its bundle: the service modules are never reached, so their exclusion is guaranteed rather than dependent on a bundler's dead-code elimination.

The allocation: the core holds everything both roles share - the MuSig2 signing core, the wire messages, the cohort model and conditions, the recovery and fallback scripts, the protocol phases, the beacon strategy, the errors and logger, the base transport interface, the in-memory and Nostr transports, the shared HTTP primitives (signed-envelope format, request authentication, protocol descriptors, HTTP errors), and the generic typed event emitter. The participant holds the participant state machine, its runner, the HTTP client transport, the client-side server-sent-events reader, and the participant's events. The service holds the service state machine, its runner, the HTTP server transport with its server-side machinery, and the service's events. The one combined module that references both roles, the runner events, splits along the role line.

### 2. Cross-role conveniences live at the umbrella entry, not in a role

The package's main entry hosts the two pieces that legitimately need both roles: the in-process single-party runner (a service and a participant in one process over the in-memory transport, used to generate single-participant test vectors) and the transport factory (which constructs any transport from a config). In a single package these import both role directories without trouble, and because no role entry imports the main entry, a participant or service consumer never pulls them. The two pieces that a three-package split would have forced us to drop or relocate survive here as opt-in umbrella conveniences.

### 3. The role boundary is enforced by lint, since package resolution does not enforce it

Within one package, nothing at the module-resolution level stops a participant source from importing a service source and silently re-coupling the roles. A lint rule forbids cross-role imports - participant may not import service and the reverse, while both may import core - making the boundary a checked invariant rather than a convention, and preserving the bundling guarantee the subpath entries provide.

### 4. The method package drops its dependency on aggregation

The method package's wholesale re-export of aggregation, and the dependency edge that exists only to serve it, are removed; the method runtime never used them. The aggregation integration tests parked in the method package move to the aggregation package, where they development-depend on the method package for the did:btcr2 identifier and the sender-key resolver. This is acyclic because the method package no longer depends on aggregation. The sender-key resolver stays an exported method symbol: its real job is bridging a did:btcr2 identifier to a transport sender key, which a did:btcr2 application wires into the transport. Removing the re-export is a breaking change to the method package's published surface that affects no consumer.

## Consequences

- A client application imports the participant entry and never bundles server-hosting code; a service application imports the service entry. What a consumer bundles matches the asymmetry it actually has.
- The single-party runner and the transport factory remain available at the umbrella entry; nothing is dropped to satisfy the split.
- The role boundary is a lint-checked invariant rather than a convention, so re-coupling is caught at lint time.
- The method package becomes independent of aggregation, a cleaner dependency graph, at the cost of a breaking removal of re-exported symbols nothing imports.
- The monorepo gains no new packages; the aggregation package keeps its name and gains a structured source layout, an exports map, and a multi-entry build.
- The work is a source reorganization plus an exports map and a multi-entry build, paid once; the one real surgery is splitting the combined events module along the role line.

## Rejected alternatives

- **Three separate packages (a shared core plus participant and service).** Draws the hardest boundary - package resolution enforces it and each role versions independently - but adds three publishable units to an already-large monorepo, orphans the single-party runner and the transport factory (each needs both roles, leaving them with no home but a fourth package or deletion), and imposes more structure than the bundling goal requires. Subpath entries draw the same boundary for bundling at a fraction of the cost.
- **A separate repository for aggregation.** It shares several foundational packages (common, keypair, bitcoin, the sparse-Merkle-tree, cryptosuite) that are still co-evolving; a separate repo turns those into cross-repo version coordination and leaves aggregation chronically behind its foundation. The protocol being out of the method's spec scope is a reason it could move eventually, but the dependency gravity keeps it here for now. Revisit once the foundational packages stabilize.
- **Keeping a single flat package and relying on tree-shaking.** The transport factory's static fan-in over all transports defeats tree-shaking for any consumer that reaches it, and a flat package offers no entry a consumer can import to guarantee it excludes the other role. The subpath entries provide that guarantee structurally.
- **Driving aggregation from the command-line tool, or behind the SDK facade.** A long-lived multi-party protocol is a poor fit for a one-shot command, and the SDK facade is the method package's driver, not aggregation's. Aggregation already has its own runner and transport layer, which applications consume directly through the role entries.

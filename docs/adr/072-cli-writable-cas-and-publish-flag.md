---
title: "ADR 072: CLI Writable-CAS Configuration and an Opt-In --publish-to-cas Flag"
---

# ADR 072: CLI Writable-CAS Configuration and an Opt-In --publish-to-cas Flag

**Status:** Accepted

**Date:** 2026-07-07

**Branch / PR:** `feat/cli-cas-rpc-url`

**References:** [ADR 070](070-broadcast-result-and-cas-first-ordering.md), [ADR 071](071-api-cas-publication-policy.md), [ADR 073](073-cas-publication-is-opt-in.md)

## Context

[ADR 071](071-api-cas-publication-policy.md) wired CAS publication into the api update path behind a `publishToCas: 'auto' | 'always' | 'never'` policy and gave `CasConfig` a writable `rpcUrl` executor. The cli, however, could only configure a read-only CAS: its `--cas-gateway` flag, `BTCR2_CAS_GATEWAY` env var, and `profiles.<n>.cas.gateway` config key all map to a read-only IPFS HTTP gateway, and `resolveConnectionConfig` hard-typed the CAS it built as `{ gateway: string }`. ADR 071 §7 had the cli pass `publishToCas: 'never'` explicitly, with a note that a follow-up would "add writable-CAS configuration and a `--publish-to-cas` flag, at which point the explicit `'never'` is replaced by the exposed knob." This ADR is that follow-up.

[ADR 073](073-cas-publication-is-opt-in.md) lands on this same branch and corrects the api policy so CAS publication is opt-in: the default is `'never'` and `'auto'` is best-effort (never blocks an update). This cli work assumes that corrected policy.

A separate config-surface gap: `btcr2 config set profiles.x.cas.rpcUrl <url>` already wrote the key to disk (the `config set` command is a generic dotted-path writer), but `profileToOverrides` never read it back, so the value was silently dropped.

The governing principle, from the method's design and the did:btcr2 spec, is that **CAS publication is optional and never required**. Every beacon update, including a CAS beacon's, can be completed and distributed entirely via sidecar. Publishing update artifacts to a content-addressed store is a convenience that makes OP_RETURN update hashes fetchable at resolution time without sidecar data; it is something a user opts into, not a precondition for updating.

## Decision

1. **A writable CAS is configurable through the same three-layer override chain as every other endpoint.** New `--cas-rpc-url <url>` global flag, `BTCR2_CAS_RPC_URL` environment variable, and `profiles.<n>.cas.rpcUrl` config key, merged in the standard precedence (CLI flag > env var > config file). `resolveConnectionConfig` now returns `cas?: CasConfig` (widened from `{ gateway: string }`) and passes both `gateway` and `rpcUrl` through when set; the api's `CasConfig` priority (`rpcUrl > gateway`) selects the writable RPC executor when both are present. `profileToOverrides` now reads `cas.rpcUrl`, closing the silently-dropped-key gap.

2. **`update` and `deactivate` gain `--publish-to-cas <auto|always|never>`, defaulting to `'never'`.** The value is validated at parse time (an invalid value errors before any signing or spending) and forwarded verbatim to the api's `publishToCas`. This replaces the hardcoded `'never'` from ADR 071 §7.

3. **The cli default is `'never'`, matching the corrected api default (ADR 073).** CAS publication stays strictly opt-in. A user who wants it passes `--publish-to-cas auto` (or `'always'`) and configures a writable CAS via `--cas-rpc-url`. With the default, `update`/`deactivate` complete sidecar-only and print every artifact a resolver needs (signed update, txid, announcement for CAS beacons, SMT proof for SMT beacons) for the user to distribute.

## Consequences

- The cli's default behavior is unchanged from the ADR 071 release: no `--publish-to-cas` flag means `publishToCas: 'never'`, exactly the value ADR 071 §7 hardcoded. This is purely additive; existing scripts are unaffected.
- Configuring `--cas-rpc-url` alone does nothing until the user also opts in with `--publish-to-cas auto`/`always`. Requiring both is the cost of keeping publication opt-in: a configured writable endpoint is a capability, not a directive to use it.
- Once a user opts in, the api's corrected policy (ADR 073) applies: `'auto'` publishes to a writable CAS and otherwise completes the update sidecar-only for every beacon type (it never blocks), while `'always'` requires a writable CAS and errors up-front (naming `cas.rpcUrl`) when none is configured.
- **Privacy:** opting into `auto`/`always` publishes canonical signed updates (and announcements) to the configured, possibly public, CAS before the on-chain anchor. The `'never'` default keeps update data off public stores, matching the spec's guidance for privacy-conscious controllers. This is documented on the flag and in the cli README.
- The change is a cli-only minor bump for the flag/config surface; the paired api correction (ADR 073) is a separate minor bump on `@did-btcr2/api`. The method package is untouched.

## Rejected alternatives

- **Default the cli to `'auto'`.** Even with the corrected api `'auto'` (which no longer blocks), defaulting the cli to `'auto'` would publish canonical signed updates to a configured CAS as a side effect of the user having configured `--cas-rpc-url` (perhaps only for reads), which is opt-out. Keeping the default `'never'` means publication happens only when the user explicitly asks, honoring "CAS publication is opt-in, never required." A writable endpoint is a capability, not a directive.
- **A "smart" default that publishes when a writable CAS is configured and stays silent otherwise.** Convenient, but it couples two independent user intents (configure an endpoint vs. publish to it) and makes the publish decision implicit and config-dependent. An explicit flag is predictable and auditable; a user reading a command line sees exactly whether publication happens.
- **Map `--cas-gateway` to a writable executor.** An IPFS HTTP gateway is read-only by protocol (trustless-gateway serves blocks, it does not accept `block/put`). Writes require the RPC API, which is a distinct endpoint; conflating them would misrepresent the gateway's capability and surface as a mid-operation failure.
- **A single `--cas-url` flag inferring read-vs-write from the endpoint.** Gateway and RPC endpoints are not reliably distinguishable by URL, and the read/write distinction is exactly what the writable-capability detection in ADR 071 exists to make explicit. Two named flags keep the capability legible.

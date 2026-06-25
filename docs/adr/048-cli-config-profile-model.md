---
title: "ADR 048: CLI Configuration and Profile Model: Writable Config with Identity and Aggregation Profiles"
---

# ADR 048: CLI Configuration and Profile Model: Writable Config with Identity and Aggregation Profiles

**Status:** Accepted (implementation pending)

**Date:** 2026-06-25

**Branch / PR:** `feat/cli-keystore-config`

**Implementation status:** This record fixes the design ahead of the change on this branch. At the time of writing the command-line tool reads layered configuration but has no writer, and its profile schema covers only Bitcoin and CAS endpoints; the writer, command groups, and extended schema described below are the accepted target, not yet present in the code.

**References:** [ADR 013](013-cli-per-command-dependency-injection.md), [ADR 024](024-api-facade-lazy-and-layered-config.md), [ADR 005](005-bitcoin-package-extraction-and-browser-decoupling.md), [ADR 009](009-sans-io-bitcoin-transport-foundation.md), [ADR 047](047-cli-encrypted-keystore.md)

## Context

The command-line tool already reads layered configuration: per-network profiles in a JSON file under the configuration directory, environment variables, and command flags, merged by precedence (flag over environment over file over built-in network default), with the file path resolved per the XDG base-directory convention. This mirrors the API's lazy, layered configuration ([ADR 024](024-api-facade-lazy-and-layered-config.md)) at the tool's file layer.

That configuration is read-only from the tool's perspective. There are reader and merge functions but no writer: a user must hand-edit JSON to set an endpoint or add a profile. The schema covers only Bitcoin connection endpoints and a CAS gateway per profile. There is no notion of an identity (which keystore, which default key) or of aggregation settings (which transport, which relays, what default cohort conditions), both of which the tool needs once it holds keys ([ADR 047](047-cli-encrypted-keystore.md)) and drives aggregation.

Profiles are currently selected only by matching the network name; there is no active profile decoupled from the network. There is no command to create, inspect, or edit configuration, and no shell-completion support.

Bitcoin network default endpoints still live in the sans-I/O Bitcoin package ([ADR 005](005-bitcoin-package-extraction-and-browser-decoupling.md), [ADR 009](009-sans-io-bitcoin-transport-foundation.md)) rather than in a layer that may legitimately know about third-party service URLs. A `config init` that seeds sensible defaults needs a single, correctly-layered source of those defaults.

## Decision

### 1. Add a configuration writer that preserves unknown keys

Configuration mutations read the existing file, modify only the targeted dotted path, and write the whole object back, leaving unrecognized keys intact. The file carries a schema version so future readers can migrate. Writers create the file mode 0600 and its directory 0700, and validate every write against the schema, raising a typed error on an unknown network, malformed URL, or unknown transport type.

### 2. Add config, profile, and completion command groups

`config init` writes a default configuration (refusing to overwrite without an explicit force flag) seeded with one profile per supported network. `config get`, `config set`, and `config unset` operate on dotted paths; `config list` prints the resolved configuration. A `profile` group adds, selects (`use`), shows, and removes profiles; `profile show` reports each resolved value together with the layer it came from (flag, environment, file, or default), so precedence is legible. A `completion` command emits a shell-completion script to standard output for the user to install, rather than a postinstall hook that edits shell startup files.

### 3. Extend the schema additively: defaults, identity, and aggregation

A top-level `defaults` block records the active profile, the default network, and the default output format. Each profile gains an `identity` section (a keystore path and a default key identifier, both references only, never embedded key material) and an `aggregation` section (transport type, relay URLs or HTTP base URL, and default cohort conditions). The aggregation fields mirror the transport configuration the aggregation runners already accept, so configuration maps onto the runner inputs without translation. The existing Bitcoin and CAS sections are unchanged.

### 4. The active profile is decoupled from the network name

Profile selection resolves in order: an explicit profile flag, then the active profile from `defaults`, then the network name (the current behavior, preserved as the final fallback). A user can keep multiple profiles for one network and switch between them without renaming.

### 5. Configuration never stores secrets; identity is a reference

The identity section points at a keystore file and a key identifier; the secret lives only in the encrypted keystore ([ADR 047](047-cli-encrypted-keystore.md)). The Bitcoin RPC password remains the one cleartext credential the schema accepts, as it does today; the tool documents this and steers users toward providing it through an environment variable instead. No new secret-bearing field is added to configuration.

### 6. Configuration is never written behind the user's back

Commands that need a connection but find no configuration print a hint to run `config init` rather than failing opaquely or silently materializing a file. Writes happen only in response to an explicit `config` or `profile` command.

### 7. Bitcoin network defaults move to a correctly-layered source

The per-network default endpoints move out of the sans-I/O Bitcoin package into a layer that may know about third-party service URLs, so that `config init` and the API seed defaults from one source. This record captures the dependency; the move itself lands with, or immediately before, the configuration writer. If it slips, `config init` may temporarily read the defaults from their present location, re-incurring the layering smell the move exists to remove.

## Consequences

- A user can bootstrap and edit configuration without hand-writing JSON, and can carry identity and aggregation settings in the same profile mechanism that already carries connection settings.
- Precedence stays the established flag over environment over file over default, now with an explicit active-profile layer, and `profile show` makes provenance visible.
- The schema grows but stays backward-compatible: existing Bitcoin-and-CAS-only files keep working, unknown keys survive a rewrite, and the schema version gates future migrations.
- Configuration stays free of secret key material; the only cleartext credential remains the Bitcoin RPC password, documented and steerable to the environment.
- The Bitcoin-defaults move is now on the critical path for a clean `config init`; deferring it is possible but reintroduces a known layering issue.

## Rejected alternatives

- **Keep configuration read-only and document hand-editing.** Zero code, but a poor experience and untenable once identity and aggregation settings, with their validation needs, enter the file. A writer with validation is the baseline.
- **A single flat configuration without profiles.** Simpler, but the tool already supports multiple networks and will support multiple aggregation endpoints; profiles are the established grouping and are extended rather than replaced.
- **Embedding the active key or its secret in configuration.** Convenient but conflates portable settings with secret custody and invites leaking a key by sharing a config file. Identity is a reference into the encrypted keystore only ([ADR 047](047-cli-encrypted-keystore.md)).
- **A postinstall hook that writes shell completion into the user's shell startup files.** Fragile and intrusive across shells and install methods; emitting the script to standard output for the user to install is the least-surprising approach.

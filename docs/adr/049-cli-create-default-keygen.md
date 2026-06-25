---
title: "ADR 049: Default Keypair Generation in the create Command"
---

# ADR 049: Default Keypair Generation in the create Command

**Status:** Accepted (implementation pending)

**Date:** 2026-06-25

**Branch / PR:** `feat/cli-create-keygen`

**Implementation status:** This record fixes the design ahead of the change on this branch. At the time of writing the `create` command requires the caller to supply genesis bytes as a flag and is wired to the keystore-free factory; the default generation path, the existing-key path, the optional network, and the additive genesis-document re-export described below are the accepted target, not yet present in the code.

**References:** [ADR 003](003-bech32m-did-encoding.md), [ADR 013](013-cli-per-command-dependency-injection.md), [ADR 018](018-beacon-hierarchy.md), [ADR 024](024-api-facade-lazy-and-layered-config.md), [ADR 047](047-cli-encrypted-keystore.md), [ADR 048](048-cli-config-profile-model.md)

## Context

The `create` command requires the caller to supply genesis bytes as a hex flag: a 33-byte compressed public key for a deterministic (key) identifier, or a 32-byte document hash for an external identifier. There is no way to mint an identifier from nothing. A user must already hold a key in some other tool and paste its public key, which is friction for the most basic first step of using the method.

The tool now holds keys. There is an encrypted keystore with a key-management command group ([ADR 047](047-cli-encrypted-keystore.md)) and a writable configuration and profile model ([ADR 048](048-cli-config-profile-model.md)). Generated keys persist and an active key is tracked across invocations. But `create` is wired to the keystore-free factory and ignores the keystore entirely, so an identifier minted today has no controllable key in the keystore and cannot be updated or deactivated without a separate import step.

The SDK facade already exposes a one-call generate-and-create path: it mints a keypair, imports it into the injected key manager, and returns the identifier together with the key identifier. Under the keystore-backed key manager that import seals and persists the secret. The capability exists; `create` does not use it.

A deterministic (key) identifier needs no genesis document and no sidecar at resolution; it is derived purely from the public key ([ADR 003](003-bech32m-did-encoding.md)), and its initial document, including a single-party beacon service, is reconstructed deterministically ([ADR 018](018-beacon-hierarchy.md)). An external identifier is different: it needs a genesis document constructed, hashed, and retained as sidecar data for resolution.

## Decision

### 1. Generate a keypair by default when no key is supplied

For a deterministic identifier, when the caller gives neither raw genesis bytes nor a key reference, `create` generates a fresh keypair, persists it to the encrypted keystore, sets it as the active key, and prints the identifier. Running the command with no key material is the common path: a user mints a new, immediately-controllable identifier in one step. Sealing the secret requires the keystore passphrase, so this path prompts for it (or reads it from the configured non-interactive source). The two key-supplying paths below do not prompt.

### 2. Three input modes for a deterministic identifier, selected by presence

- **generate** (no key flag): as above.
- **existing key reference**: the global key-reference flag selects a key already in the keystore by identifier, fingerprint prefix, or name; its public key becomes the genesis bytes. Reading a public key never decrypts a secret, so this path does not prompt for the passphrase.
- **raw bytes**: the existing flag supplies a 33-byte compressed public key as hex; this path stays keystore-free and offline, unchanged.

The three modes are mutually exclusive. Supplying more than one is a typed error rather than a silent precedence rule, so the caller's intent is never guessed.

### 3. External identifiers stay raw-bytes-only

An external identifier still requires the 32-byte genesis-document hash via the raw-bytes flag. Generation and the key-reference path apply only to deterministic identifiers; requesting either for an external identifier is a clear error. Generating an external identifier (mint a key, build a genesis document, hash it, and retain the sidecar) is deferred: it introduces sidecar-persistence concerns the deterministic path does not have, and the deterministic path delivers the headline capability on its own.

### 4. The network is optional and resolves from configuration

The network flag becomes optional. When omitted, `create` resolves the network from configuration in order: an explicit default network, then an active profile named for a network, then a development fallback. A user who has set a default network or an active profile ([ADR 048](048-cli-config-profile-model.md)) can mint an identifier with no flags at all; an explicit network flag still wins. Generation itself remains offline and needs no Bitcoin connection.

### 5. Output: the identifier on standard output, key provenance alongside

`create` prints the identifier string on standard output in text mode, so it stays scriptable, and reports the generated or selected key identifier on the human side channel. In structured-output mode the result object carries the identifier together with the key identifier and public key, so an automated caller can record which key controls the new identifier. The raw-bytes path, which involves no keystore key, reports only the identifier as before.

### 6. Reuse the existing generate-and-create path; expose the genesis-document builder

The command uses the facade's existing generate-and-create method rather than a new one ([ADR 024](024-api-facade-lazy-and-layered-config.md)); the only behavioral change is that it runs against the keystore-backed key manager so the secret persists. Separately, the genesis-document class, which builds a full genesis document (a verification method and a beacon service) from a public key, is re-exported from the SDK. This closes a documented export gap and is the additive groundwork for a future external-generation path, without building that path now.

## Consequences

- A first-time user mints a controllable identifier with a single command and no external key tooling; the resulting key is active and immediately usable by update and deactivate.
- `create` gains a passphrase prompt on the generate path only. The raw-bytes path stays fully offline and prompt-free, preserving the air-gapped create workflow.
- `create` now uses the keystore-backed factory for the generate and existing-key paths, where before it used only the keystore-free factory. The raw-bytes path keeps the keystore-free factory, so `create` does not require a keystore to exist unless the user asks it to generate or reuse a stored key.
- The network flag is no longer required, a small contract change; invocations that pass it are unaffected.
- The SDK surface grows by one additive re-export (the genesis-document builder); no existing export changes.

## Rejected alternatives

- **An explicit generate flag instead of generate-by-default.** Explicit is marginally less surprising but defeats the goal of a one-command mint. The default-when-absent rule keeps the raw-bytes and reference paths explicit while making the common case frictionless, and the mutual-exclusivity error removes the ambiguity an explicit flag would otherwise resolve.
- **A new dedicated generate-and-create method on the SDK.** The facade already has one; adding another would duplicate it. The only SDK change needed is the additive genesis-document re-export.
- **Building external-identifier generation now.** It requires constructing and persisting a genesis document as sidecar data, a larger surface with its own retention concerns. The deterministic path delivers the headline capability, and re-exporting the genesis-document builder lets the external path follow additively.
- **Keeping the network flag required.** Simpler, but it blocks the zero-flag mint the configuration model ([ADR 048](048-cli-config-profile-model.md)) already makes possible. Resolving the network from configuration reuses that model rather than inventing a second default.

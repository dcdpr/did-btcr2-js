---
title: "ADR 047: CLI Secret-Key Custody via an Encrypted File-Backed Keystore"
---

# ADR 047: CLI Secret-Key Custody via an Encrypted File-Backed Keystore

**Status:** Accepted (implementation pending)

**Date:** 2026-06-25

**Branch / PR:** `feat/cli-keystore-config`

**Implementation status:** This record fixes the design ahead of the change on this branch. At the time of writing the command-line tool injects no key manager and the only `KeyValueStore` implementation is the in-memory `MemoryStore`; the encrypted file-backed store described below is the accepted target, not yet present in the code.

**References:** [ADR 007](007-kms-package-boundary.md), [ADR 012](012-kms-dual-signing-urn-identifiers.md), [ADR 013](013-cli-per-command-dependency-injection.md), [ADR 015](015-keypair-security-hardening-noble-migration.md), [ADR 019](019-browser-compat-and-noble.md), [ADR 024](024-api-facade-lazy-and-layered-config.md), [ADR 033](033-key-manager-package-rename.md), [ADR 034](034-key-manager-capability-pattern.md), [ADR 038](038-musig2-key-custody.md), [ADR 048](048-cli-config-profile-model.md)

## Context

The `btcr2` command-line tool has so far been deliberately key-agnostic. It mints identifiers from caller-supplied bytes and resolves DIDs, neither of which touches a secret key. The write-path commands (`update`, `deactivate`) are registered but exit unimplemented, for one reason only: the tool has no way to hold or use a signing key.

The key-management package already defines a mature `KeyManager` surface: scheme-aware signing (ECDSA, BIP-340, BIP-341, per [ADR 012](012-kms-dual-signing-urn-identifiers.md)), URN-style key identifiers (`urn:kms:secp256k1:<fingerprint>`), watch-only entries that hold only a public key ([ADR 012](012-kms-dual-signing-urn-identifiers.md)), an export-capability gate (`canExport`, [ADR 034](034-key-manager-capability-pattern.md)), and arbitrary string tags. Persistence is abstracted behind a `KeyValueStore` interface.

The only `KeyValueStore` implementation is an in-memory store backed by a map. The command-line tool builds a fresh API instance per invocation and never injects a key manager, so any key it generates or imports lives only for the duration of one process and is gone at exit. There is no durable secret custody anywhere in the tool.

To let a user generate a keypair once and use it across separate `create`, `update`, `deactivate`, and aggregation invocations, the tool needs a durable, secure place to keep secret keys. The did:btcr2 specification governs identifier encoding, the cryptosuite, and beacon mechanics; it is silent on how an implementation stores secret keys at rest. This is therefore an implementation decision.

Two standing constraints bound the design. First, the key-management package is part of the browser-bundled core and must not depend on Node-only filesystem, operating-system, or process APIs ([ADR 019](019-browser-compat-and-noble.md)). Second, the project's cryptographic dependency policy admits only the @noble and @scure families ([ADR 015](015-keypair-security-hardening-noble-migration.md), [ADR 019](019-browser-compat-and-noble.md)); any encryption at rest must be built from those.

## Decision

### 1. A Node-only file-backed KeyValueStore, injected at the tool boundary

Implement a `FileKeyStore` against the existing `KeyValueStore<KeyIdentifier, KeyEntry>` interface, living in a Node-only location (the command-line package, or a Node-only subpath of the key-management package, never its browser-bundled core). The tool injects a `LocalKeyManager` backed by that store into the API through the existing key-manager injection point (`ApiConfig.kms`, [ADR 024](024-api-facade-lazy-and-layered-config.md)). The key-management core stays storage-agnostic and browser-safe; only the new store touches `node:fs`, `node:os`, and `node:path`.

### 2. Secrets are encrypted at rest; public material is not

Each secret key is sealed in a self-describing, versioned envelope. A passphrase is stretched with argon2id to derive a symmetric key, which encrypts the secret bytes under an authenticated cipher. Watch-only entries ([ADR 012](012-kms-dual-signing-urn-identifiers.md)), which hold only a public key, are stored in clear because they contain nothing secret. The envelope records its own scheme, key-derivation parameters (salt, memory, iterations, parallelism), cipher, and nonce, so the format can evolve without guesswork at read time.

### 3. argon2id for key derivation, XChaCha20-Poly1305 for encryption

The key-derivation function is argon2id, taken from @noble/hashes, which is already a key-management dependency, so no new dependency is incurred for it. The authenticated cipher is XChaCha20-Poly1305, from @noble/ciphers, chosen over AES-256-GCM because its 24-byte random nonce removes the nonce-reuse fragility of GCM's 12-byte nonce for a store that is rewritten many times, and because it does not rely on AES hardware acceleration. @noble/ciphers is already resolved in the dependency tree and is policy-compliant; it becomes a direct dependency of the Node-only keystore layer only. AES-256-GCM is recorded as an acceptable alternative behind the same versioned envelope, selectable later without a format break.

### 4. The keystore is one file under the data directory, separate from config

Keys live at `$XDG_DATA_HOME/btcr2/keystore.json` (falling back to the platform data directory), not under the configuration directory. Secret key material is data a user accumulates, not portable settings; conflating it with configuration invites copying a config file and leaking keys with it. Configuration references the keystore by path and never embeds key material ([ADR 048](048-cli-config-profile-model.md)).

### 5. Filesystem hardening and atomic writes

The keystore file is created mode 0600 and its directory 0700. Writes are atomic: serialize to a temporary file in the same directory, flush it, then rename over the target, so a crash mid-write cannot truncate or corrupt the store. If the tool cannot establish secure permissions it fails closed rather than write a world-readable secret. These POSIX permission guarantees do not hold on Windows, where an explicit access-control story or a documented caveat is required.

### 6. Passphrase handling never exposes the secret on the command line

The passphrase is read from a non-echoing terminal prompt by default. For unattended use it may come from a dedicated environment variable or a `--passphrase-file`, but never as the value of a command-line flag, which would leak into process listings and shell history. Exporting a secret requires explicit opt-in, an on-screen warning, and re-entry of the passphrase; the default export path emits public material only, consistent with the export-capability gate ([ADR 034](034-key-manager-capability-pattern.md)).

### 7. The active-key pointer is persisted, and a read accessor is added

The currently-active key identifier is recorded in the keystore file. Today the active-key pointer is instance state on the key manager and is lost between processes; persisting it lets "the key I am working with" survive across invocations. A read accessor, returning an entry's public key and tags with the secret omitted, is added to the key-management surface so the tool can list and show keys and their tags without ever decrypting or exposing a secret.

### 8. Key references resolve flexibly, defaulting to the active key

A command that needs a key accepts a reference that resolves, in order, to: the exact URN identifier, a unique fingerprint prefix, or a human name carried in a tag. When no reference is given, the active key is used. This keeps the URN identifiers authoritative while letting a person work with memorable names.

## Consequences

- **Durable, encrypted custody.** Keys survive across invocations and are unreadable at rest without the passphrase.
- **The write path is unblocked.** `update` and `deactivate`, unimplemented today only for lack of a signing key, can now load a key from the keystore and sign. This is a larger payoff than the keypair-management commands themselves.
- **The browser core is unchanged.** All filesystem and encryption-at-rest code is Node-only; the bundled key-management core keeps no dependency on `node:fs` ([ADR 019](019-browser-compat-and-noble.md)).
- **One new direct dependency.** @noble/ciphers enters the Node-only keystore layer. It is policy-compliant and already present transitively, so the footprint cost is minimal; argon2id needs no new dependency.
- **The envelope is a long-lived compatibility commitment.** The first format must be complete and self-describing (its own key-derivation and cipher parameters) so later changes are additive.
- **Secret-handling discipline becomes tool-wide.** Secrets reach standard output only on explicit request, diagnostics go to standard error, passphrases are never echoed, and typed errors never carry secret material.

## Rejected alternatives

- **Plaintext keystore with a warning.** Simplest, and acceptable only for throwaway development keys, but a poor default: a single stray file copy leaks every key. Encryption at rest is the default; an explicit unencrypted development mode may be offered later but is not the baseline.
- **Operating-system keychain (macOS Keychain, Windows Credential Manager, libsecret).** Strong on each platform but platform-specific, hard to test portably, and unavailable in headless contexts. Recorded as a future pluggable backend behind the same `KeyValueStore` seam, not the first implementation.
- **One file per key in a directory.** Avoids rewriting the whole store per change and eases per-key permissions, but complicates atomic multi-entry operations and active-pointer bookkeeping. The single versioned file is simpler at the expected scale; a directory layout stays a possible later backend.
- **BIP-39 mnemonic-derived keys as the storage primitive.** Attractive for backup and hierarchical derivation, but derivation belongs to a wallet layer above key management, not to the keystore. Deferred; the entry tags reserve room for a derivation path when that layer arrives. @scure/bip32 and @scure/bip39 are already in the dependency tree, so this is later integration work, not a new dependency.
- **Putting the file store in the key-management core.** Would break the browser-compatibility constraint ([ADR 019](019-browser-compat-and-noble.md)) by pulling `node:fs` into the bundled core. The store must live in a Node-only layer.

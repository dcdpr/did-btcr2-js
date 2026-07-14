---
title: "ADR 081: A Session Unlock Agent for the Encrypted Keystore"
---

# ADR 081: A Session Unlock Agent for the Encrypted Keystore

**Status:** Accepted

**Date:** 2026-07-14

**Branch / PR:** `feat/cli-keystore-unlock-agent`

**References:** [ADR 052](052-cli-keystore-file-locking.md), [ADR 077](077-cli-rpc-secret-handling.md), [ADR 079](079-cli-state-directory-consolidation.md), [ADR 080](080-keystore-lifecycle-and-dev-keystores.md)

## Context

The encrypted keystore (ADR 080) seals each secret in its own argon2id + XChaCha20-Poly1305 envelope under one shared passphrase, acquired lazily by `getPassphrase` (`config.ts`) whenever a secret is sealed or opened. Every `btcr2` invocation is a fresh process, so nothing carries a decrypted secret (or the passphrase) from one command to the next: a returning operator is prompted again on the very next `key generate`, `update`, or `deactivate`. ADR 080 deliberately deferred the convenience of not re-prompting to its own decision, which is this one.

The workshop happy path is `init` then a run of key and DID commands. Retyping the passphrase between each, or exporting `BTCR2_KEYSTORE_PASSPHRASE` (which leaks it into shell history and every child process for the whole shell lifetime), is exactly the friction that pushed four test keys onto the accidental-first-seal path in the first place. A returning operator wants to authenticate once and then run a short series of commands unattended, the way `ssh-agent` lets one `ssh-add` cover a working session.

Two facts constrain the mechanism:

1. **There is no single "unlock key" to cache.** Each secret carries its own random argon2id salt, so opening any secret requires the passphrase to re-derive *that secret's* key (or the already-decrypted bytes). A cached argon2id output opens exactly one envelope, not the store. And sealing a *new* key (the most common workshop operation) needs the passphrase string to run argon2id over a fresh salt. The only thing that covers both open and seal across a fresh process is the passphrase itself.
2. **The audience is cross-OS and types commands literally.** An `eval $(btcr2 keystore unlock)` handshake (secret in the shell environment, ciphertext on disk) is the strongest on-disk-adjacent design, but it is not portable to Windows PowerShell and it silently does nothing if an attendee forgets the `eval`. The next `btcr2` process must therefore pick up the unlocked session on its own, by reading a file, with no shell integration.

## Decision

Add a **session unlock agent**: `keystore unlock` caches the verified passphrase in a single file under the home directory, and subsequent commands consume it in place of a prompt until it expires or is revoked. This is an explicit **v1, on-disk** design; a future in-memory/socket agent (v2) is the real fix for the residual it carries, and is out of scope here.

### What is cached, and where

A session file at `<home>/session.json` (colocated with `config.json` and `keystore.json` per ADR 079), mode `0600`, written atomically (temp sibling + rename). It holds:

- `v`: session-file format version (`1`).
- `keystore`: the absolute, normalized path of the keystore this session unlocks. The session is honored only for a command resolving to that exact keystore.
- `verifierId`: `base64urlnopad(sha256(JSON.stringify(keystore.verifier)))`. A rotation sentinel compared by equality, never decrypted. `change-passphrase` and `keystore init --force` rotate the verifier, so a stale session stops matching automatically (belt to the explicit `clearSession` those commands also run).
- `passphrase`: `base64urlnopad(utf8(passphrase))`. **base64url is an encoding, not encryption.** The passphrase's only protection at rest is the `0600` file mode. This is the design's honest cost, stated plainly below.
- `allowMainnet`: whether the operator unlocked with `--allow-mainnet`. A session without it is withheld from a `bitcoin` operation at consumption (below), so mainnet keeps per-use authentication even while the session is live.
- `createdAt`, `expiresAt` (`createdAt + ttl`), `ttlSeconds` (display only).

The file **never** holds a derived key, any keystore ciphertext, or any signing-key bytes. The passphrase is structurally absent from every command result, from stdout/stderr, and from verbose logs.

We cache the passphrase rather than a random session key wrapping the secrets. With per-secret salts, a random wrap key would have to sit in the same `0600` file as the ciphertext it opens, so it protects nothing a passphrase cache does not against a reader of that file, while forcing edits into the audited `FileKeyStore` secret path and leaving new-key sealing still prompting. Caching the passphrase changes only the `getPassphrase` seam and leaves the audited store untouched. Its one genuine disadvantage, that the reusable human passphrase (not just this keystore's keys) is what leaks if the file is read, is precisely what the deferred in-memory v2 removes.

### How a session is consumed

`acquirePassphrase` gains an optional `beforePrompt` source, consulted **after** the environment variable and `--passphrase-file` and **before** the "no TTY" failure, so a non-interactive follow-on command (piped output, a task runner) consumes a live session instead of hard-failing. `buildKeystoreKms` wires `beforePrompt` to read the session, but **only when it is not establishing** a passphrase: establishment always prompts twice, fresh, so ADR 080's confirmed-first-passphrase guarantee is untouched. The precedence is therefore: `BTCR2_KEYSTORE_PASSPHRASE`, then `--passphrase-file`, then a live session, then an interactive prompt. Unattended and CI paths keep winning over the cache and are never weakened by it.

A cached passphrase is still checked by the store's existing verifier on every use (`#assertPassphrase`), so a forged or stale cache can never seal a key under a divergent passphrase; the ADR 080 key-loss class stays closed by construction.

### The commands

- **`keystore unlock`**: resolve the keystore strictly; refuse an absent keystore (run `init`), a dev keystore (no passphrase to cache), or an encrypted-but-unestablished keystore (no verifier yet). Acquire the passphrase once (env / file / prompt, **no** session consultation and **no** confirm), verify it against the keystore verifier, and only then write the session. A wrong passphrase writes **no** file. `--ttl <dur>` sets the lifetime (bare seconds or an `s`/`m`/`h` suffix), defaulting to **1 hour** and hard-capped at **24 hours**; `BTCR2_KEYSTORE_TTL` supplies a default below the flag. The printed result carries the keystore path and expiry, never the passphrase.
- **`keystore lock`**: delete the session file (and sweep any crash-orphaned `.session.json.*.tmp` sibling, which would hold a plaintext passphrase). Idempotent, needs no passphrase, works for any protection mode, and resolves the session path from the **home only** so it revokes even under a malformed config.
- **`keystore status`**: additionally reports whether a live session exists and its remaining lifetime. It never decrypts, never prompts, never throws, and never emits the passphrase; an expired, foreign-keystore, or stale session reports inactive.

### Mainnet is gated at unlock and enforced at consumption

An unlocked encrypted keystore signs prompt-free for the whole TTL, which silently removes per-use passphrase authentication, including for a `bitcoin` DID (ADR 080's dev-keystore refusal does not cover an *encrypted* mainnet key). Keys are not network-tagged, and the network a command signs under is derived per-operation (from the DID for `update`/`deactivate`, from `--network`/config for `create`), not from the configured default. So the gate is keyed to `--allow-mainnet` in **two** places:

- **At unlock (early signal):** `keystore unlock` **refuses when the *configured* default network resolves to `bitcoin`** unless `--allow-mainnet` is passed, mirroring ADR 080's hard-refuse posture, so an operator whose default is mainnet is stopped before any passphrase is cached.
- **At consumption (authoritative):** the session records `allowMainnet`, and a `bitcoin` operation is **withheld from a session that lacks it**, falling through to a per-use passphrase prompt rather than signing prompt-free. This is what actually protects a mainnet key, because the configured default network is unrelated to the network a given command signs under: unlocking on a testnet default (or dodging the early gate with `--profile`) still cannot silently sign a `bitcoin` DID. The withheld session is left in place, since it remains valid for the non-mainnet operations it was unlocked for.

The workshop is on mutinynet, so the gate costs attendees nothing; a keystore genuinely reused for mainnet is the honest edge the explicit flag exists for. Testnet, signet, mutinynet, and regtest unlock and sign without a flag.

### Hardening the on-disk read

Because the file holds a plaintext passphrase, the read path is defensive and **never throws** (a bad session degrades to a prompt, never a crash):

- On POSIX, open with `O_RDONLY | O_NOFOLLOW` (a symlink is refused here, by `ELOOP`, with nothing to delete since it was never opened), then `fstat` the returned descriptor and refuse a non-regular file, a file not owned by the caller, or one accessible by group or other, reading only from that same descriptor (no TOCTOU re-open). A file rejected by these `fstat` checks (not the symlink case) is best-effort deleted, since it may hold a plaintext passphrase.
- On Windows, these POSIX checks are skipped (they would throw on `O_NOFOLLOW`/`getuid`), and the file is read normally, relying on the same `LocalAppData` ACL the keystore already trusts. The skip is explicit so the session is *used*, not silently ignored on every command.
- A session is refused if its `v` is unknown, its shape is wrong (including a missing/non-boolean `allowMainnet`), its `createdAt` is in the future (a copied file or a backward clock jump), its `expiresAt` has passed, its `verifierId` no longer matches the keystore, or its `keystore` path differs from the one the command resolved. On the consume path (`readLiveSessionPassphrase`), an expired, future-dated, verifier-rotated, or malformed file is pruned; a *foreign* session (live, but for a different keystore) is deliberately left in place, and `keystore status` never prunes.

## Consequences

- A returning operator authenticates once and then runs a series of key and DID commands prompt-free until the session expires or `keystore lock` revokes it, without exporting the passphrase into shell history. The workshop's `unlock` line is a single portable command on every OS.
- The change is confined to the `getPassphrase` seam, a new `keystore/session.ts` module, two no-decrypt keystore helpers, and the command layer. The audited `FileKeyStore` secret path is unchanged, and the verifier remains the sole authority that a passphrase (cached or typed) is correct, so ADR 080's guarantees hold verbatim.
- **The residual, stated honestly:** the human passphrase sits base64url-encoded in a `0600` file for the TTL, protected only by file permissions. Any same-uid process (another terminal, a malicious `postinstall` in the dependency tree) can read it during the window; `lock`/expiry unlink but do not securely erase, so freed blocks, backups, or a sync client may retain it. The TTL is a convenience bound on reuse by a cooperating reader, not a control against a thief who has the file (the passphrase feeds straight into argon2id). This is a deliberate v1 trade for portability and a minimal diff; the in-memory v2 agent, which never persists the secret, is the fix and is referenced as future work.
- Tests: `unlock` writes the exact `0600` schema with no passphrase in any output; a follow-on command opens a sealed key prompt-free within the TTL, including a non-TTY follow-on that would otherwise hard-fail; the passphrase round-trips the cache verbatim (trailing newline and multibyte characters preserved); an expired, future-dated, or verifier-rotated session is refused and pruned while a foreign-keystore session is refused but left in place; `change-passphrase` invalidates the session and `btcr2 init` clears one when it establishes a keystore (but not when the keystore already exists); `unlock` refuses dev/absent/unestablished keystores and a wrong passphrase writes no file; the mainnet gate refuses a `bitcoin` *default* at unlock without `--allow-mainnet`, records the allowance in the session, and at consumption withholds a non-allowing session from a `bitcoin` operation while still serving other networks; `lock` is idempotent, needs no passphrase, and works under a malformed config; POSIX symlink/loose-perm sessions are refused (and the Windows path is not silently disabled); `--ttl` parsing, the 24h cap, env/file precedence over a session, and a malformed (missing `allowMainnet`) session all hold.

## Rejected alternatives

- **Cache a random session key wrapping the secrets, not the passphrase.** It never writes the human passphrase, but a v1 on-disk design has to store that wrap key in the same `0600` file as the ciphertext it opens, so it gives a file thief the same keys while adding edits to the audited `FileKeyStore.get` path, failing to cover new-key sealing, and creating an empty-keystore footgun (unlock caches zero keys, the next `key generate` still prompts). The only property it buys over caching the passphrase, not exposing the reusable human secret, is exactly the in-memory v2 agent's job.
- **An `ssh-agent`-style `eval $(btcr2 keystore unlock)` handshake** (token in the shell environment, ciphertext on disk). This is genuinely stronger, but it is not portable to Windows PowerShell and silently no-ops if an attendee omits the `eval`, both disqualifying for a cross-OS follow-along. The portable equivalent is the deferred in-memory agent reachable over a socket, not an environment handshake.
- **Encrypt the cached passphrase under a machine-bound key.** Without an OS keychain there is no key not derivable from files the same user can read, so it is obfuscation, not protection, and it invites a false sense of security. Storing the passphrase plainly at `0600` and documenting the exposure is more honest.
- **Skip the mainnet gate (treat unlock as purely keystore-level).** Keys are not network-tagged, so this is defensible, but it silently suspends per-use authentication for a mainnet key for the whole TTL. Refusing `bitcoin` unless `--allow-mainnet` mirrors the ADR 080 posture at no cost to the testnet workshop.
- **Ship the in-memory agent now instead of the on-disk cache.** A background process holding decrypted material behind a socket is the right end state, but it is materially more machinery (lifecycle, socket auth, cross-platform daemonization) than the workshop needs. The on-disk cache is the minimal step that removes the re-prompt friction; v2 supersedes it without changing the command surface.

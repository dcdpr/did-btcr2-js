---
title: "ADR 080: Keystore Lifecycle, a Confirmed First Passphrase, and Opt-In Dev Keystores"
---

# ADR 080: Keystore Lifecycle, a Confirmed First Passphrase, and Opt-In Dev Keystores

**Status:** Accepted

**Date:** 2026-07-08

**Branch / PR:** `feat/cli-home-keystore-lifecycle`

**References:** [ADR 052](052-cli-keystore-file-locking.md), [ADR 077](077-cli-rpc-secret-handling.md), [ADR 079](079-cli-state-directory-consolidation.md)

## Context

The encrypted keystore protects each secret key with an independent argon2id + XChaCha20-Poly1305 envelope (`keystore/envelope.ts`), all opened by one shared passphrase acquired lazily through `getPassphrase` (`config.ts`). Three problems in that lifecycle surfaced while preparing a live CRUD workshop, and one of them silently destroyed keys.

1. **The first passphrase is never confirmed, so a typo permanently seals the keystore.** `buildKeystoreKms` wired `getPassphrase: () => acquirePassphrase({ passphraseFile })` with no `confirm: true`. `acquirePassphrase` *has* a confirm mode (prompt twice, require a match), but nothing turned it on. The first `key generate` on a fresh keystore therefore sealed the new key under whatever the operator typed once, with no second entry to catch a slip. If they mistyped, the keystore was now sealed with a passphrase nobody knows, and the key was unrecoverable. This is not hypothetical: it is how four throwaway test keys were lost.

2. **A returning-user typo is just as destructive, and confirm alone does not fix it.** Even with confirm on the first key, the second `key generate` prompts once and seals key 2 under whatever was typed. Because each key carries its own envelope and there was no check that the passphrase matched the one the *other* keys use, a typo on key 2 sealed it under a divergent passphrase. Later, key 1 opens fine and key 2 fails to decrypt, with no explanation. There was nothing in the file that a candidate passphrase could be checked against before it is used to seal or open a secret.

3. **There is no keystore lifecycle surface and no way to run without a passphrase for throwaway keys.** There was no command group to establish, inspect, or re-key the keystore: no `init`, no `status`, no `change-passphrase`. And every key operation was gated on a passphrase even when the keys are disposable testnet material - which for the workshop means every attendee fights the passphrase prompt (or leaks it via `BTCR2_KEYSTORE_PASSPHRASE` in shell history) before they can create their first DID. The mainnet default must stay encryption-at-rest; the demo needs a sanctioned, loud, testnet-only escape hatch.

## Decision

### A passphrase verifier makes establishment confirmed and every later use checked

Add a self-describing protection header to the keystore file (the format stays `v: 1`; the new fields are the keystore's own description of how its secrets are stored):

- `protection`: `'passphrase'` (encrypted, the default) or `'none'` (dev, plaintext). **Every keystore this CLI writes carries it.**
- `verifier`: a `SecretEnvelope` sealing a fixed sentinel plaintext under the keystore passphrase, written when the passphrase is established. **Every encrypted keystore that holds keys carries one.**

The store's passphrase handling is binary:

1. **Establishing a fresh encrypted keystore** (no `verifier` yet): acquire the passphrase in **confirm** mode (prompt twice, require a match) and write the `verifier` in the same locked, atomic flush as the first key. This is the first-seal confirm fix, and it applies whether establishment happens through an explicit `keystore init` or implicitly through the first `key generate`.
2. **Using an established encrypted keystore** (a `verifier` is present): acquire the passphrase once, then **decrypt the verifier first**. A wrong passphrase fails there, loudly (`Incorrect passphrase`), *before* any key is sealed or opened - so a returning-user typo can no longer seal a key under a divergent passphrase or silently fail later.

There is deliberately **no third "sealed keys but no verifier" state**. A keystore always self-describes, and the loader refuses a file that lacks a recognized `protection` header, that carries sealed keys without a verifier, or whose per-entry secret form (a sealed envelope vs. a plaintext `plainSecret`) disagrees with its protection mode. Such a file was not written by this CLI: there is no pre-header keystore format to accommodate and no released consumer to be backward-compatible with, so refusing it is correct. This removes an entire class of "which passphrase is this key under" ambiguity, including the concurrent-establish / concurrent-rotate race that ambiguity created: because a sealed-but-unverified keystore cannot exist on disk, `set()` only ever either *establishes* (mint and record the verifier, no writer having beaten it) or *verifies* against the existing one, so a key can never be persisted under a passphrase that diverges from the keystore verifier.

`getPassphrase` gains an optional `{ confirm }` argument so the store, which alone knows whether it is establishing or reusing, controls when the second prompt happens. `confirm` is a no-op for the non-interactive sources (`BTCR2_KEYSTORE_PASSPHRASE`, `--passphrase-file`), which have nothing to prompt twice.

### A `keystore` command group owns the lifecycle

- **`keystore init`**: establish the keystore explicitly. Encrypted by default (prompt-and-confirm, write the verifier, create an empty key set). `--dev` establishes an unencrypted dev keystore instead (see below). Refuses to touch an existing keystore unless `--force`.
- **`keystore status`**: report the resolved path, protection mode (`encrypted` / `dev` / `absent`), whether a passphrase is established, the key count, and the active key id. It reads only public structure - it never decrypts, never prompts, and never throws (a missing or unrecognized file reports `absent`).
- **`keystore change-passphrase`**: verify the current passphrase against the verifier, acquire a new one in confirm mode, re-seal every secret and the verifier under the new passphrase, and flush atomically under the existing write lock. Encrypted keystores only; a dev keystore has no passphrase to change.

### Opt-in, loudly-marked dev keystores, hard-refused on mainnet

A dev keystore (`protection: 'none'`) stores each secret as plaintext bytes (`plainSecret`, base64url) instead of an envelope. It never prompts for a passphrase, on read or write. Its file is still created `0600` and still fails closed on loose permissions, and `keystore init --dev` and `keystore status` both print a prominent warning that keys are stored unencrypted.

Because plaintext keys are only acceptable for disposable testnet material, the CLI **hard-refuses to use a dev keystore for mainnet**: any `update` or `deactivate` whose DID network is `bitcoin`, and any `create` that would generate and seal a new key into a dev keystore on `bitcoin`, throws before signing or sealing. The refusal is a hard error, not a warning - a plaintext mainnet key is a foot-gun with no legitimate use here. The check reads the keystore's `protection` field without decrypting, so it costs nothing and never prompts. Testnet, signet, mutinynet, and regtest are unaffected.

### `btcr2 init` is the one-command happy-path entry point

Add a top-level `btcr2 init` that creates the home directory (ADR 079), writes a default config if none exists (the same scaffold as `config init`), and establishes the keystore if none exists: encrypted with a confirmed passphrase by default, or `--dev` for an unencrypted testnet keystore. It is idempotent - existing files are left untouched - and prints the home path and the next step. This makes the workshop's first line a single `btcr2 init`, after which `key generate` never hits the accidental-first-seal path because the passphrase was already established, with confirmation, up front.

Crucially, `btcr2 init` never destroys secret keys. Its `--force` re-scaffolds the (regenerable) config, but it does **not** overwrite an existing keystore: re-establishing a keystore, which discards its keys, is only ever the explicit `keystore init --force`, and even that warns on standard error when it would discard keys. Coupling a routine "reset my config" gesture to unrecoverable key loss is exactly the footgun this lifecycle work exists to remove.

## Consequences

- The key-loss bug is closed at its root: the first passphrase is confirmed, and once a keystore is established, every later passphrase is checked against the verifier before it can seal or open anything. A typo becomes a loud, non-destructive `Incorrect passphrase` instead of an unrecoverable key.
- A keystore self-describes and is validated on load: every file carries a protection header, an encrypted keystore that holds keys carries a verifier, and a file that fails either invariant (or mixes sealed and plaintext secrets) is refused rather than opened on a guess. `keystore status` answers "encrypted, dev, or none; passphrase set; how many keys" without a prompt, and `change-passphrase` makes rotation a supported operation rather than a hand-edit.
- The concurrent-write reconciliation is simpler and provably safe: because a sealed-but-unverified state cannot exist on disk, `set()` either establishes a verifier or verifies against the existing one, and a key can never be persisted under a passphrase that diverges from the keystore verifier (including under a race with a concurrent `change-passphrase`, which aborts rather than corrupting).
- The workshop gets a frictionless, sanctioned path (`btcr2 init --dev` on mutinynet) without weakening the mainnet posture: encryption-at-rest stays the default, and mainnet flatly refuses a dev keystore.
- The on-disk format stays `v: 1`. The `protection`, `verifier`, and `plainSecret` fields are the keystore's self-description. There is deliberately no compatibility path for a header-less or verifier-less keystore: none was ever released, and accepting one would reintroduce the passphrase ambiguity this ADR removes.
- Tests: a mistyped confirmation on establishment aborts without writing a key; a wrong passphrase against an established keystore throws before sealing a second key; a dev keystore round-trips a key with no passphrase; mainnet `update` / `deactivate` / generating `create` refuse a dev keystore while testnet allows it; `keystore status` reports each mode without prompting; `change-passphrase` re-seals every key and the verifier and rejects a wrong current passphrase; a file with no recognized protection header, an encrypted keystore missing its verifier, and a plaintext secret inside an encrypted keystore are each refused on load; `btcr2 init` is idempotent and seeds home + config + keystore.

## Rejected alternatives

- **Only add `confirm: true` to the first seal (the minimal fix).** This catches a first-key typo but leaves problem 2 fully open: a returning-user typo still seals a key under a divergent passphrase with no check and a silent later failure. The verifier is a few lines more and closes the whole class, and it is also what makes `status` and `change-passphrase` able to reason about the passphrase at all. The minimal fix would have to be redone the moment those commands were added.
- **Derive one shared key once and encrypt all secrets under it (drop per-key envelopes).** This is a larger re-architecture of a security-sensitive format for no additional safety here; the verifier gives the "is this the right passphrase" check without disturbing the per-key envelope model, which keeps each secret independently sealed and lets the argon2id cost be raised per key over time.
- **Warn instead of refuse for a dev keystore on mainnet.** A warning is ignorable and normalizes plaintext mainnet keys. There is no legitimate reason to sign a mainnet did:btcr2 update with an unencrypted key from this tool, so the safe default is a hard error with a clear message pointing at an encrypted keystore.
- **Support pre-header "legacy" keystores instead of refusing them.** An earlier draft loaded a header-less or verifier-less keystore as encrypted and let it gain a verifier opportunistically the next time the passphrase was used. That keeps a keystore whose passphrase cannot be checked before use - the exact hole this ADR closes - and it created a concurrent-write race in which a key could still be sealed under a divergent passphrase. Since no released CLI ever wrote such a file, the compatibility it bought was imaginary; refusing an unrecognized file is both simpler and strictly safer.
- **Make `keystore unlock` / session caching part of this ADR.** Session unlock (a TTL-cached derived key so a returning user is not re-prompted every invocation) is real convenience, but it is a distinct mechanism with its own on-disk-vs-in-memory trade-offs. It is deferred to its own ADR so this one stays focused on correctness (confirmed, verified passphrases) and the dev-keystore escape hatch.

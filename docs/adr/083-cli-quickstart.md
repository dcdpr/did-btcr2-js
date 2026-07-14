---
title: "ADR 083: A btcr2 quickstart Command that Composes Onboarding into One Step"
---

# ADR 083: A `btcr2 quickstart` Command that Composes Onboarding into One Step

**Status:** Accepted

**Date:** 2026-07-14

**Branch / PR:** `feat/cli-mutinynet-quickstart`

**References:** [ADR 079](079-cli-state-directory-consolidation.md), [ADR 080](080-keystore-lifecycle-and-dev-keystores.md), [ADR 081](081-cli-keystore-session-unlock.md), [ADR 082](082-network-presets.md)

## Context

Getting from nothing to "ready to create a DID on a testnet" is a 3-4 command sequence the workshop (DEMO.md Part 0) spells out by hand:

```
btcr2 init
btcr2 config set defaults.network mutinynet
btcr2 keystore unlock --ttl 2h        # Path A only
btcr2 config doctor -n mutinynet
```

Each command already exists and is settled: `init` scaffolds the home, config, and keystore (ADR 079/080); `keystore unlock` caches the passphrase for the session (ADR 081); `config doctor` probes endpoint reachability; `config set defaults.network` records the network so later commands can drop `-n`. The friction is not any single command but the sequence: four lines the presenter reads out, one of which (`config set defaults.network`) is pure ceremony that both demo paths repeat, and a network name (`mutinynet`) typed three times.

Comparable CLIs converge on a convention: name the scaffold `init` and give the zero-to-running composite its own verb. Folding network selection into the scaffold and printing next-step hints (including funding/explorer links) is standard.

## Decision

Add a top-level **`btcr2 quickstart`** that **composes** the existing primitives into one step, and fold `-n/--network` into `init` as a cheap complement that removes the separate `config set defaults.network` line from both demo paths. `quickstart` reimplements nothing: it calls the factored bodies of `init`, `keystore unlock`, and `config doctor`.

### Naming

`quickstart`, not `init --demo` and not `bootstrap`. `init` stays the plain scaffold. `bootstrap` is **reserved** for a future zero-to-DID superset that also mints a key and creates a DID; keeping `quickstart` short of that preserves the DEMO Part 0 (setup) / Part 1 (own your keys) boundary. `quickstart` mints no key and creates no DID.

### What quickstart does

```
btcr2 quickstart [-n|--network <net>] [--dev] [--unlock] [--ttl <dur>] [--no-doctor] [--allow-mainnet] [--force]
```

1. **Scaffold** via the factored `runInit()` (init's own body): create the home, a default config if none exists, and establish the keystore if none exists (encrypted by default, `--dev` for an unencrypted testnet keystore). Idempotent exactly as `init`: existing files are left intact, and `--force` re-scaffolds the regenerable config but **never** overwrites the keystore.
2. **Record the network.** Default network is **mutinynet** (zero local infra, 30s blocks, a free faucet: the demo target). The `defaults.network` write is idempotent and keyed on the **raw** config value: it writes when `-n` is explicit **or** the raw `defaults.network` is unset, so a defaulted re-run never clobbers a network the operator set earlier. (It must read `file?.defaults?.network` directly, not `resolveDefaultNetwork`, which never returns undefined and would make the write never fire.)
3. **Optionally cache the session** (`--unlock`, opt-in, default OFF): see below.
4. **Optionally probe** (`config doctor`, on by default, advisory): see below.
5. **Print** the result envelope plus text-mode next-step hints, including the ADR 082 faucet/explorer preset lines.

### Session caching is opt-in (`--unlock`)

ADR 081 deliberately separates *establishing* a passphrase from *caching* it: `init` establishes and then `clearSession`s, so a fresh scaffold never leaves a cached passphrase behind. `quickstart` preserves that boundary. Without `--unlock`, `runInit`'s `clearSession` stands and no session is written. With `--unlock`, the merged "set and cache" behavior is the operator's explicit request, documented as a posture consequence (one command both sets the passphrase and caches it, `0600` on disk, for the TTL).

Under `--unlock`:

- **Fresh encrypted keystore:** capture the establish-time confirmed passphrase (via the `initKeystore` `getPassphrase` closure), verify it against the new verifier, and write the session with **no second prompt**. This is the one place `quickstart` reuses the passphrase it already collected; it adds no at-rest exposure beyond the `0600` base64url session file ADR 081 already defines.
- **Existing encrypted keystore:** first check `readSessionStatus`; if a live matching session already exists, **skip** (idempotent re-run), else acquire the passphrase (env / file / prompt), verify, and write.
- **`--dev`:** skip unlock entirely (a dev keystore has no passphrase to cache).

`--ttl` reuses the exported `resolveSessionTtl` (default 1h, max 24h, `$BTCR2_KEYSTORE_TTL`) and is ignored under `--dev`.

### Doctor is on by default and advisory

`quickstart` runs `runDoctor` by default and treats it as **advisory**: a failed probe prints a warning but `quickstart` still exits `0`. This is a deliberate divergence from standalone `config doctor` (which exits `1` on a failed probe): a setup command should not "fail" because a public endpoint was briefly slow, and the operator can re-run `config doctor` for an authoritative check. `--no-doctor` skips the probe.

### Mainnet is guarded before any writes

The mainnet posture from ADR 080/081 is preserved and checked **before** any file is written: `-n bitcoin` requires `--allow-mainnet` (`MAINNET_QUICKSTART_REFUSED_ERROR`), and `-n bitcoin --dev` is refused unconditionally (a dev keystore never operates on mainnet). Because `quickstart`'s default network is a testnet, the guard never fires on the demo path. The factored `unlockSession()` takes `{ network, allowMainnet }` **explicitly** rather than re-deriving from config, so ADR 081's mainnet early-refusal is order-independent even though `quickstart` may have just written `defaults.network`.

### `init` gains `-n/--network`

`btcr2 init` gains `-n/--network` with the same write-if-explicit-or-unset rule, and its `{action:'init'}` data envelope gains a `network: NetworkOption` field so `init -n <net> -o json` is machine-verifiable. This removes the `config set defaults.network` line from the non-quickstart path too.

### Output shape

New `CommandResult` variant:

```ts
{ action: 'quickstart'; data: {
  home: string; config: string; keystore: string; network: NetworkOption;
  created: string[]; protection: 'encrypted' | 'dev' | 'absent';
  unlocked: boolean; session?: { expiresAt: number; ttlSeconds: number };
  doctor?: DoctorReport;
} }
```

Text mode prints the data plus stderr next-step hints (gated on `!g.quiet && g.output !== 'json'`): `btcr2 home ready at <home> on <network>.`; if unlocked, the session expiry; if dev, the plaintext/mainnet-refused warning; `Next: btcr2 key generate --name demo --set-active`; plus the ADR 082 `Faucet:`/`Explorer:` lines when the network has them.

**Non-TTY.** `--dev` is fully non-interactive. An encrypted keystore with an env/file passphrase source establishes (and, under `--unlock`, caches) with no prompt. An encrypted keystore with no passphrase source and no TTY is fatal on a **fresh** keystore (establishment throws), but on an **existing** encrypted keystore the `--unlock` step is a non-fatal **skip** (warn, `unlocked: false`, exit 0).

### Refactors (behavior-preserving)

- Extract `runInit()` from `init.ts`; the `init` command action becomes a thin wrapper.
- Extract `unlockSession()` from the `keystore unlock` action; both it and `quickstart` call it.
- Export `resolveSessionTtl` (currently private in `keystore.ts`).

Existing `init` and `keystore` tests stay green.

## Consequences

**Positive.** The demo's Part 0 collapses to one command (`btcr2 quickstart -n mutinynet [--unlock --ttl 2h] [--dev]`), the network is named once, and the tool prints the funding/explorer links the operator previously hand-copied. The `init -n` addition also shortens the non-quickstart path. Nothing is reimplemented, so the existing keystore/session guarantees (ADR 080/081) hold by construction: `quickstart` is exactly the four commands, run in order, with one prompt saved on the happy path.

**Costs / breaking surface.** The CLI printed-output shape is a declared breaking surface that rides a MINOR at `0.x`; this adds a `quickstart` variant and a `network` field to the `init` variant, so `cli` takes a MINOR. `quickstart`'s advisory doctor exit code diverges from `config doctor`'s; this is intentional and documented.

**Deferred.** `bootstrap` (the zero-to-DID superset) is named but not built. `method` and `bitcoin` do not change: no new symbols are added there.

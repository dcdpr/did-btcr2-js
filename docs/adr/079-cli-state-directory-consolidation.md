---
title: "ADR 079: Consolidate CLI State Under a Single ~/.btcr2 Home Directory"
---

# ADR 079: Consolidate CLI State Under a Single ~/.btcr2 Home Directory

**Status:** Accepted

**Date:** 2026-07-08

**Branch / PR:** `feat/cli-home-keystore-lifecycle`

**References:** [ADR 074](074-cli-config-resolution-correctness.md), [ADR 078](078-wire-dead-config-surface.md), [ADR 080](080-keystore-lifecycle-and-dev-keystores.md)

## Context

The CLI keeps two pieces of on-disk state in two different directories. The config file follows the XDG *config* directory (`$XDG_CONFIG_HOME/btcr2/config.json`, falling back to `~/.config/btcr2/config.json`), and the keystore follows the XDG *data* directory (`$XDG_DATA_HOME/btcr2/keystore.json`, falling back to `~/.local/share/btcr2/keystore.json`). `defaultConfigPath` and `defaultKeystorePath` encode the two roots independently, and neither is influenced by any single "where does btcr2 keep its things" knob.

The split is XDG-correct, and defensible on a workstation the operator already understands. It is exactly wrong for the situation this change targets: a live, follow-along workshop where a room of mixed-OS attendees must find, inspect, back up, and reset their CLI state without getting stuck. "Your config is in one hidden directory and your keys are in a different hidden directory, and which directory depends on two environment variables that may or may not be set" is a support burden per attendee. Every other identity-bearing CLI an attendee is likely to have seen keeps its state in one discoverable, tool-named home: `~/.ssh`, `~/.aws`, `~/.gnupg`, `~/.config/gh`. There is one place to look, one directory to `chmod`, one directory to delete to start over.

There is also a subtler cost. Because the two roots are derived independently, `--config` and `--keystore` are the only way to relocate state as a unit, and there is no single override that says "put all btcr2 state here" - useful for throwaway per-demo homes, CI sandboxes, and `BTCR2_HOME=$(mktemp -d)`-style isolation in tests and scripts.

## Decision

1. **Introduce a single home root and colocate both files under it.** The config file and the keystore live side by side in one directory: `<home>/config.json` and `<home>/keystore.json`. The home root resolves in this order (highest wins):
   1. `--home <dir>` global flag
   2. `$BTCR2_HOME` environment variable
   3. the **platform default**: `~/.btcr2` on Linux and macOS (the short, teachable dot-directory in the family of `~/.ssh`, `~/.aws`, `~/.gnupg`); `%LOCALAPPDATA%\btcr2` on Windows (its native per-user application-state location, with `%APPDATA%\btcr2` then the user profile as fallbacks).

   A blank value at any layer defers to the next (the same `blankToUndef` treatment ADR 074 applies to every other layer), so an exported-but-empty `BTCR2_HOME` does not resolve the home to a bare filename. The default is platform-aware rather than a uniform `~/.btcr2` so Windows state lands in its native `AppData\Local` tree instead of a profile-root dot-directory, while Unix keeps the short path. Colocation (both files in one dir) is the invariant; the exact base is per-OS, and `btcr2 config path` prints the resolved home so operators never have to memorize it.

2. **Keep the per-file flags as unit-independent overrides.** `--config <file>` and `--keystore <file>` continue to point at a specific file and win over the home-derived default for that file only. An operator who wants the historical XDG split runs with explicit paths (or points `BTCR2_HOME` at a chosen directory), and a profile's `identity.keystore` (ADR 078) still relocates the keystore per profile. The precedence for each file is: its own flag, then (for the keystore) the active profile's `identity.keystore`, then `<home>/<file>`.

3. **Drop the XDG default outright; do not consult `XDG_CONFIG_HOME` / `XDG_DATA_HOME` for the default anymore.** The old defaults read those variables (and the `~/.config` / `~/.local/share` fallbacks) directly; the new default is the platform home regardless of the XDG environment. This is a clean cutover, not a migration: there is no released consumer of the CLI whose state must be carried forward, so there is deliberately **no legacy-location detection and no `config migrate` command**. A predictable single default that does not depend on ambient environment is the point; a Linux operator who genuinely wants their state under `$XDG_DATA_HOME` sets `BTCR2_HOME` to it.

4. **Add a `--home <dir>` global flag and a `home?` field to the override/globals types**, and thread the resolved overrides into every `defaultConfigPath` / `defaultKeystorePath` call site so `--home` and `BTCR2_HOME` are actually honored (a default-path helper that ignores the flag would advertise a knob that does nothing, the ADR 078 failure mode). Home, config-path, and keystore-path resolution live in one `src/paths.ts` module so config and keystore can never disagree about the root.

5. **`btcr2 config path` reports the home root** alongside the resolved config and keystore paths, so `path` answers "where is everything" in one call.

This is a CLI-only change and ships as a **cli minor** bump. It is breaking for anyone who relied on the old XDG default locations; because there is no released consumer to carry forward, the remedy for a pre-existing install is simply to re-run `btcr2 init` (ADR 080) against the new home, or to point `--config` / `--keystore` / `BTCR2_HOME` at the old paths. The bump is a minor per the project's 0.x "minor carries breaking" cadence.

## Consequences

- A fresh install keeps all state in one discoverable, tool-named directory. "Where are my keys / my config / how do I start over" each have a one-directory answer, and `BTCR2_HOME=$(mktemp -d)` isolates a whole btcr2 environment for a demo, a test, or CI in one variable.
- `--config` and `--keystore` keep working exactly as before, so any script or profile already pinning explicit paths is unaffected by the default change; the historical XDG split is reproducible by pointing those flags (or `BTCR2_HOME`) at the old locations.
- One new module (`src/paths.ts`) is the single source of truth for state locations; `defaultConfigPath` / `defaultKeystorePath` are re-exported from their current modules for import-surface compatibility but now derive from the shared home resolver.
- The consolidation is a precondition for the keystore lifecycle work in [ADR 080](080-keystore-lifecycle-and-dev-keystores.md) and the `btcr2 init` happy-path entry point: `init` creates one home directory and seeds both files in it.
- Tests: home resolution precedence (`--home` > `BTCR2_HOME` > platform default, with blank-defers-to-next); the platform default is `~/.btcr2` off-Windows and `%LOCALAPPDATA%\btcr2` (falling back to `%APPDATA%\btcr2`) on Windows; config and keystore both land under a `BTCR2_HOME` override; `--config` / `--keystore` still override per file.

## Rejected alternatives

- **Keep the XDG split.** This leaves the two-directory support burden in place for every attendee and every future user, which is the entire problem. The split's correctness does not outweigh the teachability cost for this tool's audience, and operators who genuinely want XDG can reproduce it with `--config` / `--keystore` or `BTCR2_HOME`.
- **Keep auto-consulting `XDG_CONFIG_HOME` / `XDG_DATA_HOME` when set, and only default to the platform home when they are unset.** This looks backward-compatible but defeats the goal for the exact users it claims to help: a Linux workstation with `XDG_CONFIG_HOME` exported would keep the split, so the consolidation would not apply to the people most likely to have it set. A predictable single default that does not depend on ambient environment is the point.
- **Detect the old XDG locations and add a `config migrate` command.** An earlier draft did exactly this: auto-detect legacy state, nudge the operator on standard error, and copy it non-destructively into the new home. It was removed. There is no released CLI whose state needs migrating, so the detection code, the one-time notice, and the `migrate` command were speculative back-compat with no consumer - carrying real cost (extra command surface, TTY/`--quiet`/JSON suppression rules, per-file override subtleties, extra tests) for a scenario that does not exist. A clean cutover plus `btcr2 init` is simpler and has nothing to get subtly wrong.
- **A uniform `~/.btcr2` on every OS, including Windows.** Simplest to teach (one path string for the whole room) and works on Windows as a profile dot-directory, exactly as `~/.ssh` and `~/.aws` do. Rejected only because a native Windows tool should keep per-user state in `AppData\Local`, not a dot-directory in the profile root; the platform-aware default costs a few lines and gives Windows attendees the idiomatic location while leaving the Unix path short. `config path` makes the per-OS location discoverable in one command.

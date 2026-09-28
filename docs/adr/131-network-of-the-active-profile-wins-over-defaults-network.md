# ADR 131: The Network of the Active Profile Wins over defaults.network

- **Status:** Accepted
- **Date:** 2026-09-29
- **Packages:** `@did-btcr2/cli` (MINOR, breaking: default network, with ADRs 129 and 130)

## Context

A command with no identifier gets its network from `resolveDefaultNetwork`. These commands are `create`, `genesis build`, `config effective`, `config doctor`, and `keystore unlock`. The order was: `-n`, then `defaults.network`, then the network of the active profile, then `regtest`. ADR 074 (decision 7) added the `network` key of a profile, and a warning in `create` for a mismatch. It did not change the order.

The active profile also gives the endpoints, the keystore, and the default key. The old order caused two problems:

1. `btcr2 --profile production create` with `defaults.network: "mutinynet"` made a mutinynet identifier. The profile `production` holds the mainnet endpoints, so the command printed a warning. The explicit `--profile` flag lost to a value in the config file.
2. `resolve`, `update`, and `deactivate` read the network from the identifier. But they use the endpoints of the active profile, also if the profile declares another network. A mutinynet identifier under `defaults.profile: "production"` went to the mainnet endpoints with no warning.

The test networks share the `tb1` address prefix. So an Esplora server of one test network can accept the beacon address of another test network. It then finds no transaction, and the resolution shows no update, with no error.

## Decision

**The network of the active profile wins over `defaults.network`.** The order for a command with no identifier:

| Layer | Source |
|-------|--------|
| Flag | `-n, --network` |
| Active profile | The `network` key of the profile that `--profile` or `defaults.profile` names. Else the profile name, if it is a network name. |
| Config default | `defaults.network` |
| Built-in | `regtest` |

- This is the order of the other values: the flag, then the environment, then the profile, then `defaults.*`, then the built-in default. The network has no environment variable.
- `defaults.network` applies if no profile is active, or if the active profile has no network. The config file of `init -n` and `quickstart` has no `defaults.profile`, so these setups do not change.
- `init` and `quickstart` do not change. They read and write the raw `defaults.network` (ADR 083).
- The help text of `-n` on `create` and `genesis build` names the new order.

**`resolve`, `update`, and `deactivate` print a warning if the network of the identifier is not the network of the active profile.**

- The text: `Warning: the identifier network is "<network>", but the active profile "<name>" declares network "<declared>". The endpoints of the profile can be for another network.`
- `create` and `genesis build` print the same text. It replaces the old text of `create` (`Warning: creating a "<network>" identifier while ...`).
- The warning goes to stderr, also in JSON mode. `-q/--quiet` suppresses it. It never blocks.
- `update` and `deactivate` print it after the flag checks. A refused command prints only the error.
- No warning comes from a profile that declares no network. A profile with the name of the identifier network declares that network, so it also gives no warning.
- A malformed config file skips the warning. The connection resolution then fails with the config error.

## Alternatives

- **Keep the old order and document it.** The docs said "`defaults.network` wins". That did not solve problem 1: an explicit `--profile` lost to a value in the config file.
- **Use the profile with the name of the identifier network if the active profile declares another network.** This avoids the wrong endpoints. But it ignores an explicit `--profile` in silence, and the keystore and the default key of the active profile still apply. A warning shows the conflict, and the user selects the profile.
- **Refuse the command on a mismatch.** A profile can set only CAS values or a timeout. Then the Bitcoin endpoints come from the defaults of the identifier network, and they are correct. A refusal blocks a valid setup.
- **A `config validate` issue if `defaults.network` and the network of `defaults.profile` differ.** `defaults.network` still applies under a `--profile` with no network, so the value has an effect. The warnings cover the operations.

## Consequences

**Positive.** An explicit `--profile` sets the network of a new identifier. A new identifier and the endpoints of its profile have one network, unless `-n` names another. A read or a write through the endpoints of another network always prints a warning.

**Negative.** A config file with `defaults.profile` and a different `defaults.network` now makes identifiers on the network of the profile. This is a breaking change of the cli (MINOR at 0.x, with ADRs 129 and 130). `keystore unlock` now uses the network of the active profile for its mainnet gate. The text of the `create` warning changes.

**Tests.** The cli tests cover:

- the profile network over `defaults.network`, from `defaults.profile` and from `--profile`,
- `defaults.network` for an active profile with no network,
- `create` under a profile network, with no warning,
- the warning of `create -n`,
- the warning of `resolve`, and its suppression by `-q`,
- the warning of `update`, no warning of `deactivate` under `-q`, and no warning before a refused `update`.

# ADR 129: defaults.cas, One CAS Endpoint for All Networks

- **Status:** Accepted
- **Date:** 2026-09-28
- **Packages:** `@did-btcr2/cli` (MINOR, with ADR 130)

## Context

The config file of the CLI held the CAS values only in a profile `cas` block. A user with one IPFS node for all networks had to repeat the URL, the user, and the password in each profile. The environment variable `BTCR2_CAS_GATEWAY` gave one gateway for all networks, but it had two limits:

1. It is not in the config file, so `config list` does not show it.
2. The environment layer wins over the profile layer, so a profile cannot set another gateway.

The CLI also merged the CAS gateway and the CAS RPC URL as two separate values. The api uses the RPC URL if one is set (`rpcUrl` wins over `gateway`). So an RPC URL from a lower layer won over a gateway from a higher layer. For example, `--cas-gateway` had no effect if the profile set `cas.rpcUrl`. A shared layer below the profile makes this problem larger: a profile `cas.gateway` would have no effect under a shared RPC URL.

CAS data does not belong to one network. A content identifier addresses the same bytes on each network.

## Decision

**The config file has a `defaults.cas` block.**

- `defaults.cas` takes the keys of a profile `cas` block: `gateway`, `rpcUrl`, `rpcUser`, `rpcPass`, and `timeoutMs`.
- It applies to each profile, and to a network with no profile.
- It is the lowest config layer of each CAS value:

| Layer | Example |
|-------|---------|
| Flag | `--cas-rpc-url`, `--cas-gateway`, `--cas-rpc-user`, `--cas-timeout` |
| Environment | `BTCR2_CAS_RPC_URL`, `BTCR2_CAS_GATEWAY`, `BTCR2_CAS_RPC_USER`, `BTCR2_CAS_RPC_PASS`, `BTCR2_CAS_TIMEOUT` |
| Profile | `profiles.<name>.cas.*` |
| Config defaults | `defaults.cas.*` |
| Built-in | the gateway `https://trustless-gateway.link`, the timeout 30000 ms |

- `defaults.cas.rpcPass` accepts a secret reference (`env:<VAR>` or `file:<path>`), as a profile `cas.rpcPass` does (ADR 077).
- `config set` stores the four string keys as strings. `config validate` knows the five keys and reports an unknown key under `defaults.cas`.
- `config effective` reports a value from `defaults.cas` with the provenance `file`, as a value from the profile.

**The CAS endpoint is one unit.** The highest layer that sets `gateway` or `rpcUrl` gives the gateway, the RPC URL, the RPC user, and the RPC password. A lower layer adds no endpoint value. In that layer, the RPC URL wins over the gateway, as in the api.

- A profile `cas.gateway` wins over a `defaults.cas.rpcUrl`.
- A flag or an environment gateway wins over a profile or a `defaults.cas` RPC URL.
- A URL never gets the credentials of another layer. This keeps the rule of ADR 128. ADR 128 took the unit from the highest layer with a URL. This ADR takes it from the highest layer with a URL or a gateway.
- A layer with credentials and no endpoint sets no endpoint. The CAS has no default RPC host.
- `BTCR2_CAS_RPC_PASS_FILE` stays the password fallback below all layers.
- `timeoutMs` is not part of the unit. Each layer can set it alone. For example, a profile can keep the node of `defaults.cas` and set a longer timeout.

**There is no `defaults.btc`.** A Bitcoin endpoint serves the chain of one network. The same Esplora or Bitcoin Core URL for two networks is a configuration error.

## Alternatives

- **A separate precedence for each CAS value.** This was the first design. Then a profile `cas.gateway` has no effect under a `defaults.cas.rpcUrl`, and the CLI gives no warning. The unit rule removes this trap.
- **A block fallback: `defaults.cas` applies only to a profile with no `cas` block.** Then a profile that sets only `cas.timeoutMs` loses the shared node. The unit rule gives the same endpoint result, and it keeps the timeout separate.
- **A provenance `defaults` in `config effective`.** It shows the exact block. But `defaults` and `default` (the built-in value) differ by one letter, and the change adds a value to the provenance enum. Both blocks are in one file, so `file` names the place to look.
- **Only the environment variable.** This was the state before this ADR. See the two limits in the context.
- **A `defaults.btc` block.** Refused: see the decision.

## Consequences

**Positive.** One IPFS node serves each network from one entry in the config file. A profile can replace the endpoint of `defaults.cas` with its own gateway or RPC URL, and the replacement always has an effect. `config effective` and `config doctor` show the resolved endpoint.

**Negative.** A flag or an environment gateway now wins over an RPC URL of a lower layer. Before this ADR, the RPC URL won. So `BTCR2_CAS_GATEWAY` together with a profile `cas.rpcUrl` now reads through the gateway, and `--publish-to-cas always` fails. Use `defaults.cas.gateway` for a shared gateway instead. The provenance `file` does not tell the profile from `defaults.cas`.

**Tests.** The cli tests cover `defaults.cas` on each network, the gateway and the timeout of `defaults.cas`, a profile URL without the credentials of `defaults.cas`, a profile value for each key, a blank profile value, the environment and the flag over `defaults.cas`, a profile gateway over a `defaults.cas` URL, a flag gateway over a profile URL, the gateway and the URL of one layer, incomplete credentials in `defaults.cas`, no change to a Bitcoin value, `config set` and `config validate` of the keys, and `config effective` with redaction.

# ADR 128: HTTP Basic Credentials for the IPFS RPC Endpoint

- **Status:** Accepted
- **Date:** 2026-09-28
- **Packages:** `@did-btcr2/api` (PATCH, additive), `@did-btcr2/cli` (PATCH, additive)

## Context

`IpfsRpcCasExecutor` reads and writes CAS data through the IPFS HTTP RPC API (`block/get` and `block/put`). It sent no credentials.

The RPC API of a Kubo node also has administration calls, for example `config`, `shutdown`, `pin/rm`, and `repo/gc`. So a node on a public network puts the RPC API behind a reverse proxy that requires authentication, usually HTTP Basic auth. The CLI could not use such a node:

1. `--cas-rpc-url https://<node>` failed with HTTP 401 for `block/put`.
2. Reads failed too. The RPC endpoint wins over the gateway, so each read used `block/get`, and a failed read returned no content.
3. A URL with credentials (`https://user:pass@<node>`) also failed. `fetch` refuses it: `Request cannot be constructed from a URL that includes credentials`.

Only a local node with no authentication worked. The test-vector script `packages/api/lib/publish-scenarios.ts` wrote to an authenticated node with its own request code.

## Decision

**The api sends HTTP Basic credentials to the IPFS RPC endpoint.**

- `IpfsRpcCasExecutor` takes an optional second argument `{ auth?: { username, password } }` (types `IpfsRpcCasExecutorOptions` and `IpfsRpcAuth`).
- With `auth`, the executor sends `Authorization: Basic <base64(username:password)>` with `block/get`, `block/put`, and the probe.
- `CasConfig.rpcAuth` gives the credentials to the executor that `CasApi` makes from `rpcUrl`. The gateway and the blockstore do not use them.
- The encoder is `toBase64` of `@did-btcr2/bitcoin`, the encoder of the Bitcoin Core RPC credentials.

**The CLI takes the credentials with the rules of the Bitcoin Core RPC credentials.**

| Layer | User | Password |
|-------|------|----------|
| Flag | `--cas-rpc-user <user>` | none |
| Environment | `BTCR2_CAS_RPC_USER` | `BTCR2_CAS_RPC_PASS` |
| Profile | `cas.rpcUser` | `cas.rpcPass` |
| Fallback below all layers | none | the file that `BTCR2_CAS_RPC_PASS_FILE` names |

- The URL, the user, and the password come from one layer (the rule of ADR 074). A URL from one layer never gets the credentials of another layer.
- A password can be a secret reference: `env:<VAR>` or `file:<path>` (ADR 077).
- There is no password flag. A password on argv is visible through `ps` and `/proc/<pid>/cmdline`, and it stays in the shell history.
- If the resolved credentials have a user and no password, or a password and no user, the command fails with `INVALID_ARGUMENT_ERROR`: `The CAS RPC credentials need a user and a password. Only the user is set for <url>.`
- If no layer gives a CAS RPC URL, the CLI does not use the credentials. The CAS has no default RPC host.
- `config effective` shows `cas.rpcUser` and `cas.rpcPass` with their layers. It redacts the password unless `--show-secrets` is set. `config doctor` sends the credentials with its CAS probe.

## Alternatives

- **A header map `cas.rpcHeaders`, as `btc.rpcHeaders`.** It also supports a bearer token. But a header value does not accept a secret reference, so the config file would hold the password in base64. A header map can come later for another authentication scheme.
- **Credentials in the URL.** `fetch` refuses the URL. `--cas-rpc-url` would also put the password on argv.
- **A separate precedence for each value.** Then a URL from a flag gets the password of the profile, and the CLI sends the password to a host that the profile does not name. ADR 074 refused this for the Bitcoin Core RPC.
- **No error for incomplete credentials, as for the Bitcoin Core RPC.** The request then fails with HTTP 401. `CasApi.retrieve` returns `null` for a failed read, so `resolve` reports missing content, not the configuration error.

## Consequences

**Positive.** The CLI publishes to, and reads from, an IPFS node that requires HTTP Basic auth. The CAS credentials follow the rules and the names of the Bitcoin Core RPC credentials, so one explanation covers both.

**Negative.** The CLI has six new names: one flag, three environment variables, and two profile keys. Incomplete credentials stop each command that resolves a connection for the network, also a `resolve` that reads no CAS data.

**Tests.** The api tests cover the header on `block/get`, `block/put`, and the probe, no header without credentials, and `CasConfig.rpcAuth`. The cli tests cover the environment variables, the profile keys, an `env:` reference, the environment layer, a flag URL without the profile credentials, a flag URL and user with `BTCR2_CAS_RPC_PASS_FILE`, a user without a password, a password without a user, credentials without a URL, the header of a request through `defaultApiFactory`, `config effective` with redaction, `config set` of the two keys, and the header of the `config doctor` probe.

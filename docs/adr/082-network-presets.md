---
title: "ADR 082: Per-Network Presets for Human-Facing Faucet and Explorer Links"
---

# ADR 082: Per-Network Presets for Human-Facing Faucet and Explorer Links

**Status:** Accepted

**Date:** 2026-07-14

**Branch / PR:** `feat/cli-mutinynet-quickstart`

**References:** [ADR 053](053-bitcoin-defaults-in-sdk.md), [ADR 073](073-cas-publication-is-opt-in.md), [ADR 075](075-cli-config-validation-and-introspection.md), [ADR 078](078-wire-dead-config-surface.md), [ADR 081](081-cli-keystore-session-unlock.md), [ADR 083](083-cli-quickstart.md)

## Context

A network name already resolves to concrete Bitcoin endpoints. `DEFAULT_BITCOIN_NETWORK_CONFIG` (`packages/api/src/bitcoin.ts`) maps each of the six supported networks to `{ rpc, rest.host }`; mutinynet is `{ rpc: undefined, rest: { host: 'https://mutinynet.com/api' } }`. The CLI layers flags/env/profile on top in `resolveConnectionConfig` (`packages/cli/src/config.ts`). That machinery is settled and is **not** in scope here: this ADR does not touch endpoint resolution, address encoding (`getNetwork`), the CAS opt-in policy (ADR 073), or re-add mutinynet as a network.

The gap is the *human-facing* metadata a demo needs but the tool never emits. Two URLs a testnet operator uses on every run exist as concrete data, but only in a non-runtime dev helper and in prose:

- `explorerUrl()` and `faucetHint()` in `packages/api/lib/_e2e-helpers.ts` (underscore-prefixed, under `lib/`, not exported from `packages/api/src`) already encode, per network, the mutinynet faucet (`https://faucet.mutinynet.com/`), the explorer base (`https://mutinynet.com`, used as `/tx/<txid>` and `/address/<addr>`), and a block-time hint. A grep confirms zero references to `faucet`/`explorer` anywhere in `api/src`, `cli/src`, or `bitcoin/src`.
- `packages/cli/DEMO.md` hardcodes the same faucet and explorer tx/address links as prose, because the CLI cannot print them.

So `create` prints only the DID; `update`/`deactivate` return `.data.txid` but no link. The workshop instructs the human to hand-copy URLs the tool already knows internally, and to extract the beacon address with a hand-written `jq` filter. The explorer base is genuinely *not* derivable from the REST host (`mutinynet.com` vs `mutinynet.com/api`; `mempool.space/signet` vs `mempool.space/signet/api`), so stripping `/api` is not a reliable shortcut: the explorer base must be its own datum.

## Decision

Add a **per-network preset**: a small, exported, per-network map of ancillary human-facing metadata that sits *beside* the endpoint config, plus pure URL-builder helpers and a handful of text-mode CLI hints that consume it. Presets carry links and hints, never connection behavior.

### Where presets live: the `api` package, as a sibling map

Presets live in `@did-btcr2/api` (new `packages/api/src/presets.ts`, re-exported from the api index) as a **new** exported constant `NETWORK_PRESETS` keyed by `NetworkName`. This mirrors ADR 053's rationale for placing `DEFAULT_BITCOIN_NETWORK_CONFIG` and `DEFAULT_CAS_GATEWAY` in the api facade rather than the sans-I/O transport: concrete third-party service data is a convenience default the facade owns, not something the pure `method`/`bitcoin` layers should carry. Keeping it in api gives `lib/_e2e-helpers.ts` a real exported source to consume, so its private per-network copies collapse to one table shared by the CLI and the e2e scripts.

Presets are a **separate** constant, not new keys on `DEFAULT_BITCOIN_NETWORK_CONFIG`. That object is `as const` and consumed by `resolveConnectionOptions`, which spreads `defaults.rest`/`defaults.rpc` into transport config; adding faucet/explorer keys there would leak presentation data into the transport and muddy its single responsibility. A sibling map keeps each concern independent while sharing the `NetworkName` key.

### Data shape (minimal)

```ts
export interface NetworkPreset {
  /** Faucet page URL for funding testnet beacon addresses. Absent for regtest/mainnet. */
  faucetUrl?       : string;
  /** Block-explorer base. The CLI appends `/tx/<txid>` and `/address/<addr>`. Absent for regtest. */
  explorerBaseUrl? : string;
  /** Human hint for confirmation cadence, e.g. '~30 seconds' (mutinynet). */
  blockTimeHint?   : string;
}

export const NETWORK_PRESETS: Record<NetworkName, NetworkPreset>;

// Pure helpers (undefined when the network has no explorer/faucet):
export function explorerTxUrl(network: NetworkName, txid: string): string | undefined;
export function explorerAddressUrl(network: NetworkName, address: string): string | undefined;
export function faucetUrl(network: NetworkName): string | undefined;
```

Values, lifted from `_e2e-helpers.ts`: mutinynet `{ faucetUrl: 'https://faucet.mutinynet.com/', explorerBaseUrl: 'https://mutinynet.com', blockTimeHint: '~30 seconds' }`; signet, testnet3, testnet4 use their mempool.space explorer bases and existing faucet URLs; regtest `{}` (no public faucet/explorer); bitcoin `{ explorerBaseUrl: 'https://mempool.space' }` with **no** faucet. The testnet `(or another X faucet)` prose is dropped so a preset holds a clean, clickable URL.

### What is deliberately cut

The first design carried more surface; the adversarial review trimmed it to what the demo actually uses.

- **No per-network CAS gateway.** mutinynet has no dedicated CAS gateway, CAS is opt-in (ADR 073), and the single global `DEFAULT_CAS_GATEWAY` already owns this. A reserved-but-unset field is dead surface (ADR 078); adding an optional field later is non-breaking, so reserving it now buys nothing.
- **No `profiles.<name>.explorer`/`faucet` override.** There is no current demand, it would require editing `config-schema.ts`, the `config set` validation, and the `ConfigFile` type, and a scalar profile field is network-blind (a `bitcoin` profile's explorer would leak onto a mutinynet tx link). Deferred; it is additive later. The values are network-scoped constants, not per-invocation endpoints, so there are also **no** new CLI flags or env vars (a flag surface would be the dead weight ADR 078 warns against).
- **No `config effective` preset section and no `config doctor` probe.** Adding a `preset` block to `EffectiveConfig` changes the `config effective` JSON shape for a question the demo never asks. Faucet/explorer are human web pages, not health-checkable API endpoints; probing them would add noise and false negatives.

### Which commands consume presets

Preset-derived links are **stderr hints in text mode**, suppressed under `--quiet` and `--output json`, following the existing convention (`create.ts` already prints a stderr provenance note only when `g.output !== 'json'`; ADR 081 keeps hints off machine output). Machine (JSON) output is unchanged, so no JSON consumer breaks and the api `DidUpdateResult` type is not polluted with presentation data.

- **`create` (KEY / `-t k`), only when `faucetUrl(network)` is defined** (i.e. testnets; nothing new prints on regtest/mainnet/external, which also keeps mainnet from ever showing a fund-me affordance): derive the initial P2WPKH beacon address offline via `BeaconUtils.createBeaconService(did, 'p2wpkh', 'SingletonBeacon')` (DID-string only; it decodes the DID and calls `getNetwork` internally, so the printed address is the same `#initialP2WPKH` service the resolver produces, not a divergent re-derivation), then print a stderr block: the beacon address, `Faucet: <faucetUrl>`, `Explorer: <explorerAddressUrl(network, beaconAddr)>`. All three KEY input modes have the pubkey (generated, stored, or raw `--bytes`); EXTERNAL (`-t x`) has none and prints no beacon hint.
- **`update` / `deactivate`:** print `Watch: <explorerTxUrl(deriveNetwork(did), data.txid)>` on stderr when `explorerBaseUrl` is defined. No SDK/api change.

The choice of `BeaconUtils.createBeaconService` (over `generateBeaconServices`) is deliberate: the latter takes a `BTCNetwork` object built by `getNetwork` from `@did-btcr2/bitcoin`, which is not a CLI dependency; the former takes only the DID string.

### Dedupe

Once `NETWORK_PRESETS` exists, `explorerUrl()`/`faucetHint()`/`blockTimeHint()` in `_e2e-helpers.ts` read from it, so the faucet/explorer/block-time data has exactly one home shared by the CLI, the e2e scripts, and (via display) the DEMO.

## Consequences

**Positive.** The demo's manual URL construction collapses to printed output: after `create`, the operator sees the fundable beacon address next to its faucet and explorer links; after `update`, a watch link for the txid. The faucet/explorer table has a single source of truth. Machine output is untouched, so scripts and CI are unaffected. The design reuses the existing hint-gating machinery rather than inventing new plumbing.

**Costs / breaking surface.** The CLI's printed text output is a breaking surface per the release convention, so the new stderr hints ride a cli MINOR bump (see ADR 083, which lands with this). `create` now surfaces a beacon address it did not before (new stderr line in text mode). The new api exports are purely additive, so `@did-btcr2/api` takes a MINOR. Third-party testnet faucet URLs can rot; preset values are best-effort human hints, not health-checked, and a stale one is a cosmetic wrong link, never a functional failure.

**Deferred.** Per-network CAS gateway, profile faucet/explorer overrides, a `config effective` preset section, `resolve` funding-hint output, and a first-class `--beacon` selector to replace the DEMO `jq`. Presets feed ADR 083's `quickstart`, whose next-step block prints the same faucet/explorer hints.

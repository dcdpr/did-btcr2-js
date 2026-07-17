# did:btcr2 test-network wallet

A persistent dev-tool wallet for funding beacons during test vector generation.
Code lives under `packages/method/lib/wallet/`; the actual key file lives
**outside the repo** in the user config directory:

- Linux/macOS: `$XDG_CONFIG_HOME/did-btcr2-js/wallet/wallet.json`
  (default: `~/.config/did-btcr2-js/wallet/wallet.json`)
- Windows: `%APPDATA%/did-btcr2-js/wallet/wallet.json`

Storing keys outside the repo means `git clean`, branch switches, or a fresh
`git clone` cannot accidentally wipe your wallet. The legacy in-repo path
(`packages/method/lib/wallet/.wallet/wallet.json`) is auto-migrated on first
load if present.

**Scope:** test networks only (regtest, mutinynet, signet, testnet4). No
encryption at rest. Not for mainnet use.

## One-time setup

```bash
pnpm wallet init                              # default network: mutinynet
pnpm wallet init --network signet             # or pick a different default
```

`init` generates a single funding keypair and prints its derived addresses on
all four supported networks. Fund the **P2WPKH** address (cheapest source).
For mutinynet: https://faucet.mutinynet.com/ (100k sats per request).

**BACK UP `wallet.json` AFTER `init`.** Losing the file loses every tracked sat.

## Registering beacon keys

```bash
pnpm wallet add beacon-02-k1-update --scenario 02-k1-sidecar-update-didcomm
pnpm wallet add custom-key --secret <64-hex>          # import an existing secret
pnpm wallet add beacon-foo --notes "for ad-hoc poking"
```

Generates (or imports) a SchnorrKeyPair, derives addresses on every supported
network, and saves the entry to `wallet.json`. Labels are arbitrary strings;
keep them descriptive so `wallet list` is useful.

## Day-to-day

```bash
pnpm wallet list                              # all registered keys + addresses
pnpm wallet list --network signet             # show signet addresses

pnpm wallet status                            # live balances on the default network
pnpm wallet status --network mutinynet        # query a specific network

pnpm wallet fund <label>                      # default: 10000 sats to P2WPKH
pnpm wallet fund <label> --amount 50000 --addr-type p2tr
pnpm wallet fund <label> --network signet --amount 5000
pnpm wallet fund tb1q...                      # raw address: pay any address directly
                                              # (--addr-type is ignored; the address pins its own type)

pnpm wallet recover <label>                   # sweep beacon -> funding
pnpm wallet recover <label> --addr-type p2tr  # sweep a specific address type

pnpm wallet send funding tb1q... --amount 5000   # generic transfer: any wallet key to
pnpm wallet send beacon-foo funding --all        #   any label or raw address; --all sweeps
pnpm wallet send /tmp/secret.hex funding --all   # one-off source from a 64-hex secret file
                                                 #   (used once, never saved to wallet.json)
```

`fund` and `recover` are sugar over `send`: `fund X` = `send funding X --amount N`,
`recover X` = `send X funding --all`. The source of a `send` must be a key the wallet
can sign with (`funding`, a label, or a secret file); the destination can also be a
raw address. `--from-type`/`--to-type` pick the address derivation on each end
(default P2WPKH; `--to-type` applies to labels only, a raw address pins its own type).

## Fee strategy

Two-pass: probe sign at minimum fee (200 sats absolute floor) to measure vsize,
recompute at the target rate (default **1 sat/vB**, override with `--fee-rate`),
rebuild with correct change. Same algorithm the Beacon base class uses.

## Storage shape

```jsonc
{
  "version": 1,
  "network": "mutinynet",
  "funding": {
    "label": "funding",
    "secretHex": "<32-byte hex>",
    "pubkeyHex": "<33-byte compressed hex>",
    "addresses": {
      "regtest":   { "p2pkh": "...", "p2wpkh": "...", "p2tr": "..." },
      "mutinynet": { ... },
      "signet":    { ... },
      "testnet4":  { ... }
    },
    "scenarioId": null,
    "createdAt": "2026-..."
  },
  "beacons": [
    { "label": "beacon-02-k1-update", "scenarioId": "02-k1-...", ... }
  ]
}
```

## When things go wrong

- **"No wallet found"** -> run `pnpm wallet init`
- **"Source address has no UTXOs"** -> faucet hasn't confirmed yet, or you funded a different address type than `--addr-type` (default P2WPKH)
- **"Insufficient funds"** -> request more from the faucet, or check `pnpm wallet status` to see what's actually available
- **Broadcast failure** -> the rejection reason from the Esplora HTTP response will surface in the error; common causes are unconfirmed UTXO chains, dust outputs, or signature scheme mismatches

## Caveats

- No concurrent-write protection on `wallet.json`. Don't run two `add` commands at once.
- All addresses are derived from a single key per entry; rotation requires a new `add`.
- Mutinynet/signet/testnet4 share the `tb` HRP: addresses look identical structurally but operate on different chains. Pass `--network` to keep them straight.

# Test Vector Generator

An incremental CLI tool for generating did:btcr2 test vectors through a stepped workflow: `create` → `update` (offline) → `fund` → `announce` → `resolve`. It produces JSON files under `lib/data/`.

The first positional argument is the action. `create` runs offline. All subsequent actions only need `--hash` — the type and network are derived from the DID itself.

## Quick Start

```bash
# From packages/method/

# 1. Create a new DID (only action that takes --type and --network)
pnpm generate:vector create
pnpm generate:vector create --type external --network mutinynet

# 2. Construct and sign an update offline (use the hash printed by step 1)
pnpm generate:vector update --hash <hash> --offline

# 3. Fund the beacon address(es)
source .env
pnpm generate:vector fund --hash <hash>

# 4. Announce the signed update on-chain
pnpm generate:vector announce --hash <hash>

# 5. Resolve the DID against a live Bitcoin node
pnpm generate:vector resolve --hash <hash>

# List existing vectors
pnpm generate:vector list
pnpm generate:vector list --network regtest --type key
```

## CLI Reference

```
pnpm generate:vector <action> [options]
```

### Actions

| Action | Description |
|--------|-------------|
| `create` | Create a new DID and initial test vector files |
| `update` | Construct and sign an update (optionally announce) |
| `fund` | Fund beacon address(es) via RPC `sendtoaddress` + mine a block |
| `announce` | Announce a previously signed update on-chain |
| `resolve` | Resolve a DID against a live Bitcoin node |
| `list` | Show existing test vectors |

### Options

| Flag | Values | Default | Applies to | Description |
|------|--------|---------|------------|-------------|
| `--type` | `key`, `external` | `key` | `create`, `list` | DID identifier type |
| `--network` | `regtest`, `bitcoin`, `mutinynet`, etc. | `regtest` | `create`, `list` | Bitcoin network |
| `--genesis` | hex string | prompt / auto-generate | `create` | Genesis bytes hex (see below) |
| `--hash` | 8-char short hash | — | `update`, `fund`, `announce`, `resolve` | Vector identifier (required) |
| `--interactive` | flag (no value) | off | `update` | Enable interactive patch builder |
| `--amount` | BTC amount | `0.001` | `fund` | BTC amount to send to each beacon address |
| `--offline` | flag (no value) | off | `update`, `resolve` | Skip on-chain announcement or live resolution |

> After `create`, the hash uniquely identifies the vector. The script finds the directory automatically and derives the type and network from the stored DID.

## Actions

### `create`

Creates a DID and writes the initial vector files. The `--genesis` flag behavior depends on the `--type`:

- **k1**: `--genesis` is a compressed public key hex. If omitted, prompts for one. If blank, auto-generates a keypair.
- **x1**: `--genesis` is a SHA-256 hash hex of a genesis document. If omitted, prompts for a JSON genesis document or hex hash. If blank, auto-generates a keypair and default genesis document.

```bash
# Auto-generate everything
pnpm generate:vector create
pnpm generate:vector create --type external --network regtest

# Bring your own genesis bytes
pnpm generate:vector create --type key --genesis 02abc...def
pnpm generate:vector create --type external --network regtest --genesis 82830a78...f83a99
```

**Outputs:**
```
lib/data/{network}/{type}/{hash}/
  create/input.json    # { idType, version, network, genesisBytes }
  create/output.json   # { did }
  other.json           # { genesisKeys: { secret, public }, genesisDocument? }
```

The `--hash` for subsequent steps is printed to the console.

### `update`

Reads back the create output, rebuilds the source document, constructs and signs an update.

**Without `--interactive`:** applies a default patch that rotates the first SingletonBeacon service endpoint (P2PKH key rotation).

**With `--interactive`:** prompts for JSON Patch operations with smart auto-generation (see below).

**With `--offline`:** builds and signs the update but skips the on-chain announcement. This is the typical workflow — use `fund` and `announce` as separate steps afterward.

**Without `--offline`:** also announces the update on-chain immediately (requires a funded beacon address and `BITCOIN_NETWORK_CONFIG`).

```bash
# Recommended: sign offline, then fund and announce separately
pnpm generate:vector update --hash <hash> --offline
pnpm generate:vector update --hash <hash> --offline --interactive

# Or sign and announce in one step (beacon must already be funded)
source .env
pnpm generate:vector update --hash <hash>
```

**Outputs:**
```
lib/data/{network}/{type}/{hash}/
  update/input.json    # { sourceDocument, patches, sourceVersionId, ... }
  update/output.json   # { signedUpdate }
  other.json           # (updated with generated keys)
```

### `fund`

Funds all beacon service addresses in the DID document via RPC `sendtoaddress`, then mines blocks to confirm the funding transaction(s). **Requires a live Bitcoin node with a loaded wallet.**

```bash
source .env
pnpm generate:vector fund --hash <hash>
pnpm generate:vector fund --hash <hash> --amount 0.01
```

> Requires `BITCOIN_NETWORK_CONFIG` to be set with connection info for the DID's network. Source your `.env` file or export it directly.

### `announce`

Announces a previously signed update on-chain via the beacon service. Reads the signed update and beacon metadata from the `update` step's persisted files. Useful for retrying a failed announcement without re-running the full update pipeline.

```bash
source .env
pnpm generate:vector announce --hash <hash>
```

> Requires `BITCOIN_NETWORK_CONFIG` to be set with connection info for the DID's network. Source your `.env` file or export it directly.

### `resolve`

Resolves a DID against a live Bitcoin node. Assembles a sidecar from the signed update (if the update step has been run) and the genesis document (for x1 types).

**With `--offline`:** writes only the sidecar input file without connecting to Bitcoin.

```bash
# Resolve against a live Bitcoin node
source .env
pnpm generate:vector resolve --hash <hash>

# Offline — build sidecar input only
pnpm generate:vector resolve --hash <hash> --offline
```

**Outputs:**
```
lib/data/{network}/{type}/{hash}/
  resolve/input.json   # { did, resolutionOptions: { sidecar } }
  resolve/output.json  # { didDocument, didResolutionMetadata, didDocumentMetadata } (live only)
```

> Live resolution requires `BITCOIN_NETWORK_CONFIG` to be set with connection info for the DID's network. Source your `.env` file or export it directly.

### `list`

Displays existing test vectors filtered by network and type. If `--network` or `--type` are not provided, prompts interactively.

```bash
pnpm generate:vector list
pnpm generate:vector list --network regtest --type key
```

## Interactive Mode

Pass `--interactive` to the `update` step to build custom patches. The tool detects common patch targets and auto-generates values.

```bash
pnpm generate:vector update --hash <hash> --interactive
```

### Service patches (`/service/<n>`)

When `add` or `replace` targets a path like `/service/0`, the tool:

1. Prompts for **address type** (`p2pkh`, `p2wpkh`, `p2tr`) — defaults to `p2pkh`
2. Prompts for **pubkey hex** — leave empty to auto-generate a new keypair
3. Derives the Bitcoin address and builds the complete service object

```
--- Add a JSON Patch operation ---
  op: add
  path: /service/1
  Detected service patch — auto-generating value.
  address type (p2pkh | p2wpkh | p2tr) [p2pkh]: p2wpkh
  pubkey hex (leave empty to auto-generate):
  Auto-generated keypair (stored as "service-service-1")
  Added: {"op":"add","path":"/service/1","value":{"id":"did:btcr2:...#service-1","type":"SingletonBeacon","serviceEndpoint":"bitcoin:bcrt1q..."}}
```

### Verification method patches (`/verificationMethod/<n>`)

When `add` or `replace` targets a path like `/verificationMethod/1`, the tool:

1. Prompts for an **id fragment** (e.g. `someNewId` or `#someNewId`) — defaults to `key-1`, `key-2`, etc.
2. Validates the id is unique against existing verification methods
3. Prompts for **pubkey hex** — leave empty to auto-generate
4. Builds the complete verification method object with `publicKeyMultibase`

```
--- Add a JSON Patch operation ---
  op: add
  path: /verificationMethod/1
  Detected verificationMethod patch — auto-generating value.
  id fragment (e.g. "someNewId" or "#someNewId") [key-1]: recoveryKey
  pubkey hex (leave empty to auto-generate):
  Auto-generated keypair (stored as "verificationMethod-verificationMethod-1")
  Added: {"op":"add","path":"/verificationMethod/1","value":{"id":"did:btcr2:...#recoveryKey","type":"Multikey","controller":"did:btcr2:...","publicKeyMultibase":"zQ3sh..."}}
```

### Other patches

For any path not matching the above patterns, or for operations like `remove`, `move`, `copy`, the tool falls back to manual JSON value input.

## Key Storage

All generated and user-provided keys are persisted in `other.json` for later reuse:

- **Auto-generated keys** include both `secret` and `public` hex values
- **User-provided keys** store the `public` hex with an empty `secret` field for you to fill in if needed

```json
{
    "genesisKeys": { "secret": "...", "public": "..." },
    "newBeaconKeys": { "secret": "...", "public": "..." },
    "generatedKeys": {
        "service-service-1": { "secret": "...", "public": "..." },
        "verificationMethod-verificationMethod-1": { "secret": "", "public": "..." }
    }
}
```

## Output Directory Structure

```
lib/data/{network}/{type}/{hash}/
  create/
    input.json
    output.json
  update/
    input.json
    output.json
  resolve/
    input.json
    output.json    # (live mode only)
  other.json
```

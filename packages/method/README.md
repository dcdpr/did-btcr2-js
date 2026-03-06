# Method

TypeScript implementation of [did:btcr2 DID Method](https://dcdpr.github.io/did-btcr2/).

## Documentation

Visit [btcr2.dev](https://btcr2.dev/impls/ts) to learn more about how to use [@did-btcr2/method](https://www.npmjs.com/package/@did-btcr2/method).

## Test Vector Generator

An incremental CLI tool for generating did:btcr2 test vectors. It produces JSON files that mirror the structure expected by the test suite under `lib/data/`.

The `create` step runs offline. All subsequent steps only need `--hash` — the type and network are derived from the DID itself.

### Quick Start

```bash
# From packages/method/

# 1. Create a new DID (only step that takes --type and --network)
pnpm generate:vector -- --type key --network regtest

# 2. Add update vectors (use the hash printed by step 1)
pnpm generate:vector -- --step update --hash <hash>

# 3. Add resolve vectors (offline — builds sidecar input)
pnpm generate:vector -- --step resolve --hash <hash>

# 4. Announce update to Bitcoin (requires live node)
source .env
pnpm generate:vector -- --step announce --hash <hash>

# 5. Resolve against live Bitcoin node
pnpm generate:vector -- --step resolve-live --hash <hash>
```

### CLI Flags

| Flag | Values | Default | Description |
|------|--------|---------|-------------|
| `--step` | `create`, `update`, `resolve`, `announce`, `resolve-live` | `create` | Which step to run |
| `--type` | `key`, `external` | `key` | DID identifier type — **create only** |
| `--network` | `regtest`, `bitcoin`, `mutinynet`, etc. | `regtest` | Bitcoin network — **create only** |
| `--genesis` | hex string | prompt / auto-generate | Genesis bytes hex — **create only** (see below) |
| `--hash` | 8-char short hash | — | Vector identifier (required for all steps except `create`) |
| `--interactive` | flag (no value) | off | Enable interactive patch builder (used with `update`) |

> After `create`, the hash uniquely identifies the vector. The script finds the directory
> automatically and derives the type and network from the stored DID.

### Steps

#### `create`

Creates a DID and writes the initial vector files. The `--genesis` flag behavior depends on the `--type`:

- **k1**: `--genesis` is a compressed public key hex. If omitted, prompts for one. If blank, auto-generates a keypair.
- **x1**: `--genesis` is a SHA-256 hash hex of a genesis document. If omitted, prompts for a JSON genesis document or hex hash. If blank, auto-generates a keypair and default genesis document.

```bash
# Auto-generate everything
pnpm generate:vector -- --type key --network regtest
pnpm generate:vector -- --type external --network regtest

# Bring your own genesis bytes
pnpm generate:vector -- --type key --network regtest --genesis 02abc...def
pnpm generate:vector -- --type external --network regtest --genesis 82830a78...f83a99
```

**Outputs:**
```
lib/data/{network}/{type}/{hash}/
  create/input.json    # { idType, version, network, genesisBytes }
  create/output.json   # { did }
  other.json           # { genesisKeys: { secret, public }, genesisDocument? }
```

The `--hash` for subsequent steps is printed to the console.

#### `update`

Reads back the create output, rebuilds the source document, constructs and signs an update.

**Without `--interactive`:** applies a default patch that rotates the first SingletonBeacon service endpoint (P2PKH key rotation).

**With `--interactive`:** prompts for JSON Patch operations with smart auto-generation (see below).

```bash
pnpm generate:vector -- --step update --hash <hash>
pnpm generate:vector -- --step update --hash <hash> --interactive
```

**Outputs:**
```
lib/data/{network}/{type}/{hash}/
  update/input.json    # { sourceDocument, patches, sourceVersionId, ... }
  update/output.json   # { signedUpdate }
  other.json           # (updated with generated keys)
```

#### `resolve`

Assembles a sidecar from the signed update (and genesis document for x1 types) and writes the resolve input. Offline — no Bitcoin node needed.

```bash
pnpm generate:vector -- --step resolve --hash <hash>
```

**Outputs:**
```
lib/data/{network}/{type}/{hash}/
  resolve/input.json   # { did, resolutionOptions: { sidecar } }
```

#### `announce`

Broadcasts the signed update to Bitcoin via the beacon service. **Requires a live Bitcoin node.**

```bash
source .env
pnpm generate:vector -- --step announce --hash <hash>
```

Reads `update/input.json` (for the beacon service and signing material) and `update/output.json` (for the signed update), then calls `Update.announce()` to broadcast to Bitcoin.

#### `resolve-live`

Resolves the DID against a live Bitcoin node and writes the resolution result. **Requires a live Bitcoin node.**

```bash
source .env
pnpm generate:vector -- --step resolve-live --hash <hash>
```

Reads `resolve/input.json`, injects the Bitcoin driver, calls `DidBtcr2.resolve()`, and writes the result.

**Outputs:**
```
lib/data/{network}/{type}/{hash}/
  resolve/output.json  # { didDocument, didResolutionMetadata, didDocumentMetadata }
```

> Both `announce` and `resolve-live` require `BITCOIN_NETWORK_CONFIG` to be set with
> connection info for the DID's network. Source your `.env` file or export it directly.
> The script validates the connection before proceeding and exits cleanly if misconfigured.

### Interactive Mode

Pass `--interactive` to the `update` step to build custom patches. The tool detects common patch targets and auto-generates values.

```bash
pnpm generate:vector -- --step update --hash <hash> --interactive
```

#### Service patches (`/service/<n>`)

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

#### Verification method patches (`/verificationMethod/<n>`)

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

#### Other patches

For any path not matching the above patterns, or for operations like `remove`, `move`, `copy`, the tool falls back to manual JSON value input.

### Key Storage

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

### Output Directory Structure

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
  other.json
```
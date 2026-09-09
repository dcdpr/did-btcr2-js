# did:btcr2 CLI walkthrough

This walkthrough shows the `btcr2` command-line tool from the setup to an on-chain update. You set up a local keystore, create an identifier offline, resolve it from Bitcoin, and update it on-chain. It runs on **mutinynet**, a public Bitcoin signet with 30-second blocks and a free faucet. No step costs real money.

**How to use this document:** run the commands from top to bottom in one terminal session. A later command reuses the shell variables of an earlier command, so keep the same session open. Each output block is an example. Your keys, identifiers, and Bitcoin addresses differ, but the shape is the same.

The text matches `@did-btcr2/cli` v0.23.0.

---

## Part 0: Setup

### Prerequisites

Before the first command, make sure that you have:

- **Node.js 22 or newer** (the CLI runtime).
- **`jq`** (Part 4 uses it to read values out of JSON).
- **A POSIX shell**: bash or zsh on Linux or macOS. On Windows, use **WSL** or **Git Bash**. The commands use `alias`, `$(...)`, `2>/dev/null`, and single-quoted JSON. PowerShell and cmd do not process them in the same way.

```bash
node --version && jq --version      # both commands must print a version
```

### Get the CLI

Install the published package:

```bash
npm install -g @did-btcr2/cli
```

Or build it from this monorepo (from the repository root):

```bash
pnpm build
alias btcr2="node $PWD/packages/cli/dist/esm/bin/btcr2.js"
```

**Make sure that it runs:**

```bash
btcr2 --version
```

```
btcr2 0.23.0
```

### Set up in one command

`btcr2 quickstart` does the setup in one step. It creates the home directory, writes a default config file, creates the keystore, records the network (mutinynet by default), and probes the endpoints. Select one of two paths.

**Path A (recommended): an encrypted keystore, one passphrase per session.** This is the default behavior of the tool. The command asks for a passphrase twice, so that your keys are encrypted at rest. `--unlock` caches the passphrase for the session:

```bash
btcr2 quickstart -n mutinynet --unlock --ttl 2h
```

With `--unlock`, the session holds the passphrase (here for 2 hours). Each later command in Parts 1 to 4 runs **without a prompt**. You type the passphrase once, not at each signing step. Without `--unlock`, you set the passphrase now, and each signing command asks for it.

**Path B (fastest): an unencrypted dev keystore, no passphrase.** A dev keystore stores the keys in plaintext and never asks for a passphrase. Use it on a test network only. The CLI refuses to sign or generate a mainnet key with a dev keystore:

```bash
btcr2 quickstart -n mutinynet --dev
```

`quickstart` prints the paths, the session state, and the result of the endpoint probe. In text mode, it prints the data only. On Path B, `protection` reads `"dev"` and `unlocked` is `false`:

```json
{
  "home": "/home/you/.btcr2",
  "config": "/home/you/.btcr2/config.json",
  "keystore": "/home/you/.btcr2/keystore.json",
  "network": "mutinynet",
  "created": ["config", "keystore"],
  "protection": "encrypted",
  "unlocked": true,
  "session": { "expiresAt": 1760000000000, "ttlSeconds": 7200 },
  "doctor": { "checks": [ { "endpoint": "btc-rest", "target": "https://mutinynet.com/api", "ok": true }, { "endpoint": "cas", "target": "https://ipfs.io", "ok": true } ] }
}
```

Add `-o json` to a command, for example `btcr2 -o json quickstart`, to get the full `{"action": ..., "data": ...}` envelope.

> **Note:** `quickstart` is idempotent. A second run does not touch the existing files. It never overwrites a keystore, and it never changes a network that you recorded before. `--force` writes a new config file. That removes the custom profiles, the defaults, and the recorded network (pass `-n` to record one again). `--force` never touches the keystore. A mainnet setup needs `--allow-mainnet`, and never with `--dev`. The endpoint probe is **advisory**: if an endpoint is not reachable, the command prints a warning and exits with code 0. Run `btcr2 config doctor -n mutinynet` at any time for a full check. `--no-doctor` skips the probe. On a fresh home you can omit `-n mutinynet`: `quickstart` falls back to mutinynet if no network is recorded. A recorded `defaults.network` wins otherwise.
>
> The step-by-step alternative: `btcr2 init -n mutinynet` creates the home and records the network, `btcr2 keystore unlock --ttl 2h` caches the session, and `btcr2 config doctor` probes the endpoints. `quickstart` runs these three steps in this order.

### List the commands

```bash
btcr2 --help
```

```
Commands:
  init [options]                 Set up the btcr2 home: create the directory, a
                                 default config, and establish the keystore.
  quickstart [options]           One-command onboarding: create the home +
                                 config + keystore, record the network, and
                                 (optionally) cache the session and probe
                                 endpoints.
  create [options]               Create an identifier and initial DID document
  resolve|read [options]         Resolve the DID document of the identifier.
  update [options]               Update a did:btcr2 document.
  deactivate|delete [options]    Deactivate the did:btcr2 identifier
                                 permanently. This is irreversible.
  identifier                     Decode and validate did:btcr2 identifiers
                                 (offline).
  genesis                        Build the genesis document of an external
                                 identifier (offline).
  key                            Manage keypairs in the encrypted keystore.
  keystore                       Establish, inspect, re-key, and unlock the
                                 keystore.
  config                         Read and write CLI configuration.
  profile                        Manage configuration profiles.
  completion [shell]             Print a shell completion script (bash, zsh, or
                                 fish) to stdout.
```

---

## Part 1: Your keys

The keys of a did:btcr2 identifier live in a local keystore under your control. There is no account and no server. Part 0 created the keystore. Now put a key in it.

**Generate a key.** On Path A (encrypted), the command seals the key under your passphrase. The session supplies the passphrase, so the command does **not** ask for it. On Path B (dev), there is no passphrase.

```bash
btcr2 key generate --name demo --set-active
```

Example output (your `keyId` and `publicKey` differ):

```json
{
  "keyId": "urn:kms:secp256k1:e3fa32a91bd958990086bc4c787aa00d",
  "publicKey": "03b59c8cf3e9be573b1543a52717f17a046164cca95ab781ccdf2e75f71344a158",
  "active": true
}
```

**List your keys:**

```bash
btcr2 key list
```

```json
[
  {
    "keyId": "urn:kms:secp256k1:e3fa32a91bd958990086bc4c787aa00d",
    "fingerprint": "e3fa32a91bd958990086bc4c787aa00d",
    "name": "demo",
    "active": true
  }
]
```

**Show the keystore and the session state at any time.** The command never decrypts and never asks for the passphrase:

```bash
btcr2 keystore status
```

```json
{
  "path": "/home/you/.btcr2/keystore.json",
  "protection": "encrypted",
  "established": true,
  "keyCount": 1,
  "active": "urn:kms:secp256k1:e3fa32a91bd958990086bc4c787aa00d",
  "session": { "active": true, "expiresAt": 1784058588203, "secondsRemaining": 7200, "allowMainnet": false }
}
```

That is the Path A shape. On Path B, `protection` reads `"dev"` and `session` stays `{ "active": false }`. A dev keystore has no passphrase, so it never needs a session.

The secret key never leaves this machine. On Path A, the keystore is encrypted at rest. `key show`, `key use`, `key import`, and `key export` complete the key lifecycle. The CLI prints public material only. It never prints a secret key.

---

## Part 2: Create an identifier (offline)

Turn the key into an identifier. This is a local computation: no network, no transaction. The next commands read the result from `$DID`.

```bash
DID=$(btcr2 create --signing-key demo 2>/dev/null)
echo "$DID"
```

Example output (yours differs):

```
did:btcr2:k1q5plyvwt6qw6523ndym6dg8hqdnvk0kxqke37ejl0hc6taffmqdz36qnssf9t
```

That string **is** the identifier. The command made it in milliseconds, with no fee. `create --signing-key` reads the **public** key only, so it never needs the passphrase. In text mode, it prints the identifier on stdout and a `Using stored key ...` note on stderr. The `2>/dev/null` redirect keeps the note out of `$DID`.

The identifier is on a test network, so `create` also prints a **funding hint** on stderr: the initial beacon address with the faucet and explorer links. You send coins to this address before the on-chain update in Part 4. Run the command without the `2>/dev/null` redirect to see the hint:

```
Fund the initial beacon to anchor updates:
  Beacon:   tb1qme9lfnkgcqcfu2v43k9w0fy0zj43z8gdgp2ank
  Faucet:   https://faucet.mutinynet.com/
  Explorer: https://mutinynet.com/address/tb1qme9lfnkgcqcfu2v43k9w0fy0zj43z8gdgp2ank
```

The links come from the network preset. There are no links on regtest and on mainnet. The `Beacon` address is the `#initialP2WPKH` service that you resolve in Part 3.

The identifier has these properties:

**The identifier encodes its network.** The same key on a different network gives a different identifier. Look at the characters after `k1`:

```bash
btcr2 create --signing-key demo -n bitcoin     # did:btcr2:k1qq...  (mainnet)
btcr2 create --signing-key demo -n signet      # did:btcr2:k1qyp... (signet)
btcr2 create --signing-key demo -n mutinynet   # did:btcr2:k1q5p... (mutinynet)
```

**The identifier decodes offline.** `identifier decode` prints the type, the version, the network, and the genesis bytes (here: the public key). `identifier validate` runs the checks of the specification. It exits with code 1 if one check fails.

```bash
btcr2 identifier decode "$DID"
```

```json
{
  "did": "did:btcr2:k1q5plyvwt6qw6523ndym6dg8hqdnvk0kxqke37ejl0hc6taffmqdz36qnssf9t",
  "idType": "KEY",
  "hrp": "k",
  "version": 1,
  "network": "mutinynet",
  "genesisBytes": "03b59c8cf3e9be573b1543a52717f17a046164cca95ab781ccdf2e75f71344a158"
}
```

```bash
btcr2 identifier validate "$DID"        # prints the check list, exit code 0
```

**Machine-readable output** for scripts. With a stored key, the envelope also carries the `keyId` and the `publicKey`:

```bash
btcr2 -o json create --signing-key demo
```

```json
{
  "action": "create",
  "data": "did:btcr2:k1q5plyvwt6qw6523ndym6dg8hqdnvk0kxqke37ejl0hc6taffmqdz36qnssf9t",
  "keyId": "urn:kms:secp256k1:2d821c62dfdfaca4a91745a086fd4a9c",
  "publicKey": "03f231cbd01daa2a336937a6a0f70366cb3ec605b31f665f7df1a5f529d81a28e8"
}
```

For a bare `{action, data}` envelope, pass the public key as raw bytes: `btcr2 -o json create -b <33-byte-pubkey-hex>`. This path needs no keystore. A `k` identifier is deterministic, so the raw path and the `--signing-key` path give the **same** identifier for the same key.

**Two identifier types.** The identifier above is a *deterministic* (`k`) identifier. It comes from a public key, so it resolves with no external data. An *external* (`x`) identifier comes from the SHA-256 hash of a genesis document that you write. `btcr2 genesis build` writes that document from your keys, beacons, and services, and prints the identifier. `create -t x --document` makes the same identifier again from the file:

```bash
btcr2 genesis build -n mutinynet --out ./genesis.json
btcr2 create -t x -n mutinynet --document ./genesis.json
# did:btcr2:x1q8ugqsp7tc24yf2ql6k7tsf9m5p7gtr7zmtuv7yl7f5rhv47yd8pvc9ef67
```

Keep `genesis.json`. An external identifier resolves only with the file: `resolve -i <did> --genesis-document ./genesis.json`. `update` and `deactivate` take the same flag.

---

## Part 3: Resolve the identifier (from Bitcoin)

Resolution reads Bitcoin and builds the current DID document. It needs no config. The identifier names the network.

```bash
btcr2 resolve -i "$DID"
```

Example output (your `id`, `publicKeyMultibase`, and beacon addresses differ):

```json
{
  "didResolutionMetadata": {},
  "didDocument": {
    "id": "did:btcr2:k1q5plyvwt6qw6523ndym6dg8hqdnvk0kxqke37ejl0hc6taffmqdz36qnssf9t",
    "@context": [
      "https://www.w3.org/ns/did/v1.1",
      "https://btcr2.dev/context/v1"
    ],
    "verificationMethod": [
      {
        "id": "did:btcr2:k1q5p...#initialKey",
        "type": "Multikey",
        "controller": "did:btcr2:k1q5p...",
        "publicKeyMultibase": "zQ3shqQaeG9AcVpfWGqRgJ3a7JUcooip2dUpiZBYzDJSFu7zK"
      }
    ],
    "authentication":       ["...#initialKey"],
    "assertionMethod":      ["...#initialKey"],
    "capabilityInvocation": ["...#initialKey"],
    "capabilityDelegation": ["...#initialKey"],
    "service": [
      { "id": "...#initialP2PKH",  "type": "SingletonBeacon", "serviceEndpoint": "bitcoin:mvyGS3WRikKZLk9ofkxFxp8S7GTDKkszCc" },
      { "id": "...#initialP2WPKH", "type": "SingletonBeacon", "serviceEndpoint": "bitcoin:tb1q4xpa0fa8uaypy75kypxe6e79k733weqkx9pq27" },
      { "id": "...#initialP2TR",   "type": "SingletonBeacon", "serviceEndpoint": "bitcoin:tb1pjs0wm87q4569k3wwyuldl4nnhl7qmrkymkkutlnwjyer02uz86mq0x8avs" }
    ]
  },
  "didDocumentMetadata": {
    "versionId": "1",
    "deactivated": false
  }
}
```

What the output shows:

- A full W3C DID document, built from Bitcoin, with **no server in the middle**.
- Three `SingletonBeacon` services (P2PKH, P2WPKH, P2TR). A **beacon** is a Bitcoin address that the controller watches. To publish an update, the controller broadcasts a small transaction from one of these addresses. The addresses come from the same key, so they exist as soon as the identifier exists.
- `versionId: "1"`. There is no update yet.

---

## Part 4: Update the identifier on-chain

An update commits a change to Bitcoin. The on-chain footprint is a 32-byte hash in one `OP_RETURN` output. The document change itself stays off-chain. The world sees that *something* changed, not *what* changed.

The write path broadcasts a real transaction. It has two prerequisites: a funded beacon address, and one confirmation. Do steps A and B first. The `resolve` in step D shows the result. By default, resolution applies a signal after six confirmations (about three minutes on mutinynet). Step D passes `--min-conf 1`, so the result shows after one confirmation.

### Step A: find and fund a beacon address

Read the P2WPKH beacon (the cheapest one) from the resolved document:

```bash
BEACON_ADDR=$(btcr2 -o json resolve -i "$DID" \
  | jq -r '.data.didDocument.service[] | select(.id | endswith("#initialP2WPKH")) | .serviceEndpoint | ltrimstr("bitcoin:")')
echo "Fund this address: $BEACON_ADDR"
```

This is the `Beacon` address from the funding hint of Part 2. Here you read it from the resolved document, so that the next steps can use `$BEACON_ADDR`.

Then:

1. Open https://faucet.mutinynet.com, paste `$BEACON_ADDR`, and request about 100,000 sats.
2. Wait for **1 confirmation** (about 30 to 60 seconds). Watch the address at `https://mutinynet.com/address/<the-address>`.

> **Note: many users behind one IP address.** The public mutinynet faucet has a rate limit and a captcha. A group of users behind one network address can hit the limit as one client. If you run this walkthrough for a group, fund each beacon address from one wallet before the session. Or spread the faucet requests over time. Or keep one funded identifier as a fallback.

> **Note: why one confirmation?** The CLI does not spend an unconfirmed beacon UTXO. A block reorganization or a replacement can remove an unconfirmed input, and that removes the anchor of the update. If you run `update` too early, you see `No spendable UTXO at beacon address: all ... UTXO(s) are unconfirmed`. Wait one block and try again.

### Step B: broadcast the update

Write the change as a JSON Patch. This example adds an `alsoKnownAs` link. The signature needs your secret key. On Path A, the session supplies the passphrase (no prompt). On Path B, the dev keystore needs none.

```bash
# Sign, spend the funded beacon UTXO, and broadcast. Keep the signed update.
btcr2 -o json --signing-key demo update \
  -i "$DID" \
  -p '[{"op":"add","path":"/alsoKnownAs","value":["https://example.com/demo"]}]' \
  | jq '.data.signedUpdate' > signed-update.json
```

`update` first resolves the current document. This is version 1, the initial DID document, so no sidecar data is necessary yet. The command selects the verification method that publishes your key and the one funded beacon. It signs the change, spends the funded beacon UTXO, and broadcasts a Bitcoin transaction. The `OP_RETURN` output of the transaction carries the update hash. The `.data` of the result holds `.data.txid`, the transaction id, and `.data.signedUpdate`, the off-chain half that you keep. The `jq` filter saves the signed update in `signed-update.json`. In text mode, `update` also prints a `Watch:` explorer link for the transaction on stderr.

A second update needs the first signed update as sidecar data for its own source resolution. Pass `--min-conf 1 -r "$(jq -c '{sidecar:{updates:[.]}}' signed-update.json)"`, as in Step D.

Three flags tune the broadcast. `--fee-rate <sat/vB>` (default 5) raises the fee if the network is busy. `--change-address` sends the change of the transaction to another address, so that the announcements of an identifier are not linked on-chain. `--publish-to-cas` selects where the update artifacts go. Its default is `never`: sidecar data only, the private default of this walkthrough. The appendix covers the CAS publication. `deactivate` takes the same three flags.

> **Note:** if the beacon has no funds, or if the faucet payment is not confirmed, `update` stops before the broadcast with a clear message. Example: `Beacon address tb1q... is unfunded. Send BTC to this address before broadcasting the update.` This is the checkpoint between "signed" and "on-chain".

### Step C: wait for the confirmation

Give the update transaction about one block (30 to 60 seconds) on mutinynet. Watch it with the `txid` of Step B at `https://mutinynet.com/tx/<txid>`.

### Step D: resolve version 2

The update of a Singleton beacon lives off-chain. To resolve it, pass the signed update back as **sidecar data**:

```bash
btcr2 resolve -i "$DID" --min-conf 1 -r "$(jq -c '{sidecar:{updates:[.]}}' signed-update.json)"
```

For large sidecar data, write the resolution options to a JSON file and pass `-p options.json` instead of the inline `-r` string. The shape is the same.

**Why `--min-conf 1`?** The specification tells a resolver to apply a beacon signal after six confirmations, and that is the default. Six confirmations is the accepted standard for a settled Bitcoin transaction. Without the flag, the command shows version 1 until the update has six blocks on top of it (about three minutes on mutinynet). The flag lowers the threshold for this walkthrough. The trade-off: a block reorganization removes a signal with one confirmation more easily. The `confirmations` field of the metadata shows the depth that the resolver saw.

The expected output is the same document, now with your patch and `versionId: "2"`:

```json
{
  "didResolutionMetadata": {},
  "didDocument": {
    "id": "did:btcr2:k1q5p...",
    "alsoKnownAs": ["https://example.com/demo"],
    "verificationMethod": [ "..." ],
    "service": [ "..." ]
  },
  "didDocumentMetadata": { "versionId": "2", "deactivated": false }
}
```

**The privacy property.** Resolve the **same** identifier **without** the sidecar data. Bitcoin holds the commitment (a 32-byte hash), but the document change is not on-chain. Resolution cannot build version 2:

```bash
btcr2 resolve -i "$DID" --cas-timeout 1000
# Signed update not found in CAS (hash: ...).
```

The resolver finds an on-chain update hash but no sidecar data. It looks in the default public IPFS gateway, where nobody published the update, and then it fails. The `--cas-timeout 1000` makes that miss return fast instead of a wait on a slow gateway. Only the parties with the sidecar data can see what changed. Bitcoin holds the commitment, and you hold the contents. This is a *policy*, not a limitation. `--publish-to-cas never` is the default. The appendix shows the opt-in path that makes an update resolvable for everyone.

---

## Appendix

### Output formats

`-o text` (the default) prints the `data` only. `-o json` prints the full `{action, data}` envelope for scripts. Each command supports both formats. `BTCR2_OUTPUT` or `defaults.output` sets the default.

### Keystore and sessions

The `keystore` command group manages the keystore and the session. These commands never touch Bitcoin:

```bash
btcr2 keystore init                    # create the keystore (encrypted, asks for the passphrase twice). --dev for a dev keystore
btcr2 keystore status                  # path, protection, key count, and session state (never decrypts, never asks)
btcr2 keystore unlock --ttl 2h         # cache the passphrase for a session (default 1h, maximum 24h, also $BTCR2_KEYSTORE_TTL)
btcr2 keystore lock                    # revoke the session (idempotent, needs no passphrase)
btcr2 keystore change-passphrase       # seal each key again under a new passphrase
```

How the session works (ADR 081):

- `unlock` verifies the passphrase, then caches it in `<home>/session.json` (mode `0600`), bound to that keystore. A later signing command reads the session instead of a prompt, until the session expires or you run `lock`. The passphrase precedence is: `BTCR2_KEYSTORE_PASSPHRASE`, then `--passphrase-file`, then a live session, then an interactive prompt. An unattended or CI path always wins over the session.
- The cached passphrase is base64url-encoded, **not encrypted**. Its only protection at rest is the `0600` file mode. Lock the machine, or run `lock`. `lock` clears the session. `change-passphrase` and an `init` that creates a fresh keystore clear it too. `keystore init --force` creates a new keystore over an existing one.
- **Mainnet is gated.** `unlock` refuses a `bitcoin` default network without `--allow-mainnet`. A session that you unlocked for a test network does not apply to a mainnet operation. The operation falls back to a per-use prompt. Mutinynet needs no flag.

**Encrypted keystore or dev keystore.** An encrypted keystore seals each secret key with argon2id and XChaCha20-Poly1305 under one passphrase. It records a verifier, so a wrong passphrase fails with `Incorrect passphrase`. The CLI never seals a key under a wrong passphrase. A **dev keystore** (`--dev`) stores the secret keys in plaintext and never asks for a passphrase. Use it for throwaway test-network keys only. The CLI **refuses** to sign or generate a mainnet (`bitcoin`) key with a dev keystore.

### The full key lifecycle

Part 1 used `generate` and `list`. The `key` group covers the whole lifecycle:

```bash
btcr2 key show demo                                   # show one key (public material only)
btcr2 key use demo                                    # make a key the active key
btcr2 key import --secret-file k.hex --name restored  # import a 32-byte secret key from a file
btcr2 key import --public 03ab.. --name partner       # WATCH-ONLY: public key only
btcr2 key export demo                                 # public export (prints to stdout)
btcr2 key export --secret --out demo.hex demo         # secret export: to a new 0600 file ONLY
btcr2 key delete restored --force                     # remove an entry
```

Two behaviors are important. A **watch-only** entry (imported with `--public`) can verify and derive addresses, but it can never sign. It is useful for the key of a counterparty. A **secret export never goes to the terminal**. It needs `--out`, creates the file with `0600` permissions, and warns you to protect the file. A secret key never appears in the terminal history.

### Environment variables

Useful for the setup of many machines or for unattended runs:

- `BTCR2_HOME`: move all state (same as `--home`).
- `BTCR2_KEYSTORE_PASSPHRASE`: supply the passphrase without a prompt. It has the highest precedence, above `--passphrase-file` and a session.
- `BTCR2_KEYSTORE_TTL`: the default `keystore unlock` lifetime (same as `--ttl`).
- Connection: `BTCR2_BTC_REST`, `BTCR2_CAS_GATEWAY`, `BTCR2_FEE_RATE`, and more.

See the [environment variable table](./README.md#environment-variables) for the complete list.

### Config and profiles

`btcr2 quickstart` (or `btcr2 init`) already created the config file, so you rarely call `config init`.

```bash
btcr2 config set defaults.network mutinynet
btcr2 config list
btcr2 config path                         # the home, config, and keystore paths
btcr2 profile add client-demo
btcr2 profile use client-demo
```

Example output of `config list`. A fresh config file has one empty profile per network. `defaults` starts with `output` only, until you set more:

```json
{
  "schemaVersion": 1,
  "defaults": { "output": "text", "network": "mutinynet" },
  "profiles": {
    "bitcoin": {}, "testnet3": {}, "testnet4": {},
    "signet": {}, "mutinynet": {}, "regtest": {}
  }
}
```

`config validate` checks the file. `config effective` shows the resolved connection values with their source (`flag`, `env`, `file`, or `default`). `config doctor` probes the endpoints. `config get`, `config list`, `config effective`, and `profile show` **redact** the Bitcoin RPC password. `config get`, `config list`, and `profile show` also redact an authentication header (`config effective` omits the headers). Add `--show-secrets` to print them in plaintext.

### Publish updates to a CAS (opt-in)

Part 4 kept the signed update private as sidecar data. If you *want* an update to be resolvable for everyone, publish it to a content-addressed store (IPFS) as part of the update:

```bash
btcr2 --cas-rpc-url http://127.0.0.1:5001 update ... --publish-to-cas always
```

`--publish-to-cas` has three values. `never` (default): sidecar data only, the private default. `auto`: a best-effort publication if a writable CAS is configured. It never blocks the broadcast. `always`: the publication is required, and the command fails without a writable CAS. Reads go through `--cas-gateway` (any public IPFS gateway works). Writes need `--cas-rpc-url` (an IPFS HTTP RPC endpoint under your control). After the publication, the last step of Part 4 inverts: resolution finds the update in the CAS and succeeds without sidecar data. The default is private. The publication is your choice.

### Use your own Bitcoin node

No step needs a third-party API. Each command that touches Bitcoin accepts connection overrides. The whole walkthrough can run against infrastructure under your control:

```bash
btcr2 resolve -i "$DID" --btc-rest https://esplora.internal/api      # your own Esplora
export BTCR2_BTC_RPC_PASS_FILE=~/.bitcoin/rpcpass                    # never on argv
btcr2 --btc-rpc-url http://127.0.0.1:38332 \
      --btc-rpc-user demo \
      --btc-rpc-wallet btcr2 \
      update ...                                                     # your own Bitcoin Core
```

There is no `--btc-rpc-pass` flag. A password on argv is visible to every local user through `ps` and `/proc/<pid>/cmdline`, and it stays in the shell history and the CI logs. `BTCR2_BTC_RPC_PASS_FILE` is the channel to pair with a URL on the command line, as above. `BTCR2_BTC_RPC_PASS` and a profile `rpcPass` (which can hold an `env:<VAR>` or `file:<path>` reference) supply the password with a URL from their own layer. The URL, the user, and the password resolve as one unit per layer.

`--btc-rest-header` and `--btc-rpc-header` attach authentication headers for a gated endpoint (a hosted Esplora, an authentication proxy). `--btc-timeout` bounds a slow endpoint. The argv caveat applies to a header with a credential: a bearer token or an API key on argv is as visible through `ps` as a password. Put a credential header in the profile's `btc.headers` or `btc.rpcHeaders`, where `profile show` redacts it. Use the flags for headers that are not secret. All of these values can live in a network profile instead of the command line.

With an RPC connection, you can also move the beacon signal discovery off the indexer. `--btc-signal-discovery fullnode` (or `BTCR2_BTC_SIGNAL_DISCOVERY`, or a profile `btc.signalDiscovery`) reads the signals from the blocks over your own Bitcoin Core instead of the Esplora indexer. `indexer` is the default. `config effective` reports the live mode.

### Shell completion

```bash
eval "$(btcr2 completion bash)"           # or: zsh, fish
```

### Deactivate

`btcr2 deactivate` (alias `delete`) retires an identifier. This is permanent. It uses the same on-chain write path as `update`: the same funded beacon, the same signature (a session or a prompt), and the same `--publish-to-cas`, `--fee-rate`, and `--change-address` flags. Do not run it on an identifier that you want to keep. The command resolves the current state first. It needs the version 2 update as sidecar data and, for a fresh signal, `--min-conf 1`, as in the `resolve` of Step D. The api then derives the verification method and the beacon, and supplies the deactivation patch:

```bash
btcr2 --signing-key demo deactivate \
  -i "$DID" \
  --min-conf 1 \
  -r "$(jq -c '{sidecar:{updates:[.]}}' signed-update.json)"
```

An offline alternative skips that resolution. Save the version 2 document first: `btcr2 -o json resolve ... | jq '.data.didDocument' > doc-v2.json`, with the `--min-conf 1` and `-r` of Step D. Then pass `-s "$(cat doc-v2.json)" --source-version-id 2` instead of the two resolution flags.

A later `resolve` (with the deactivation as sidecar data, like an update) returns the document with `didDocumentMetadata.deactivated: true`. This is the final state of the identifier, anchored to Bitcoin like each state before it.

### Where your data lives

All CLI state lives in **one home directory**. It holds `config.json`, `keystore.json`, and (after `keystore unlock`) `session.json`:

- Default: `~/.btcr2` on Linux and macOS, `%LOCALAPPDATA%\btcr2` on Windows.
- `--home <dir>` (highest priority) or `$BTCR2_HOME` moves the whole home.
- `--config <path>` and `--keystore <path>` still override each file on its own.
- `btcr2 config path` prints the resolved locations.

For a throwaway run that cannot touch your real state, point the home at a scratch directory. Delete the directory to reset:

```bash
btcr2 --home /tmp/btcr2-demo init --dev
# ...run the walkthrough against /tmp/btcr2-demo...
rm -rf /tmp/btcr2-demo
```

### Troubleshooting

| Symptom | Cause and fix |
|---|---|
| `... is unfunded. Send BTC ...` | Fund the beacon address from the faucet, then try again. |
| `No spendable UTXO ... unconfirmed` | The faucet payment is not confirmed yet. Wait one block. |
| The faucet returns a rate-limit or captcha error | A shared IP address hit the limit. Spread the requests over time, or use a funded beacon (see Step A). |
| `Signed update not found in CAS` | You resolved an identifier with an on-chain update, but without the sidecar data. Pass it back with `-r '{"sidecar":{"updates":[...]}}'`. This is the privacy feature, not a defect. |
| `resolve` shows the old version, with no error | The update transaction has fewer than six confirmations, and the default `minConf` excludes it. Wait for six blocks, or pass `--min-conf 1`. |
| `Invalid resolution option minConf` | `--min-conf`, or the `minConf` in `-r` or `-p`, is not a positive integer. Pass `1` or more. |
| `resolve` hangs | Check that `https://mutinynet.com/api` is reachable (`btcr2 config doctor -n mutinynet`). If necessary, override the endpoint with `--btc-rest <url>`. |
| `update` or `deactivate` does not ask for a passphrase | This is expected if a `keystore unlock` session is live, if `BTCR2_KEYSTORE_PASSPHRASE` or `--passphrase-file` is set, or with a dev keystore. `btcr2 keystore status` shows the session. `btcr2 keystore lock` brings the prompt back. |
| `Incorrect passphrase ...; no session was created` | The passphrase did not match the keystore verifier. Type it again, or change it with `btcr2 keystore change-passphrase`. |
| `Refusing to unlock for a mainnet (bitcoin) context` | A session for a mainnet default suspends the per-use authentication. Pass `--allow-mainnet` to permit it, or keep the per-use prompt. |
| `Provide both --source-document and --source-version-id, or neither` | You passed one half of the offline source pair. Pass both, or omit both. Then the command resolves the current document. |
| `... apply only when --source-document and --source-version-id are omitted` | `-r`, `--resolution-options-path`, and `--min-conf` feed the source resolution. A supplied source pair skips that resolution. Drop the pair or drop the flags. |
| `update` or `deactivate` fails with `Signed update not found in CAS` | The source resolution inside the command needs the same sidecar data as `resolve`. Pass `-r '{"sidecar":{"updates":[...]}}'`, and `--min-conf 1` for a fresh signal. |
| `... verification methods on DID ... publish the signer's key` | The document lists the signing key under more than one method. Pass `-m <id>` with one of the listed ids. |
| `No beacon of DID ... holds a spendable UTXO`, or `... beacons of DID ... hold a spendable UTXO` | Fund exactly one beacon, or pass `-b <id>` to select one of the funded beacons. |

### Command reference (short)

```
btcr2 init [-n <network>] [--dev] [--force]
btcr2 quickstart [-n <network>] [--dev] [--unlock] [--ttl <dur>] [--no-doctor] [--allow-mainnet] [--force]
btcr2 keystore init [--dev] [--force] | status | change-passphrase|passwd | unlock [--ttl <dur>] [--allow-mainnet] | lock
btcr2 key generate --name <n> --set-active
btcr2 key list|ls | show <ref> | use <ref> | import [--secret-file <path> | --public <hex>] | export [--secret --out <path>] <ref> | delete|rm [--force] <ref>
btcr2 create [-t k|x] [-n <network>] [-b <hex> | --document <path>] [--signing-key <ref>]
btcr2 resolve|read -i <did> [-r <json>] [-p <path>] [--min-conf <n>] [--genesis-document <path>]
btcr2 update -i <did> -p <patches-json> [-s <doc-json> --source-version-id <n>] [-m <vm-id>] [-b <beacon-id>] [-r <json> | --resolution-options-path <path>] [--min-conf <n>] [--genesis-document <path>] [--publish-to-cas <mode>] [--fee-rate <n>] [--change-address <addr>]
btcr2 deactivate|delete -i <did> [-s <doc-json> --source-version-id <n>] [-m <vm-id>] [-b <beacon-id>] [-r <json> | --resolution-options-path <path>] [--min-conf <n>] [--genesis-document <path>] [--publish-to-cas <mode>] [--fee-rate <n>] [--change-address <addr>]
btcr2 identifier decode <did> [--initial-document] [--genesis-document <path>]
btcr2 identifier validate <did> [-b <hex>] [--genesis-document <path>]
btcr2 genesis build [-n <network>] [--spec <path>] [--out <path>] [--force]
btcr2 config init | get [path] | set <path> <value> | unset <path> | list|ls | validate | effective | path | doctor
btcr2 profile add <name> | use <name> | show [name] | remove|rm <name>
btcr2 completion [bash|zsh|fish]
```
```
Global flags: -o json|text  --verbose  --quiet  --home <dir>  -c <config>  --profile <name>
              --keystore <path>  --passphrase-file <path>  --signing-key <ref>
              --btc-rest <url>  --btc-rpc-url <url>  --btc-rpc-user <u>
              --btc-rpc-wallet <name>  --btc-rest-header <h>  --btc-rpc-header <h>
              --btc-signal-discovery <indexer|fullnode>
              --cas-gateway <url>  --cas-rpc-url <url>  --btc-timeout <ms>  --cas-timeout <ms>
```

See `btcr2 --help`, or the [global flags](./README.md#global-flags) and [environment variables](./README.md#environment-variables) tables, for the complete surface.

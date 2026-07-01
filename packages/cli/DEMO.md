# did:btcr2 CLI - Client Demo

A guided, run-it-yourself walkthrough of the `btcr2` command-line tool: create a
decentralized identifier offline, resolve it live from Bitcoin, and update it on-chain.
Runs on **Mutinynet** (a public Bitcoin signet with 30-second blocks and a free faucet),
so nothing here costs real money.

**How to use this doc:** run the commands top to bottom in one terminal session. Later
commands reuse shell variables set by earlier ones, so keep the same session open. Every
output block is **illustrative** - your keys, DID strings, and Bitcoin addresses will be
unique to you, but the shape will match.

---

## The pitch (30 seconds)

did:btcr2 is a decentralized identifier method that uses Bitcoin as its trust anchor.
Three things make it different, and this demo shows all three:

1. **Creation is offline and instant.** You mint an identifier from a key on your
   laptop. No transaction, no fee, no waiting, no registrar.
2. **Trust is anchored to Bitcoin.** Updates are committed on-chain, so an identifier's
   history inherits Bitcoin's immutability and censorship-resistance.
3. **Updates stay private.** Only a 32-byte hash lands on-chain. The actual document
   change travels off-chain ("sidecar"), so nothing sensitive is ever public.

---

## Part 0 - Setup

**Get the CLI.** Either install the published package:

```bash
npm install -g @did-btcr2/cli
```

or build it from this monorepo (run from the repo root):

```bash
pnpm build
alias btcr2="node $PWD/packages/cli/dist/esm/bin/btcr2.js"
```

**Confirm it runs:**

```bash
btcr2 --version
```

```
btcr2 0.12.14
```

**Set Mutinynet as the default network** so you can drop `-n mutinynet` from every
command:

```bash
btcr2 config init
btcr2 config set defaults.network mutinynet
```

**Optional connectivity check.** This DID is already live on Mutinynet, so resolving it
confirms your network path works before you generate your own:

```bash
btcr2 resolve -i did:btcr2:k1q5pel7vf3pjqa526m2up700805yckzsk6qpx6fkeqlaxfggclk43adqzeap82
```

If that returns a JSON document, you are ready.

**See everything the tool can do:**

```bash
btcr2 --help
```

```
Commands:
  create        Create an identifier and initial DID document
  resolve|read  Resolve the DID document of the identifier.
  update        Update a did:btcr2 document.
  deactivate    Deactivate the did:btcr2 identifier permanently.
  key           Manage keypairs in the encrypted keystore.
  config        Read and write CLI configuration.
  profile       Manage configuration profiles.
  completion    Print a shell completion script (bash, zsh, or fish).
```

---

## Part 1 - Own your keys

did:btcr2 keys live in a local, encrypted keystore that you control. There is no account
and no server.

**Generate a key.** You will be prompted to set a passphrase; it encrypts the keystore
on disk.

```bash
btcr2 key generate --name demo --set-active
```

Illustrative output (your `keyId` and `publicKey` will differ):

```json
{
  "keyId": "urn:kms:secp256k1:48c2f0ccbbecce41f36b4116272f9842",
  "publicKey": "039ff98988640ed15adab81f3de77d098b0a16d0026d26d907fa64a118fdab1eb4",
  "active": true
}
```

**List what you hold:**

```bash
btcr2 key list
```

```json
[
  {
    "keyId": "urn:kms:secp256k1:48c2f0ccbbecce41f36b4116272f9842",
    "fingerprint": "48c2f0ccbbecce41f36b4116272f9842",
    "name": "demo",
    "active": true
  }
]
```

Talking point: the secret never leaves this machine, and the keystore is encrypted at
rest. `key show`, `key use`, `key import`, and `key export` round out the lifecycle.
Public material is always safe to print; the secret is never displayed.

---

## Part 2 - Create an identifier (offline, instant)

Turn the key into a DID. This is pure local computation: no network, no transaction. We
capture the result into `$DID` so later commands can reuse it.

```bash
DID=$(btcr2 create --signing-key demo 2>/dev/null)
echo "$DID"
```

Illustrative output (yours will differ):

```
did:btcr2:k1q5pel7vf3pjqa526m2up700805yckzsk6qpx6fkeqlaxfggclk43adqzeap82
```

That string **is** the identifier. It was produced in milliseconds, with no fee. (Note:
`create --signing-key` only reads the public key, so it does not prompt for your
passphrase.)

A few things to show off:

**The identifier encodes its network.** The same key on a different network yields a
different DID. Watch the characters right after `k1`:

```bash
btcr2 create --signing-key demo -n bitcoin     # did:btcr2:k1qq...  (mainnet)
btcr2 create --signing-key demo -n signet      # did:btcr2:k1qyp... (signet)
btcr2 create --signing-key demo -n mutinynet   # did:btcr2:k1q5p... (mutinynet)
```

**Machine-readable output** for scripting and integration:

```bash
btcr2 -o json create --signing-key demo
```

```json
{
  "action": "create",
  "data": "did:btcr2:k1q5pel7vf3pjqa526m2up700805yckzsk6qpx6fkeqlaxfggclk43adqzeap82"
}
```

**Two identifier flavors.** The one above is a *deterministic* (`k`) identifier: it is
derived straight from a public key, so it resolves with zero external data. There is
also an *external* (`x`) identifier, minted from the SHA-256 hash of a genesis document
you author:

```bash
btcr2 create -t x -b <64-hex-sha256-of-your-genesis-document>
# did:btcr2:x1q8ugqsp7tc24yf2ql6k7tsf9m5p7gtr7zmtuv7yl7f5rhv47yd8pvc9ef67
```

---

## Part 3 - Resolve it (live, from Bitcoin)

Resolution reads Bitcoin to reconstruct the current document. It needs no configuration;
the network is read from the DID itself.

```bash
btcr2 resolve -i "$DID"
```

Illustrative output (your `id`, `publicKeyMultibase`, and beacon addresses will differ):

```json
{
  "didResolutionMetadata": {},
  "didDocument": {
    "id": "did:btcr2:k1q5pel7vf3pjqa526m2up700805yckzsk6qpx6fkeqlaxfggclk43adqzeap82",
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

What to point at:

- A full, W3C-conformant DID document, reconstructed from Bitcoin, with **no server in
  the middle**.
- The three `SingletonBeacon` services (P2PKH, P2WPKH, P2TR). A **beacon** is a Bitcoin
  address the controller watches: publishing an update means broadcasting a tiny signal
  from one of these addresses. They are derived from the same key, so they exist the
  moment the DID does.
- `versionId: 1`. No updates yet.

---

## Part 4 - Update it on-chain

An update commits a change to Bitcoin. The on-chain footprint is only a 32-byte hash
inside one `OP_RETURN` output; the actual document change stays off-chain. That is the
privacy story: the world sees that *something* changed, not *what*.

The write path broadcasts a real transaction, so it has two prerequisites: a funded
beacon address, and one confirmation. Do steps A and B first, then the resolve in step D
is the reveal.

### Step A - find and fund a beacon address

Pull the cheapest beacon (P2WPKH) out of the resolved document:

```bash
BEACON_ADDR=$(btcr2 -o json resolve -i "$DID" \
  | jq -r '.data.didDocument.service[] | select(.id | endswith("#initialP2WPKH")) | .serviceEndpoint | ltrimstr("bitcoin:")')
echo "Fund this address: $BEACON_ADDR"
```

Then:

1. Open https://faucet.mutinynet.com, paste `$BEACON_ADDR`, and request ~100,000 sats.
2. Wait for **1 confirmation** (about 30-60 seconds). Watch it at
   `https://mutinynet.com/address/<the-address>`.

> **Why wait for a confirmation?** The CLI deliberately refuses to spend an unconfirmed
> beacon UTXO (an unconfirmed input can be reorged or replaced, which would un-anchor
> your update). If you run `update` too early you will see
> `No spendable UTXO at beacon address: all ... UTXO(s) are unconfirmed`. Wait one block
> and retry.

### Step B - broadcast the update

Save the current document, then describe the change as a JSON Patch. This example adds
an `alsoKnownAs` link. You will be prompted for your keystore passphrase here, because
signing needs the secret key.

```bash
# Save the current (v1) document.
btcr2 -o json resolve -i "$DID" | jq '.data.didDocument' > doc-v1.json

# Sign, spend the funded beacon UTXO, and broadcast. Keep the signed update it returns.
btcr2 -o json --signing-key demo update \
  -s "$(cat doc-v1.json)" \
  --source-version-id 1 \
  -p '[{"op":"add","path":"/alsoKnownAs","value":["https://example.com/demo"]}]' \
  -m "${DID}#initialKey" \
  -b "\"${DID}#initialP2WPKH\"" \
  | jq '.data' > signed-update.json
```

`update` signs the change, spends the funded beacon UTXO, and broadcasts a Bitcoin
transaction whose `OP_RETURN` carries the update hash. `signed-update.json` is the
off-chain half you keep.

> If the beacon is not funded (or the payment has not confirmed), `update` stops before
> broadcasting with a clear message, for example:
> `Beacon address tb1q... is unfunded. Send BTC to this address before broadcasting the
> update.` That is the checkpoint between "signed" and "on-chain".

### Step C - wait for the signal to confirm

Give the update transaction about 1 block (30-60 seconds) to confirm on Mutinynet.

### Step D - resolve v2 (the reveal)

Because a Singleton-beacon update lives off-chain, you resolve it by handing the signed
update back as **sidecar** data:

```bash
btcr2 resolve -i "$DID" -r "$(jq -c '{sidecar:{updates:[.]}}' signed-update.json)"
```

Expected: the same document, now with your patch applied and `versionId: "2"`:

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

**The privacy punchline.** Resolve the **same** DID **without** the sidecar, and it
reports that an update exists but cannot be reconstructed:

```bash
btcr2 resolve -i "$DID"
# Signed update required but not in sidecar (hash: ...). Provide options.sidecar.updates ...
```

Only the parties you share the sidecar with can see what changed. Bitcoin holds the
commitment; you hold the contents.

---

## What to emphasize

- **No servers, no registrar, no lock-in.** Create offline, resolve from public Bitcoin
  infrastructure, self-custody the keys.
- **Bitcoin-grade integrity for the update history.** The version history is anchored to
  the most secure ledger there is.
- **Private by construction.** On-chain you commit a hash; the document and any PII stay
  off-chain and are shared selectively.
- **Standards-based.** The output is a W3C DID Core document; it drops into existing DID
  tooling.

---

## Appendix

### Output formats

`-o text` (default) is terse and human-friendly; `-o json` is clean and scriptable.
Every command supports both.

### Config and profiles

```bash
btcr2 config init                         # one profile per network
btcr2 config set defaults.network mutinynet
btcr2 config list
btcr2 profile add client-demo
btcr2 profile use client-demo
```

`config list` illustrative output:

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

### Shell completion

```bash
eval "$(btcr2 completion bash)"           # or: zsh, fish
```

### Deactivate

`btcr2 deactivate` permanently and irreversibly retires a DID via the same on-chain
write path as `update` (same funding prerequisite). Do not run it against a DID you want
to keep.

### Where your data lives

- Keystore: `$XDG_DATA_HOME/btcr2/keystore.json` (typically `~/.local/share/btcr2/`).
- Config: `$XDG_CONFIG_HOME/btcr2/config.json` (typically `~/.config/btcr2/`).

To run against throwaway locations instead (handy for a clean rehearsal), pass
`--keystore <path>` and `--config <path>`, or point `XDG_DATA_HOME` / `XDG_CONFIG_HOME`
at a scratch directory. Delete those files to reset.

### Troubleshooting

| Symptom | Cause and fix |
|---|---|
| `... is unfunded. Send BTC ...` | Fund the beacon address from the faucet, then retry. |
| `No spendable UTXO ... unconfirmed` | The faucet payment has not confirmed yet. Wait one block. |
| `Signed update required but not in sidecar` | The DID has an on-chain update; pass it back with `-r '{"sidecar":{"updates":[...]}}'`. |
| `resolve` hangs | Check reachability to `https://mutinynet.com/api`; override with `--btc-rest <url>` if needed. |
| `update` never prompts for a passphrase | You are in an old shell; the prompt appears on the signing step. Use `--passphrase-file <path>` for unattended runs. |

### Command reference (quick)

```
btcr2 key generate --name <n> --set-active
btcr2 key list | show <ref> | use <ref> | import ... | export <ref> | delete <ref>
btcr2 create [-t k|x] [-n <network>] [-b <hex>] [--signing-key <ref>]
btcr2 resolve -i <did> [-r <json>] [-p <path>]
btcr2 update -s <doc-json> --source-version-id <n> -p <patches-json> -m <vm-id> -b <beacon-id-json>
btcr2 deactivate -s <doc-json> --source-version-id <n> -m <vm-id> -b <beacon-id-json>
btcr2 config init | get [path] | set <path> <value> | unset <path> | list
btcr2 profile add <name> | use <name> | show [name] | remove <name>
```
```
Global flags: -o json|text  --verbose  --quiet  -c <config>  --profile <name>
              --btc-rest <url>  --keystore <path>  --passphrase-file <path>  --signing-key <ref>
```

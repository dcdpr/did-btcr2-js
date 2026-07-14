# did:btcr2 CLI - Client Demo

A guided, run-it-yourself walkthrough of the `btcr2` command-line tool: set up a local
keystore, create a decentralized identifier offline, resolve it live from Bitcoin, and
update it on-chain. Runs on **Mutinynet** (a public Bitcoin signet with 30-second blocks
and a free faucet), so nothing here costs real money.

**How to use this doc:** run the commands top to bottom in one terminal session. Later
commands reuse shell variables set by earlier ones, so keep the same session open. Every
output block is **illustrative** - your keys, DID strings, and Bitcoin addresses will be
unique to you, but the shape will match.

Targets `@did-btcr2/cli` **v0.18.0**.

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

### Prerequisites

Before the first command, confirm you have:

- **Node.js >= 22** (the CLI runtime).
- **`jq`** (used to pull values out of JSON in Parts 3 and 4).
- **A POSIX shell**: bash or zsh on Linux/macOS. On Windows, use **WSL** or **Git Bash**;
  the copy-paste flow here relies on `alias`, `$(...)`, `2>/dev/null`, and single-quoted
  JSON, which PowerShell and cmd do not handle the same way.

```bash
node --version && jq --version      # both should print a version, not "command not found"
```

### Get the CLI

Either install the published package:

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
btcr2 0.18.0
```

### Set up in one command

`btcr2 quickstart` gets you ready in a single step: it creates the btcr2 home directory,
writes a default config, establishes the keystore, records the network (Mutinynet by
default), and probes the endpoints so you know the network is reachable. Pick one of two
paths.

**Path A (recommended) - encrypted keystore, authenticate once per session.** This is the
real product experience and shows off the session unlock agent. It prompts for a
passphrase (twice, to confirm it) so your keys are encrypted at rest, then `--unlock`
caches it for the session:

```bash
btcr2 quickstart -n mutinynet --unlock --ttl 2h
```

`--unlock` caches the passphrase for the session (here, 2 hours) so every later command in
Parts 1 to 4 runs **without re-prompting**. You authenticate once, not on every signing
step. (Omit `--unlock` and you set the passphrase now but keep a per-use prompt.)

**Path B (fastest) - unencrypted dev keystore, no passphrase at all.** For a smooth
follow-along with zero passphrase typing, use a dev keystore. Keys are stored in
plaintext, so this is **testnet/regtest/signet/mutinynet only** (the CLI hard-refuses to
sign or generate a mainnet key with a dev keystore):

```bash
btcr2 quickstart -n mutinynet --dev
```

`quickstart` prints where it put everything, whether a session was cached, and the
endpoint probe result (text mode shows just the data; on Path B the `protection` reads
`"dev"` and `unlocked` is `false`):

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
  "doctor": { "checks": [ { "endpoint": "btc-rest", "target": "https://mutinynet.com/api", "ok": true } ] }
}
```

(Add `-o json` to any command, for example `btcr2 -o json quickstart`, to get the full
`{"action": ..., "data": ...}` envelope instead.)

> `quickstart` is idempotent: run it again and it leaves existing files untouched (it never
> overwrites a keystore, and it will not clobber a network you set earlier). The endpoint
> probe is **advisory** - if an endpoint is briefly unreachable it warns but still succeeds;
> re-run `btcr2 config doctor -n mutinynet` any time for an authoritative check. Pass
> `--no-doctor` to skip the probe. `-n mutinynet` is the default, so you can drop it.
>
> Prefer to do it step by step? `btcr2 init -n mutinynet` scaffolds the home and records
> the network, `btcr2 keystore unlock --ttl 2h` caches the session, and `btcr2 config
> doctor` probes the endpoints - `quickstart` just runs those in order.

### See everything the tool can do

```bash
btcr2 --help
```

```
Commands:
  init          Set up the btcr2 home: create the directory, a default config,
                and establish the keystore.
  quickstart    One-command onboarding: create the home + config + keystore,
                record the network, and (optionally) cache the session and probe endpoints.
  create        Create an identifier and initial DID document
  resolve|read  Resolve the DID document of the identifier.
  update        Update a did:btcr2 document.
  deactivate|delete  Deactivate the did:btcr2 identifier permanently. This is irreversible.
  key           Manage keypairs in the encrypted keystore.
  keystore      Establish, inspect, re-key, and unlock the keystore.
  config        Read and write CLI configuration.
  profile       Manage configuration profiles.
  completion    Print a shell completion script (bash, zsh, or fish).
```

---

## Part 1 - Own your keys

did:btcr2 keys live in a local keystore that you control. There is no account and no
server. You already established the keystore in Part 0; now put a key in it.

**Generate a key.** On Path A (encrypted) this seals the key under your passphrase, but
because you unlocked the session it does **not** re-prompt. On Path B (dev) there is no
passphrase at all.

```bash
btcr2 key generate --name demo --set-active
```

Illustrative output (your `keyId` and `publicKey` will differ):

```json
{
  "keyId": "urn:kms:secp256k1:e3fa32a91bd958990086bc4c787aa00d",
  "publicKey": "03b59c8cf3e9be573b1543a52717f17a046164cca95ab781ccdf2e75f71344a158",
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
    "keyId": "urn:kms:secp256k1:e3fa32a91bd958990086bc4c787aa00d",
    "fingerprint": "e3fa32a91bd958990086bc4c787aa00d",
    "name": "demo",
    "active": true
  }
]
```

**Inspect the keystore and session state at any time** (never decrypts, never prompts):

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

(That is the Path A shape. On Path B, `protection` reads `"dev"` and `session` stays
`{ "active": false }`: a dev keystore has no passphrase, so it never needs a session.)

Talking point: the secret never leaves this machine, and (on Path A) the keystore is
encrypted at rest. `key show`, `key use`, `key import`, and `key export` round out the
lifecycle. Public material is always safe to print; the secret is never displayed.

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
did:btcr2:k1q5plyvwt6qw6523ndym6dg8hqdnvk0kxqke37ejl0hc6taffmqdz36qnssf9t
```

That string **is** the identifier. It was produced in milliseconds, with no fee. (Note:
`create --signing-key` only reads the **public** key, so it never needs your passphrase,
session or not. In text mode it prints the DID to stdout and a `Using stored key ...`
note to stderr, which is why we redirect `2>/dev/null` when capturing `$DID`.)

Because this DID is on a testnet, `create` also prints a **funding hint** to stderr - the
initial beacon address next to its faucet and explorer links - so you know where to send
coins before the on-chain update in Part 4. Run it without the `2>/dev/null` redirect to
see it:

```
Fund the initial beacon to anchor updates:
  Beacon:   tb1qme9lfnkgcqcfu2v43k9w0fy0zj43z8gdgp2ank
  Faucet:   https://faucet.mutinynet.com/
  Explorer: https://mutinynet.com/address/tb1qme9lfnkgcqcfu2v43k9w0fy0zj43z8gdgp2ank
```

(These links come from the per-network preset, so they are absent on regtest and mainnet.
The `Beacon` address is the same `#initialP2WPKH` service you will resolve in Part 4.)

A few things to show off:

**The identifier encodes its network.** The same key on a different network yields a
different DID. Watch the characters right after `k1`:

```bash
btcr2 create --signing-key demo -n bitcoin     # did:btcr2:k1qq...  (mainnet)
btcr2 create --signing-key demo -n signet      # did:btcr2:k1qyp... (signet)
btcr2 create --signing-key demo -n mutinynet   # did:btcr2:k1q5p... (mutinynet)
```

**Machine-readable output** for scripting and integration. Because this uses a stored
key, the envelope also echoes the `keyId` and `publicKey` it resolved:

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

(For a bare `{action, data}` envelope, use the keystore-free raw-bytes path:
`btcr2 -o json create -b <33-byte-pubkey-hex>`. Because `k` identifiers are deterministic,
that raw path and the `--signing-key` path above yield the **same** DID for the same key.)

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

What to point at:

- A full, W3C-conformant DID document, reconstructed from Bitcoin, with **no server in
  the middle**.
- The three `SingletonBeacon` services (P2PKH, P2WPKH, P2TR). A **beacon** is a Bitcoin
  address the controller watches: publishing an update means broadcasting a tiny signal
  from one of these addresses. They are derived from the same key, so they exist the
  moment the DID does.
- `versionId: "1"`. No updates yet.

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

(This is the same `Beacon` address `create` printed in its funding hint back in Part 2 -
here we pull it programmatically from the resolved document so the rest of the flow can
reuse `$BEACON_ADDR`.)

Then:

1. Open https://faucet.mutinynet.com, paste `$BEACON_ADDR`, and request ~100,000 sats.
2. Wait for **1 confirmation** (about 30-60 seconds). Watch it at
   `https://mutinynet.com/address/<the-address>`.

> **Running this for a room?** The public Mutinynet faucet is rate-limited and usually
> gated by a captcha, and a conference-room full of attendees behind one venue IP can get
> throttled as if they were a single abusive client. Pre-arrange a mitigation: pre-fund
> each attendee's beacon address from a facilitator wallet ahead of time, stagger the
> requests, or keep one already-funded DID warm as a fallback so the reveal still runs if
> the faucet is slow or down.

> **Why wait for a confirmation?** The CLI deliberately refuses to spend an unconfirmed
> beacon UTXO (an unconfirmed input can be reorged or replaced, which would un-anchor
> your update). If you run `update` too early you will see
> `No spendable UTXO at beacon address: all ... UTXO(s) are unconfirmed`. Wait one block
> and retry.

### Step B - broadcast the update

Save the current document, then describe the change as a JSON Patch. This example adds
an `alsoKnownAs` link. Signing needs your secret key: on Path A the live `keystore unlock`
session supplies the passphrase (no prompt); on Path B the dev keystore needs none.

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
  | jq '.data.signedUpdate' > signed-update.json
```

`update` signs the change, spends the funded beacon UTXO, and broadcasts a Bitcoin
transaction whose `OP_RETURN` carries the update hash. The command's `.data` is an
enriched result (`.data.txid` is the broadcast transaction id, handy for watching the
signal confirm); `.data.signedUpdate` is the off-chain half you keep, so we extract just
that into `signed-update.json`. In text mode `update` also prints a `Watch:` explorer link
for the txid to stderr, so you can click straight through to the transaction.

> If the beacon is not funded (or the payment has not confirmed), `update` stops before
> broadcasting with a clear message, for example:
> `Beacon address tb1q... is unfunded. Send BTC to this address before broadcasting the
> update.` That is the checkpoint between "signed" and "on-chain".

### Step C - wait for the signal to confirm

Give the update transaction about 1 block (30-60 seconds) to confirm on Mutinynet. You
can watch it with the `txid` from Step B at `https://mutinynet.com/tx/<txid>`.

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

**The privacy punchline.** Resolve the **same** DID **without** the sidecar. Bitcoin still
holds the commitment (a 32-byte hash), but the document change is not on-chain, so
resolution cannot reconstruct v2:

```bash
btcr2 resolve -i "$DID" --cas-timeout 1000
# Signed update not found in CAS (hash: ...).
```

The resolver, finding an on-chain update hash but no sidecar, checks the default public
IPFS gateway (where your never-published update was never put) and then fails. The
`--cas-timeout 1000` just makes that miss return quickly on stage instead of waiting on a
slow gateway. The takeaway: only the parties you share the sidecar with can see what
changed. Bitcoin holds the commitment; you hold the contents.

---

## What to emphasize

- **No servers, no registrar, no lock-in.** Create offline, resolve from public Bitcoin
  infrastructure, self-custody the keys.
- **Bitcoin-grade integrity for the update history.** The version history is anchored to
  the most secure ledger there is.
- **Private by construction.** On-chain you commit a hash; the document and any PII stay
  off-chain and are shared selectively.
- **Authenticate once.** `keystore unlock` caches the passphrase for a session, so a run
  of key and DID commands is prompt-free without ever exporting the secret into the shell.
- **Standards-based.** The output is a W3C DID Core document; it drops into existing DID
  tooling.

---

## Appendix

### Output formats

`-o text` (default) is terse and human-friendly (it prints just the `data`); `-o json` is
clean and scriptable (it prints the full `{action, data}` envelope). Every command
supports both, and `BTCR2_OUTPUT` or `defaults.output` sets the default.

### Keystore and sessions

The `keystore` command group manages the encrypted store and the session unlock agent
(these never touch Bitcoin):

```bash
btcr2 keystore init                    # establish the keystore (encrypted; prompts + confirms). --dev for an unencrypted dev keystore
btcr2 keystore status                  # path, protection, key count, and session state (never decrypts or prompts)
btcr2 keystore unlock --ttl 2h         # cache the passphrase for a session (default 1h, max 24h; also $BTCR2_KEYSTORE_TTL)
btcr2 keystore lock                    # revoke the cached session (idempotent, needs no passphrase)
btcr2 keystore change-passphrase       # re-seal every key under a new passphrase
```

How the session works (ADR 081):

- `unlock` verifies the passphrase, then caches it in `<home>/session.json` (mode `0600`),
  bound to that keystore. Later signing/sealing commands consume it instead of prompting,
  until it expires or you `lock`. Passphrase precedence is: `BTCR2_KEYSTORE_PASSPHRASE`,
  then `--passphrase-file`, then a live session, then an interactive prompt, so unattended
  and CI paths always win over the cache.
- The cached passphrase is base64url-encoded, **not encrypted**: its only protection at
  rest is the `0600` file mode, so treat an unlocked machine accordingly. `lock` clears
  it, as do `change-passphrase` and any `init` that establishes a fresh keystore
  (`keystore init --force` is the way to re-establish over an existing one).
- **Mainnet is gated.** `unlock` refuses a `bitcoin` default network unless you pass
  `--allow-mainnet`, and even a session unlocked for testnet is withheld from a mainnet
  operation (it falls back to a per-use prompt). Mutinynet needs no flag.

**Encrypted vs dev keystores.** An encrypted keystore seals each secret with argon2id +
XChaCha20-Poly1305 under one passphrase and records a verifier, so a mistyped passphrase
fails loudly (`Incorrect passphrase`) instead of sealing a key under the wrong one. A
**dev keystore** (`--dev`) stores secrets in plaintext and never prompts: it is for
disposable testnet/regtest/signet/mutinynet keys only, and the CLI **hard-refuses** to
sign or generate a mainnet (`bitcoin`) key with one.

### Environment variables

Handy for pre-seeding attendee machines or unattended runs:

- `BTCR2_HOME` - relocate all state (same as `--home`).
- `BTCR2_KEYSTORE_PASSPHRASE` - supply the passphrase non-interactively (highest
  precedence, above `--passphrase-file` and any session).
- `BTCR2_KEYSTORE_TTL` - default `keystore unlock` lifetime (same as `--ttl`).
- Connection: `BTCR2_BTC_REST`, `BTCR2_CAS_GATEWAY`, `BTCR2_FEE_RATE`, and more.

See the README's environment-variable table for the complete set.

### Config and profiles

`btcr2 init` already created the config, so you rarely call `config init` directly.

```bash
btcr2 config set defaults.network mutinynet
btcr2 config list
btcr2 config path                         # show the resolved home, config, and keystore paths
btcr2 profile add client-demo
btcr2 profile use client-demo
```

`config list` illustrative output (a fresh config has one empty profile per network;
`defaults` starts with just `output` until you set more):

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

`config validate` checks a file, `config effective` shows resolved connection values with
their provenance (`flag`/`env`/`file`/`default`), and `config doctor` probes endpoint
reachability.

### Shell completion

```bash
eval "$(btcr2 completion bash)"           # or: zsh, fish
```

### Deactivate

`btcr2 deactivate` (alias `delete`) permanently and irreversibly retires a DID via the
same on-chain write path as `update` (same funding prerequisite, same signing: a live
session or a prompt). Do not run it against a DID you want to keep.

### Where your data lives

All CLI state lives in **one home directory**, holding `config.json`, `keystore.json`, and
(after `keystore unlock`) `session.json` side by side:

- Default: `~/.btcr2` on Linux/macOS, `%LOCALAPPDATA%\btcr2` on Windows.
- Override the whole home with `--home <dir>` (highest priority) or `$BTCR2_HOME`.
- `--config <path>` and `--keystore <path>` still override each file individually.
- `btcr2 config path` prints the resolved locations.

For a throwaway rehearsal that cannot touch your real state, point the home at a scratch
directory and delete it to reset:

```bash
btcr2 --home /tmp/btcr2-demo init --dev
# ...run the demo against /tmp/btcr2-demo...
rm -rf /tmp/btcr2-demo
```

### Troubleshooting

| Symptom | Cause and fix |
|---|---|
| `... is unfunded. Send BTC ...` | Fund the beacon address from the faucet, then retry. |
| `No spendable UTXO ... unconfirmed` | The faucet payment has not confirmed yet. Wait one block. |
| Faucet returns a rate-limit or captcha error | A shared room IP is being throttled. Stagger requests, or use a pre-funded beacon (see Step A). |
| `Signed update not found in CAS` | You resolved a DID that has an on-chain update without providing the sidecar. Pass it back with `-r '{"sidecar":{"updates":[...]}}'` (that is the privacy feature, not a bug). |
| `resolve` hangs | Check reachability to `https://mutinynet.com/api` (`btcr2 config doctor -n mutinynet`); override with `--btc-rest <url>` if needed. |
| `update`/`deactivate` does not prompt for a passphrase | Expected when a `keystore unlock` session is live, when `BTCR2_KEYSTORE_PASSPHRASE`/`--passphrase-file` is set, or with a dev keystore. Run `btcr2 keystore status` to inspect the session; `btcr2 keystore lock` forces the prompt back. |
| `Incorrect passphrase ...; no session was created` | The passphrase did not match the keystore verifier. Re-enter it, or rotate with `btcr2 keystore change-passphrase`. |
| `Refusing to unlock for a mainnet (bitcoin) context` | Unlocking a mainnet default suspends per-use auth. Pass `--allow-mainnet` to override, or keep the per-use prompt. |

### Command reference (quick)

```
btcr2 init [--dev] [--force]
btcr2 keystore init [--dev] [--force] | status | change-passphrase | unlock [--ttl <dur>] [--allow-mainnet] | lock
btcr2 key generate --name <n> --set-active
btcr2 key list|ls | show <ref> | use <ref> | import ... | export [--secret --out <path>] <ref> | delete|rm [--force] <ref>
btcr2 create [-t k|x] [-n <network>] [-b <hex>] [--signing-key <ref>]
btcr2 resolve|read -i <did> [-r <json>] [-p <path>]
btcr2 update -s <doc-json> --source-version-id <n> -p <patches-json> -m <vm-id> -b <beacon-id-json> [--publish-to-cas <mode>] [--fee-rate <n>] [--change-address <addr>]
btcr2 deactivate|delete -s <doc-json> --source-version-id <n> -m <vm-id> -b <beacon-id-json>
btcr2 config init | get [path] | set <path> <value> | unset <path> | list|ls | validate | effective | path | doctor
btcr2 profile add <name> | use <name> | show [name] | remove|rm <name>
btcr2 completion [bash|zsh|fish]
```
```
Global flags: -o json|text  --verbose  --quiet  --home <dir>  -c <config>  --profile <name>
              --keystore <path>  --passphrase-file <path>  --signing-key <ref>
              --btc-rest <url>  --btc-rpc-url <url>  --btc-rpc-user <u>  --btc-rpc-pass <p>
              --cas-gateway <url>  --cas-rpc-url <url>  --btc-timeout <ms>  --cas-timeout <ms>
```

See `btcr2 --help` (or the README's Global flags and Environment variables tables) for the
complete surface, including the RPC wallet/header and CAS publication flags.

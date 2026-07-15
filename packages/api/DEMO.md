# did:btcr2 API - Full Lifecycle Demo

A code-first walkthrough of the entire did:btcr2 lifecycle through the `@did-btcr2/api` SDK: create an identifier offline, resolve it live from Bitcoin, update it on-chain, prove the update is private, and deactivate it. It runs on **Mutinynet** (a public Bitcoin signet with 30-second blocks and a free faucet), so nothing here costs real money.

This is the developer-facing companion to the CLI walkthrough at [`../cli/DEMO.md`](../cli/DEMO.md): same narrative arc, but every step is a few lines of TypeScript instead of a shell command. The lifecycle code blocks in Parts 0-5 are lifted from the runnable script [`lib/e2e-full-lifecycle.ts`](./lib/e2e-full-lifecycle.ts), which executes the whole lifecycle end-to-end (see the Appendix). All output shown is illustrative: your identifiers, addresses, and txids will differ.

**How to follow along.** Three options, from least to most hands-on: (1) just read; (2) run the companion script, which pauses while you fund the beacon from the faucet; (3) paste the blocks into a `npx tsx` REPL top-to-bottom (top-level `await` works, and variables persist between blocks).

Targets `@did-btcr2/api` **v0.17.0**.

---

## The pitch (30 seconds)

1. **Creating an identifier is offline and instant.** No transaction, no fee, no registration: the DID exists the moment you compute it.
2. **Trust is anchored to Bitcoin.** Resolution reads the chain directly: no registrar, no server in the middle, nothing to shut down.
3. **Updates stay private.** An update commits a 32-byte hash to the chain; the change itself travels off-chain as a "sidecar" you hand to whoever should see it.

This demo shows all three.

---

## Part 0 - Setup

### Prerequisites

Node >= 22. The package is ESM-first; `tsx` is the easiest way to run TypeScript directly.

```bash
node --version   # should print >= 22, not "command not found"
npm install @did-btcr2/api @did-btcr2/key-manager tsx
```

### Construct the api

One facade object drives everything. Sub-facades (`api.kms`, `api.btc`, `api.cas`, `api.btcr2`) hang off it.

```typescript
import { createApi, DEFAULT_CAS_GATEWAY } from '@did-btcr2/api';

const api = createApi({
  btc : { network: 'mutinynet' },
  // Read-only public IPFS gateway. The short timeout keeps Part 4's
  // deliberate CAS miss snappy instead of hanging on a slow gateway.
  cas : { gateway: DEFAULT_CAS_GATEWAY, timeoutMs: 5_000 },
});
```

> **Lazy facades.** `api.btc`, `api.cas`, and `api.btcr2` instantiate on first access, and `api.btc` throws unless a `btc` config was passed to `createApi()`. Mutinynet needs no endpoint configuration: its REST default is already `https://mutinynet.com/api`.

---

## Part 1 - Own your keys

Generate a secp256k1 key. By default it lives in the bundled in-process `LocalKeyManager`; pass your own `KeyManager` implementation (AWS KMS, Vault, HSM) via `createApi({ kms })` and nothing else in this demo changes.

```typescript
const keyId = api.kms.generateKey({ setActive: true });
console.log(keyId);
// urn:kms:secp256k1:ca889f15082b4faf0367280f1fed15a2
```

Talking point: the secret never leaves the key manager. Everything downstream refers to the key by that id, and signing happens behind the `KeyManager` interface.

```typescript
// Optional backup of a throwaway testnet key. Throws if the backing
// KMS does not advertise canExport (external HSM adapters typically don't).
const backup = api.kms.export(keyId);
```

---

## Part 2 - Create an identifier (offline, instant)

A deterministic (`k`) DID is pure local computation over the compressed public key. No I/O happens on this line.

```typescript
const did = api.createDid('deterministic', api.kms.getPublicKey(keyId), { network: 'mutinynet' });
console.log(did);
// did:btcr2:k1q5p8rn...qy2kh3v
```

That string **is** the identifier. It was produced in milliseconds, with no fee and no server. (Every version-1 mutinynet `k` DID starts `did:btcr2:k1q5`: the network is encoded right there in the string.)

> **The network rides inside the identifier.** Pass `network: 'mutinynet'` here, or you mint a **mainnet** DID (`createDid`'s default network is `bitcoin`) and later resolve against the wrong chain. The `createApi` `btc.network` and the DID's network must agree.
>
> Shortcut: `api.generateDid({ network: 'mutinynet' })` does Parts 1 and 2 in one call and returns `{ did, keyId }`. Note its default network is `regtest`, not mainnet.

There are two identifier flavors: `k` (deterministic, encodes the public key itself) and `x` (external, encodes the hash of a full genesis document for multi-key or service-rich starts). This demo uses `k`; an `x` DID additionally needs its genesis document in the sidecar at resolution time.

---

## Part 3 - Resolve it (live, from Bitcoin)

Resolution reads beacon signals from the chain and materializes the W3C DID document. `tryResolveDid` returns a discriminated result instead of throwing.

```typescript
const v1 = await api.tryResolveDid(did);
if (!v1.ok) throw new Error(v1.errorMessage ?? v1.error);

console.log(v1.metadata?.versionId);   // '1' - no updates yet
console.log(v1.document);
```

Illustrative document (trimmed):

```json
{
  "@context": ["https://www.w3.org/ns/did/v1.1", "https://btcr2.dev/context/v1"],
  "id": "did:btcr2:k1q5p8rn...qy2kh3v",
  "verificationMethod": [{
    "id": "did:btcr2:k1q5p8rn...qy2kh3v#initialKey",
    "type": "Multikey",
    "controller": "did:btcr2:k1q5p8rn...qy2kh3v",
    "publicKeyMultibase": "zQ3s..."
  }],
  "service": [
    { "id": "...#initialP2PKH",  "type": "SingletonBeacon", "serviceEndpoint": "bitcoin:m..." },
    { "id": "...#initialP2WPKH", "type": "SingletonBeacon", "serviceEndpoint": "bitcoin:tb1q..." },
    { "id": "...#initialP2TR",   "type": "SingletonBeacon", "serviceEndpoint": "bitcoin:tb1p..." }
  ]
}
```

What to point at:

- **No server in the middle.** The api talked to a Bitcoin Esplora endpoint, not a DID registry.
- **Three beacon services exist the moment the DID does.** A beacon is a Bitcoin address whose transactions announce updates for this DID.
- `versionId: '1'`: this document has never been updated.

Grab the beacon we will fund in Part 4, and let the per-network presets (the same ones behind the CLI's funding hint) print the links:

```typescript
import { explorerAddressUrl, faucetUrl } from '@did-btcr2/api';

const beaconService = v1.document.service?.find((s) => s.id.endsWith('#initialP2WPKH'));
if (!beaconService) throw new Error('missing #initialP2WPKH beacon');
const beaconAddress = String(beaconService.serviceEndpoint).replace('bitcoin:', '');

console.log(`Beacon:   ${beaconAddress}`);
console.log(`Faucet:   ${faucetUrl('mutinynet')}`);
console.log(`Explorer: ${explorerAddressUrl('mutinynet', beaconAddress)}`);
// Beacon:   tb1qme9lfnkgcqcfu2v43k9w0fy0zj43z8gdgp2ank
// Faucet:   https://faucet.mutinynet.com/
// Explorer: https://mutinynet.com/address/tb1qme9lfnkgcqcfu2v43k9w0fy0zj43z8gdgp2ank
```

> The preset helpers return `undefined` on networks without a public faucet or explorer (regtest, and mainnet has no faucet), so guard the log lines if you parameterize the network.

---

## Part 4 - Update it on-chain

Here is what makes did:btcr2 different: an update writes only a **32-byte hash** into an OP_RETURN output at the beacon address. The document change itself never touches the chain: it travels off-chain as a signed "sidecar" you keep and share deliberately.

An update needs two things: a funded beacon address, and one confirmation.

### Step A - fund the beacon address

Open the faucet URL from Part 3, paste the beacon address, and request ~100,000 sats. Then wait for **1 confirmation** (about 30-60 seconds). You can poll for it:

```typescript
let utxos = await api.btc.getUtxos(beaconAddress);
while (!utxos.some((u) => u.status?.confirmed)) {
  await new Promise((r) => setTimeout(r, 5_000));
  utxos = await api.btc.getUtxos(beaconAddress);
}
console.log('beacon funded and confirmed');
```

> **Why wait for a confirmation?** The broadcast path deliberately refuses to spend an unconfirmed beacon UTXO (an unconfirmed input can be reorged or replaced, which would un-anchor your update). Update too early and you get `No spendable UTXO at beacon address: all 1 UTXO(s) are unconfirmed.` Wait one block and retry.

### Step B - broadcast the update

Wire a `Signer` to the key from Part 1 and apply a JSON Patch. `updateDid` constructs the signed update, checks the beacon funding, builds and signs the Bitcoin transaction, and broadcasts it.

```typescript
import { KeyManagerSigner } from '@did-btcr2/key-manager';
import { explorerTxUrl } from '@did-btcr2/api';

const signer = new KeyManagerSigner(api.kms.kms, keyId);

const update1 = await api.updateDid({
  did,
  patches              : [{ op: 'add', path: '/alsoKnownAs', value: ['https://example.com/demo'] }],
  verificationMethodId : `${did}#initialKey`,
  beaconId             : beaconService.id,
  signer,
});

console.log(update1.txid);
console.log(`Watch: ${explorerTxUrl('mutinynet', update1.txid)}`);

// KEEP THIS. It is the off-chain half of the update: the sidecar.
const signedUpdate = update1.signedUpdate;
```

- `sourceDocument` and `sourceVersionId` were omitted: `updateDid` resolves them itself, which works here because a fresh `k` DID resolves deterministically with no sidecar.
- `publishToCas` defaults to `'never'`: nothing about this update leaves your machine except the 32-byte hash in the transaction. That default is the privacy story of Step D.
- Prefer fluent chains? The same call is available as `api.btcr2.buildUpdate(...)`: see the Appendix.

### Step C - wait for the signal to confirm

Give the update transaction about 1 block (30-60 seconds on Mutinynet). Watch it at the `explorerTxUrl` link, or reuse the polling loop from Step A.

### Step D - resolve v2 (the reveal)

Hand the signed update back as a sidecar and resolve:

```typescript
const v2 = await api.tryResolveDid(did, { sidecar: { updates: [signedUpdate] } });
if (!v2.ok) throw new Error(v2.errorMessage ?? v2.error);

console.log(v2.metadata?.versionId);   // '2'
console.log(v2.document.alsoKnownAs);  // [ 'https://example.com/demo' ]
```

Same DID, version 2, patch applied, verified against the on-chain commitment.

**The privacy punchline.** Now resolve the same DID **without** the sidecar:

```typescript
try {
  await api.resolveDid(did);
} catch (err) {
  console.log((err as Error).message);
  // Failed to resolve DID: did:btcr2:k1q5p8rn...qy2kh3v
  console.log(((err as Error).cause as Error)?.message);
  // Signed update not found in CAS (hash: ...)
  // ...or, if the gateway stalls past the timeout instead of answering:
  // CAS operation timed out after 5000ms
}
```

The resolver found the on-chain update hash, looked for the update bytes in the sidecar (absent) and then in the configured CAS gateway (where your never-published update was never put), and failed. Either cause message is the same CAS miss. Bitcoin holds the commitment; you hold the contents. Only the parties you share the sidecar with can see what changed.

---

## Part 5 - Deactivate (prove it is gone)

> **Deactivation is permanent and irreversible.** It retires the DID through the same on-chain write path as an update. Do not run this against a DID you want to keep.

Deactivation **is** an update: a patch that sets `/deactivated` on the document. (The `api.btcr2.deactivate()` method is an unimplemented stub that throws; the patch below is the supported path, and it is exactly what the CLI's `deactivate` command does.)

No second faucet trip is needed: the update transaction in Part 4 returned its change to the beacon address, so the beacon still holds a confirmed UTXO.

```typescript
const update2 = await api.updateDid({
  did,
  patches              : [{ op: 'add', path: '/deactivated', value: true }],
  sourceDocument       : v2.document,
  sourceVersionId      : Number(v2.metadata?.versionId),
  verificationMethodId : `${did}#initialKey`,
  beaconId             : beaconService.id,
  signer,
});
console.log(update2.txid);
```

This time `sourceDocument` and `sourceVersionId` are explicit: auto-resolution cannot see version 2 without the sidecar (and `updateDid` takes none), but you are holding the v2 state from Step D. You are the source of truth for your own history: that is the model.

Wait one block, then resolve with the **full** update history in the sidecar:

```typescript
const final = await api.tryResolveDid(did, {
  sidecar : { updates: [signedUpdate, update2.signedUpdate] },
});
if (final.ok) {
  console.log(final.metadata?.versionId);     // '3'
  console.log(final.metadata?.deactivated);   // true
}

api.dispose();
```

The resolver applies both updates in block-height order, sees the document deactivate at version 3, and reports it in the metadata. The DID is retired, verifiably and forever.

---

## What to emphasize

- **No servers, no registrar, no lock-in.** Creation is local computation; resolution reads Bitcoin.
- **Bitcoin-grade integrity.** Every update is committed to the most attack-hardened ledger there is.
- **Private by construction.** On-chain observers see a 32-byte hash; the change travels only to whom you choose. The "error" in Step D is the feature.
- **Bring your own key custody.** Everything ran against the `KeyManager` interface: swap the bundled in-process store for an HSM or cloud KMS without touching the lifecycle code.
- **Standards-based.** The resolved document is a W3C DID Core document; the update proofs are W3C Data Integrity (`bip340-jcs-2025`).

---

## Appendix

### Run the whole lifecycle as one script

[`lib/e2e-full-lifecycle.ts`](./lib/e2e-full-lifecycle.ts) executes Parts 0-5 end-to-end and asserts every checkpoint (versionId 1 -> 2 -> 3, the applied patch, the expected CAS miss, the deactivation):

```bash
# Run from the monorepo root.

# Against Mutinynet: pauses while you fund the beacon from the faucet.
BITCOIN_NETWORK=mutinynet npx tsx packages/api/lib/e2e-full-lifecycle.ts

# Against a local regtest node (Polar defaults): fully automatic, no faucet.
npx tsx packages/api/lib/e2e-full-lifecycle.ts
```

Rough Mutinynet wall-clock: 3-5 minutes, dominated by two block confirmations and the faucet trip. On public networks the script persists the generated secret key to `lib/.e2e-keys/` (gitignored, mode 0600) so funds at the beacon address are recoverable.

### The fluent builder alternative

`UpdateBuilder` is the chainable form of `updateDid`. Unlike `updateDid`, it does not auto-resolve: version, verification method, beacon, and signer are explicit.

```typescript
const { signedUpdate, txid } = await api.btcr2
  .buildUpdate(sourceDocument)
  .patch({ op: 'add', path: '/alsoKnownAs', value: ['https://example.com/demo'] })
  .version(1)
  .verificationMethodId(`${did}#initialKey`)
  .beacon(`${did}#initialP2WPKH`)
  .signer(signer)
  .execute();
```

### Publishing to a CAS instead of carrying sidecars

If you would rather make an update publicly resolvable than privately shared, configure a **writable** CAS and opt in:

```typescript
const api = createApi({
  btc : { network: 'mutinynet' },
  cas : { rpcUrl: 'http://127.0.0.1:5001' },   // Kubo RPC: read-write
});

await api.updateDid({ /* ...as in Part 4... */ publishToCas: 'always' });
```

Modes: `'never'` (default: maximum privacy, sidecar-only), `'auto'` (best-effort: publishes when a writable CAS is configured, never blocks the broadcast), `'always'` (throws up-front if no writable CAS). Publication happens **before** the on-chain broadcast, so a published hash never dangles. Anyone can then resolve your DID without a sidecar, which is exactly the privacy trade you are opting into.

### Troubleshooting

| Symptom | Cause and fix |
|---|---|
| `api.btc` throws `Bitcoin not configured` | Pass a `btc` config to `createApi()`, e.g. `createApi({ btc: { network: 'mutinynet' } })`. |
| `Beacon address ... is unfunded. Send BTC to this address before broadcasting the update.` | The faucet step was skipped or the funding tx has not landed. Fund the beacon and wait for it to be indexed. |
| `No spendable UTXO at beacon address: all N UTXO(s) are unconfirmed.` | Deliberate reorg/RBF safety. Wait one block (~30s on Mutinynet) and retry. |
| `Failed to resolve DID ...` with cause `Signed update not found in CAS (hash: ...)` | You resolved a DID that has an on-chain update without providing the sidecar. Pass `{ sidecar: { updates: [...] } }`: that is the privacy feature, not a bug. |
| Resolve hangs | Check reachability to `https://mutinynet.com/api`; override with `btc: { rest: { host: '<url>' } }`. Slow CAS lookups are bounded by `cas.timeoutMs`. |
| Updates broadcast but resolve never sees them | Network mismatch: the DID's encoded network and `createApi`'s `btc.network` must agree. Decode with `api.did.decode(did)` to check. |
| `api.btcr2.deactivate()` throws `NotImplementedError` | Expected: deactivation is expressed as an update with an `add /deactivated true` patch (Part 5). |

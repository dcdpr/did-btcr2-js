# did:btcr2 API walkthrough

This walkthrough shows the full lifecycle of an identifier through the `@did-btcr2/api` SDK. You create an identifier offline, resolve it from Bitcoin, update it on-chain, and deactivate it. Each step is a short block of TypeScript. The walkthrough runs on **mutinynet**, a public Bitcoin signet with 30-second blocks and a free faucet. No step costs real money.

The [CLI walkthrough](../../cli/docs/DEMO.md) shows the same lifecycle with the `btcr2` command-line tool. The script [`lib/e2e-full-lifecycle.ts`](../lib/e2e-full-lifecycle.ts) runs the same lifecycle from start to end, and it checks each result. See [Run the companion script](#run-the-companion-script).

**How to use this document:** put the code blocks of Parts 0 to 5 in one file, in the order of this document. The file stops in Part 4 until you fund the beacon address. The blocks of the appendix are alternatives, so do not add them to the file. Each output block is an example. Your keys, identifiers, Bitcoin addresses, and transaction ids differ, but the shape is the same.

The text matches `@did-btcr2/api` v0.29.0.

---

## What the walkthrough shows

1. **Creation is offline.** An identifier needs no transaction, no fee, and no registration. The identifier exists when you compute it.
2. **Bitcoin is the anchor of trust.** Resolution reads the chain directly. No registrar and no server stand between you and the data.
3. **Updates stay private.** An update puts a 32-byte hash on the chain. The change itself stays off-chain as sidecar data, and only the parties that you choose get it.
4. **You choose the key custody.** Each step uses the `KeyManager` interface. An HSM or a cloud KMS can replace the bundled key manager, and the lifecycle code does not change.
5. **The data follows W3C standards.** Resolution returns a W3C DID Core document. The update proofs are W3C Data Integrity proofs (`bip340-jcs-2025`).

---

## Part 0: Setup

### Prerequisites

Before the first step, make sure that you have:

- **Node.js 22 or newer.** The package is ESM first.
- **A TypeScript runner**, for example Bun or `tsx`.

```bash
node --version    # must print v22 or newer
npm install @did-btcr2/api
```

Put the blocks in a file with the `.mts` extension, for example `walkthrough.mts`. The extension makes the file an ES module, so the top-level `await` works. Run the file:

```bash
bun walkthrough.mts          # or: npx tsx walkthrough.mts
```

### Make the api object

One object gives access to each function. Its sub-facades are `api.kms`, `api.did`, `api.crypto`, `api.btc`, `api.cas`, and `api.btcr2`.

```typescript
import { createApi, DEFAULT_CAS_GATEWAY } from '@did-btcr2/api';

const api = createApi({
  btc : { network: 'mutinynet' },
  // A read-only public IPFS gateway. The short timeout makes the
  // CAS read of Part 4 fail fast if the gateway does not answer.
  cas : { gateway: DEFAULT_CAS_GATEWAY, timeoutMs: 5_000 },
});
```

> **Note:** the api makes `api.btc`, `api.cas`, and `api.btcr2` at the first access. `api.btc` throws if `createApi()` got no `btc` config. Mutinynet needs no endpoint config, because its default REST endpoint is `https://mutinynet.com/api`. Without a `cas` config, the api reads through the same public gateway, with a timeout of 30 seconds.

---

## Part 1: Your keys

Generate a secp256k1 key. The key goes into the bundled in-process `LocalKeyManager`. To keep your keys in an HSM, a cloud KMS, or a vault, give your own `KeyManager` implementation to `createApi({ kms })`. The other steps do not change.

```typescript
const keyId = api.kms.generateKey({ setActive: true });
console.log(keyId);
// urn:kms:secp256k1:ca889f15082b4faf0367280f1fed15a2
```

The secret key stays in the key manager. The next steps use the key id only, and the key manager makes the signatures behind the `KeyManager` interface.

Export a backup of the key, so that you can recover the coins at the beacon address later. `export` throws if the key manager does not declare `canExport`. An external HSM adapter usually does not declare it.

```typescript
const backup = api.kms.export(keyId);
```

---

## Part 2: Create an identifier (offline)

A deterministic (`k`) identifier is a local computation over the compressed public key. This line does no I/O.

```typescript
const did = api.createDid('deterministic', api.kms.getPublicKey(keyId));
console.log(did);
// did:btcr2:k1q5p8rn...qy2kh3v
```

That string **is** the identifier. The computation takes milliseconds, with no fee and no server. Each version-1 mutinynet `k` identifier starts with `did:btcr2:k1q5`, because the identifier encodes the network.

> **Note:** the identifier names its network. `createDid` makes the identifier for the network of the `btc` connection, here mutinynet. With no `btc` config, the api makes a `regtest` identifier, never a mainnet identifier. To choose another network, give `{ network }` as the third argument. The identifier and the connection must name the same network. `resolveDid` and `updateDid` refuse a mismatch before any chain read.
>
> `api.generateDid()` does Parts 1 and 2 in one call and returns `{ did, keyId }`. It uses the same network default.

There are two identifier types. A `k` (deterministic) identifier encodes the public key. An `x` (external) identifier encodes the hash of a genesis document, for a start with more keys or services. This walkthrough uses `k`. The resolution of an `x` identifier also needs the genesis document, from the sidecar data or from a CAS.

### Get the beacon address before the first transaction

The initial DID document of a `k` identifier is a function of the key only. The api computes it with no I/O, and it lists the beacons with their Bitcoin addresses. Part 4 funds the `#initialP2WPKH` beacon. The network presets give the faucet and explorer links. The CLI uses the same presets for its funding hint.

```typescript
import { explorerAddressUrl, faucetUrl } from '@did-btcr2/api';

const beacons = api.btcr2.getBeacons(api.btcr2.getInitialDocument(did));
const beacon = beacons.find((b) => b.id.endsWith('#initialP2WPKH'));
if (!beacon) throw new Error('missing #initialP2WPKH beacon');
const beaconAddress = beacon.address;

console.log(`Beacon:   ${beaconAddress}`);
console.log(`Faucet:   ${faucetUrl('mutinynet')}`);
console.log(`Explorer: ${explorerAddressUrl('mutinynet', beaconAddress)}`);
// Beacon:   tb1qme9lfnkgcqcfu2v43k9w0fy0zj43z8gdgp2ank
// Faucet:   https://faucet.mutinynet.com/
// Explorer: https://mutinynet.com/address/tb1qme9lfnkgcqcfu2v43k9w0fy0zj43z8gdgp2ank
```

The preset functions return `undefined` on a network with no public faucet or explorer. Regtest has neither, and mainnet has no faucet. If your code takes the network as a parameter, check for `undefined`.

---

## Part 3: Resolve the identifier (from Bitcoin)

Resolution reads the beacon signals from the chain and makes the W3C DID document. `tryResolveDid` returns a result object and does not throw.

```typescript
const v1 = await api.tryResolveDid(did);
if (!v1.ok) throw new Error(v1.errorMessage ?? v1.error);

console.log(v1.metadata?.versionId);      // '1': no update yet
console.log(v1.metadata?.confirmations);  // 0: the resolver applied no update
console.log(JSON.stringify(v1.document, null, 2));
```

Example DID document (shortened):

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

Points to note:

- **No server stands between you and the chain.** The api read a Bitcoin Esplora endpoint, not a DID registry. This is the default mode `btc.signalDiscovery: 'indexer'`. The `'fullnode'` mode scans the blocks over Bitcoin Core RPC. It needs an `rpc` config and `-txindex=1`, and it is practical only on regtest.
- **The identifier has three beacons from the start.** They are the beacons that `getBeacons` listed in Part 2. A beacon is a Bitcoin address whose transactions announce the updates of the identifier.
- **`versionId` is `'1'`.** Nobody updated this DID document.

---

## Part 4: Update the identifier on-chain

An update writes only a **32-byte hash** into an `OP_RETURN` output of a transaction from the beacon address. The change itself never goes on the chain. It stays off-chain as a signed update: sidecar data that you keep and give only to the parties that must see it.

An update needs a funded beacon address with one confirmation.

### Step A: fund the beacon address

1. Open the faucet link of Part 2.
2. Paste the beacon address and ask for about 100,000 sats.
3. Wait for **1 confirmation**, about 30 to 60 seconds. This loop does the wait:

```typescript
let utxos = await api.btc.getUtxos(beaconAddress);
while (!utxos.some((u) => u.status.confirmed)) {
  await new Promise((r) => setTimeout(r, 5_000));
  utxos = await api.btc.getUtxos(beaconAddress);
}
console.log('beacon funded and confirmed');
```

> **Note:** the api spends only a confirmed beacon UTXO above the dust limit. Another transaction can replace an unconfirmed input. A block reorganization can also remove it. Then the update has no anchor. If the UTXO has no confirmation, the api refuses the update before it publishes or broadcasts anything:
>
> `Beacon address tb1q... cannot fund this update. No spendable UTXO at beacon address: all 1 UTXO(s) are unconfirmed. Wait for a confirmation, or fund the address above the dust limit, before you broadcast the update.`
>
> Wait one block, then try again.

### Step B: broadcast the update

Get a `Signer` for the key of Part 1, and apply a JSON Patch. `updateDid` resolves the current DID document and makes the signed update. Then it checks the beacon funds, signs the Bitcoin transaction, and broadcasts it.

```typescript
import { explorerTxUrl } from '@did-btcr2/api';

const signer = api.kms.signer(keyId);

const update1 = await api.updateDid(
  did,
  [{ op: 'add', path: '/alsoKnownAs', value: ['https://example.com/demo'] }],
  signer,
);

console.log(update1.txid);
console.log(`Watch: ${explorerTxUrl('mutinynet', update1.txid)}`);

// Keep the signed update. It is the off-chain half of the update: the sidecar data.
const signedUpdate = update1.signedUpdate;
```

- The arguments follow the update operation of the specification: the source, the JSON Patch, and the signer. A fourth argument holds the options.
- The code gives no `verificationMethodId` and no `announce.beaconId`, so the api finds them. The verification method is the one that has the key of the signer. The beacon is the one whose address holds a spendable UTXO: `#initialP2WPKH`, the beacon that you funded. To choose them yourself, see [Name the verification method and the beacon](#name-the-verification-method-and-the-beacon).
- `api.kms.signer(keyId)` gives the signer. The same call works with an external `KeyManager` from `createApi({ kms })`.
- The source is the identifier, so `updateDid` resolves it first. A new `k` identifier resolves with no sidecar data.
- `announce.publishToCas` is `'never'` by default. Only the 32-byte hash in the transaction leaves your machine. The last step of this part shows the result.

### Step C: wait for the confirmation

The update transaction needs one confirmation, about 30 to 60 seconds on mutinynet. Watch it at the explorer link, or let this function do the wait:

```typescript
async function waitForConfirmation(txid: string): Promise<void> {
  for (;;) {
    const tx = await api.btc.getTransaction(txid).catch(() => undefined);
    if (tx?.status.confirmed) return;
    await new Promise((r) => setTimeout(r, 5_000));
  }
}

await waitForConfirmation(update1.txid);
```

The Esplora endpoint can return an error for some seconds after the broadcast. The `catch` makes the loop try again.

### Step D: resolve version 2

Give the signed update back as sidecar data, and resolve:

```typescript
const v2 = await api.tryResolveDid(did, { sidecar: { updates: [signedUpdate] }, minConf: 1 });
if (!v2.ok) throw new Error(v2.errorMessage ?? v2.error);

console.log(v2.metadata?.versionId);       // '2'
console.log(v2.metadata?.confirmations);   // 1 or more: the depth that the resolver saw
console.log(v2.document.alsoKnownAs);      // [ 'https://example.com/demo' ]
```

The same identifier is now at version 2. The resolver applied the patch and checked it against the hash on the chain.

> **Note:** `minConf: 1` lowers the confirmation threshold. The specification tells a resolver to apply a beacon signal only after six confirmations, and `DEFAULT_MIN_CONF` is `6`. Without the option, the same call returns version 1 until six blocks are on top of the update. That takes about three minutes on mutinynet. A signal with one confirmation is less safe from a block reorganization. `metadata.confirmations` shows the depth, so a consumer can decide. Each resolve below uses the same value.

### Resolve without the sidecar data

Resolve the same identifier **without** the sidecar data:

```typescript
try {
  await api.resolveDid(did, { minConf: 1 });
} catch (err) {
  console.log((err as Error).message);
  // Failed to resolve DID did:btcr2:k1q5p8rn...qy2kh3v: Signed update not found in CAS (hash: ...)
  // If the gateway does not answer before the timeout:
  // Failed to resolve DID did:btcr2:k1q5p8rn...qy2kh3v: CAS operation timed out after 5000ms
}
```

The resolver finds the update hash on the chain. It looks for the signed update in the sidecar data, but the sidecar data is empty. Then it looks in the CAS gateway, but nobody published the update there. So resolution fails. The two messages show the same CAS miss.

Bitcoin holds the hash, and you hold the content. Only the parties that get the sidecar data from you can see the change. The message gives the root cause, and `err.cause` holds the original error. `tryResolveDid` returns the root cause in `errorMessage`, the DID Resolution error code in `error`, and the original error in `cause`.

---

## Part 5: Deactivate the identifier

> **Warning:** deactivation is permanent. You cannot undo it. Do not deactivate an identifier that you want to keep.

A deactivation **is** an update. `deactivateDid` broadcasts an update with the deactivation patch `DidMethodApi.DEACTIVATION_PATCH` (`add /deactivated true`). It uses the same signature, publication, and broadcast path as `updateDid`.

You do not need the faucet again. The update transaction of Part 4 sent its change back to the beacon address, so the beacon address still holds a confirmed UTXO.

```typescript
const update2 = await api.deactivateDid(did, signer, {
  resolutionOptions : { sidecar: { updates: [signedUpdate] }, minConf: 1 },
});
console.log(update2.txid);

await waitForConfirmation(update2.txid);
```

The resolution inside `deactivateDid` needs the sidecar data, because without it the api cannot see version 2. `resolutionOptions` gives the sidecar data and the same `minConf: 1` as Step D to that resolution. You hold the update history, so you supply it. As an alternative, give a resolved state `{ document, versionId }` as the source. Then the api does not resolve.

Resolve with the **full** update history in the sidecar data:

```typescript
const final = await api.tryResolveDid(did, {
  sidecar : { updates: [signedUpdate, update2.signedUpdate] },
  minConf : 1,
});
if (final.ok) {
  console.log(final.metadata?.versionId);     // '3'
  console.log(final.metadata?.deactivated);   // true
}
```

The resolver applies the two updates in the order of their block heights. The DID document is deactivated at version 3, and the metadata shows it.

The identifier takes no further update. The api refuses an update before any signature:

```typescript
if (final.ok) {
  await api.updateDid({ document: final.document, versionId: 3 }, [], signer)
    .catch((err) => console.log((err as Error).message));
  // DID document did:btcr2:k1q5p8rn...qy2kh3v is deactivated and cannot be updated. Deactivation is irreversible: ...
}

api.dispose();
```

---

## Appendix

### Run the companion script

[`lib/e2e-full-lifecycle.ts`](../lib/e2e-full-lifecycle.ts) runs Parts 0 to 5 from start to end. It checks each result: the versions 1, 2, and 3, the applied patch, the CAS miss, and the deactivation. Run it from the monorepo root:

```bash
# On mutinynet: the script stops for the faucet and for each confirmation.
BITCOIN_NETWORK=mutinynet bun packages/api/lib/e2e-full-lifecycle.ts

# On a local regtest node: no faucet and no stops. The script needs the
# bitcoind RPC (Polar defaults) and an Esplora REST endpoint on localhost:3000.
bun packages/api/lib/e2e-full-lifecycle.ts
```

- On mutinynet, the run takes 3 to 5 minutes. Most of the time goes to three confirmations (the funding, the update, and the deactivation) and to the faucet.
- `E2E_MIN_CONF` sets the `minConf` of each resolve. The default is 1 on a public network and 6 on regtest.
- On a public network, the script writes the secret key to `lib/.e2e-keys/` with file mode 0600, so you can recover the coins at the beacon address. Git ignores the directory.

### Name the verification method and the beacon

`api.btcr2.update` takes the same arguments as `updateDid`, but it does not resolve. The source must be a resolved state: the DID document and its `versionId`. The `versionId` must come from the resolution that returned the DID document.

This block replaces Step B. It uses the DID document that Part 3 resolved at version 1, and it names the two ids:

```typescript
const { signedUpdate, txid } = await api.btcr2.update(
  { document: v1.document, versionId: 1 },
  [{ op: 'add', path: '/alsoKnownAs', value: ['https://example.com/demo'] }],
  signer,
  {
    verificationMethodId : `${did}#initialKey`,
    announce             : { beaconId: `${did}#initialP2WPKH` },
  },
);
```

### Publish updates to a CAS

If everybody must be able to resolve an update, publish it to a **writable** CAS. Then a resolver finds the signed update without sidecar data. That is the privacy cost that you accept. Give an IPFS HTTP RPC endpoint, for example a Kubo node, and set the publication policy:

```typescript
import type { PatchOperation } from '@did-btcr2/api';

const api = createApi({
  btc : { network: 'mutinynet' },
  cas : { rpcUrl: 'http://127.0.0.1:5001' },   // a local Kubo node: read and write
});

const patch: PatchOperation[] = [{ op: 'add', path: '/alsoKnownAs', value: ['https://example.com/demo'] }];
const result = await api.updateDid(did, patch, signer, { announce: { publishToCas: 'always' } });
console.log(result.publishedToCas);   // { update: true, announcement: false }
```

`publishedToCas.announcement` applies only to a CAS beacon.

The three policies:

- `'never'` (default): the api publishes nothing. You give the signed update to other parties as sidecar data.
- `'auto'`: the api publishes if a writable CAS is configured. If no writable CAS is configured, the api skips the publication and continues.
- `'always'`: a writable CAS is necessary. If the CAS is read-only or absent, the api throws before any signature or spend.

The api publishes before the broadcast. If the publication fails, the update stops before the broadcast, with `'auto'` and with `'always'`. The beacon UTXO stays unspent, so you can correct the problem and try again. So a hash on the chain always has its content in the CAS.

#### An IPFS node behind HTTP Basic auth

A public IPFS node usually puts its RPC API behind a reverse proxy with HTTP Basic auth, because the RPC API also has administration calls. Give the credentials in `cas.rpcAuth`. The api sends them with each RPC request: the reads, the writes, and `api.cas.probe()`.

```typescript
const password = process.env.IPFS_RPC_PASSWORD;
if (!password) throw new Error('Set IPFS_RPC_PASSWORD');

const api = createApi({
  btc : { network: 'mutinynet' },
  cas : {
    rpcUrl  : 'https://ipfs.example.com',
    rpcAuth : { username: 'btcr2', password },
  },
});

// Read a fixed block through the node. This throws if the node refuses the credentials.
await api.cas.probe();

await api.updateDid(did, patch, signer, { announce: { publishToCas: 'always' } });
```

- Keep the password out of the source code. This example reads it from an environment variable.
- `rpcAuth` applies only to `rpcUrl`. A `gateway` or a `blockstore` does not use it.
- `api.cas.probe()` does not write. So it cannot prove that the node accepts a write.
- The CLI takes the same credentials from its config file. See [the CLI update page](../../cli/docs/update.md#publish-through-an-ipfs-node-with-http-basic-auth).

### Troubleshooting

| Symptom | Cause and fix |
|---|---|
| `api.btc` throws `Bitcoin not configured.` | `createApi()` got no `btc` config. Give one, for example `createApi({ btc: { network: 'mutinynet' } })`. |
| `Beacon address ... is unfunded. Send BTC to this address before broadcasting the update.` | The beacon address has no UTXO. Do Step A of Part 4, and wait until the Esplora endpoint shows the funding transaction. |
| `Beacon address ... cannot fund this update. No spendable UTXO at beacon address: all N UTXO(s) are unconfirmed. ...` | The api spends only a confirmed UTXO, so that a replacement or a reorganization cannot remove the input. The api refuses before it publishes or broadcasts. Wait one block (about 30 seconds on mutinynet) and try again. The same message shows a UTXO at or below the dust limit of 546 sats. |
| `No beacon of DID ... holds a spendable UTXO. The api cannot derive beaconId.` | The code gave no `announce.beaconId`, and no beacon address holds a confirmed UTXO above the dust limit. Fund one beacon address (Step A of Part 4), or give `announce.beaconId`. |
| `N beacons of DID ... hold a spendable UTXO: ... Pass beaconId to choose which one spends.` | You funded more than one beacon address. Give `announce.beaconId`. The api does not choose a UTXO for you. |
| `No verification method on DID ... publishes the signer's key.` | The key of the signer is not in the DID document. Sign with the key of Part 1, or give `verificationMethodId`. |
| `No key id given and no active key set.` | `api.kms.signer()` with no key id needs an active key. Part 1 sets one with `setActive: true`. As an alternative, give the key id. |
| `Failed to resolve DID <did>: Signed update not found in CAS (hash: ...)` | The identifier has an update on the chain, and the call gave no sidecar data. Give `{ sidecar: { updates: [...] } }`. This is the privacy property of did:btcr2, not a defect. `tryResolveDid` returns the same text in `errorMessage`. |
| A resolve returns the old version, with no error | The update transaction has less than six confirmations, and the default `minConf` excludes it. Wait for six blocks, or give `{ minConf: 1 }` as this walkthrough does. |
| `Failed to resolve DID <did>: Invalid resolution option minConf: ...` | `minConf` is not a positive integer. Give `1` or more, or omit it for the default of `6`. |
| `Failed to resolve DID <did>: Invalid update: verificationMethod is not authorized for capabilityInvocation` | Resolution applies only an update that a key in `capabilityInvocation` signed. Sign with an authorized verification method. `#initialKey` is authorized by default, so this walkthrough does not get this error. |
| `publishToCas is 'always' but the configured CAS is read-only (e.g. an HTTP gateway). ...` | A gateway cannot write. Give `cas.rpcUrl`, `cas.blockstore`, or a custom `cas.executor` with a `publish` function. |
| `IPFS RPC block/put failed: 401 ...` | The IPFS node refused the credentials, or `cas.rpcAuth` is absent. Correct `cas.rpcAuth` and try again. The update stopped before the broadcast, so the beacon UTXO is not spent. |
| A resolve does not end | Make sure that `https://mutinynet.com/api` answers. To use another Esplora endpoint, give `btc: { rest: { host: '<url>' } }`. `cas.timeoutMs` limits a slow CAS read. |
| `The DID names the network "X", but the Bitcoin connection targets "Y".` | The identifier and the `btc.network` of `createApi` name different networks. The api refuses before any chain read, for a resolve and for an update. An update shows `DID ... names the network` at the start. Make the api with the network of the identifier. `api.did.decode(did).network` shows it. |
| `DID document ... is deactivated and cannot be updated.` | This is correct after Part 5, because a deactivation is permanent. A second `deactivateDid` gets the message `is already deactivated`. |

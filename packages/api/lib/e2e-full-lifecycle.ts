/**
 * E2E: the full did:btcr2 lifecycle through the DidBtcr2Api facade.
 *
 * Companion to packages/api/DEMO.md: the DEMO's code blocks are lifted from
 * this file, so a green run here is the proof that the walkthrough works.
 *
 * Drives, in order:
 *   1. createApi with a live Bitcoin connection (+ read-only CAS gateway)
 *   2. api.kms.generateKey - key custody stays in the bundled LocalKeyManager
 *   3. api.createDid - offline, deterministic (KEY / k-HRP)
 *   4. api.tryResolveDid - initial document, versionId 1, beacon services
 *   5. fund the #initialP2WPKH beacon (regtest: automatic; public: faucet)
 *   6. api.updateDid - JSON Patch broadcast via the singleton beacon
 *   7. resolve v2 WITH the sidecar, then WITHOUT it (the expected CAS miss)
 *   8. deactivate: updateDid with an add-/deactivated patch, spending the
 *      change output the first update returned to the beacon address
 *   9. final resolve: deactivated true, versionId 3
 *
 * Env:
 *   BITCOIN_NETWORK   default: regtest (set mutinynet for the DEMO.md path)
 *
 * Usage:
 *   npx tsx packages/api/lib/e2e-full-lifecycle.ts
 *   BITCOIN_NETWORK=mutinynet npx tsx packages/api/lib/e2e-full-lifecycle.ts
 *
 * Exit code: 0 on success, non-zero on any assertion failure.
 *
 * Note: step 7's sidecar-less resolve deliberately reaches the public IPFS
 * gateway (and fails); that step needs outbound internet even on regtest.
 */
import assert from 'node:assert/strict';
import { createApi, DEFAULT_CAS_GATEWAY, explorerTxUrl } from '@did-btcr2/api';
import { KeyManagerSigner } from '@did-btcr2/key-manager';
import { confirmBroadcast, fundBeacon, parseNetworkEnv, persistKey, utxoTimeoutMs, waitForUtxo } from './_e2e-helpers.js';

const NETWORK = parseNetworkEnv();

console.log(`E2E: full did:btcr2 lifecycle against ${NETWORK}\n`);

// ─── Step 1: Build the api with a live Bitcoin connection ───────────────────

// The short CAS timeout keeps step 7's deliberate gateway miss snappy.
const api = createApi({
  btc : NETWORK === 'regtest'
    ? { network: NETWORK, rpc: { username: 'polaruser', password: 'polarpass' } }
    : { network: NETWORK },
  cas : { gateway: DEFAULT_CAS_GATEWAY, timeoutMs: 5_000 },
});

console.log(`[1] api initialized, height: ${await api.btc.rest.block.count()}`);

// ─── Step 2: Generate a key in the KMS ───────────────────────────────────────

const keyId = api.kms.generateKey({ setActive: true });
const signer = new KeyManagerSigner(api.kms.kms, keyId);
console.log(`[2] Key: ${keyId}`);

// ─── Step 3: Create the DID (offline, instant, free) ────────────────────────

const did = api.createDid('deterministic', api.kms.getPublicKey(keyId), { network: NETWORK });
console.log(`[3] DID: ${did}`);

// ─── Step 4: Resolve v1 + locate the beacon ──────────────────────────────────

const v1 = await api.tryResolveDid(did);
if (!v1.ok) throw new Error(`Initial resolve failed: ${v1.errorMessage ?? v1.error}`);
assert.equal(v1.metadata?.versionId, '1', 'fresh DID should resolve at version 1');

const beaconService = v1.document.service?.find((s) => s.id.endsWith('#initialP2WPKH'));
assert.ok(beaconService, 'initial document should carry the #initialP2WPKH beacon service');
const beaconAddress = String(beaconService.serviceEndpoint).replace('bitcoin:', '');
console.log(`[4] Resolved v1; beacon address: ${beaconAddress}`);

persistKey({
  network        : NETWORK,
  did,
  secretKeyBytes : api.kms.export(keyId).raw.secret!,
  pubkeyBytes    : api.kms.getPublicKey(keyId),
  beaconAddress,
  label          : 'full-lifecycle',
});

// ─── Step 5: Fund the beacon address ─────────────────────────────────────────

console.log(`\n[5] Funding ${beaconAddress} ...`);
const { minerAddr } = await fundBeacon({ beaconAddress, bitcoin: api.btc.connection, network: NETWORK });
console.log('    funded + confirmed + indexed');

// ─── Step 6: Update on-chain (add an alsoKnownAs) ────────────────────────────

// sourceDocument/sourceVersionId omitted: updateDid resolves them itself, which
// works here because a fresh KEY DID resolves deterministically (no sidecar).
console.log('\n[6] Broadcasting update v1 -> v2 ...');
const update1 = await api.updateDid({
  did,
  patches              : [{ op: 'add', path: '/alsoKnownAs', value: ['https://example.com/demo'] }],
  verificationMethodId : `${did}#initialKey`,
  beaconId             : beaconService.id,
  signer,
});
console.log(`    broadcast (targetVersionId: ${update1.signedUpdate.targetVersionId}, txid: ${update1.txid})`);
const watch = explorerTxUrl(NETWORK, update1.txid);
if (watch) console.log(`    watch: ${watch}`);

await confirmBroadcast({ bitcoin: api.btc.connection, network: NETWORK, minerAddr, watchAddress: beaconAddress });

// ─── Step 7: Resolve v2 - with the sidecar, then without ─────────────────────

const v2 = await api.tryResolveDid(did, { sidecar: { updates: [update1.signedUpdate] } });
if (!v2.ok) throw new Error(`v2 resolve failed: ${v2.errorMessage ?? v2.error}`);
assert.equal(v2.metadata?.versionId, '2', 'sidecar resolve should reach version 2');
assert.deepEqual(v2.document.alsoKnownAs, ['https://example.com/demo'], 'patch should be applied');
console.log('\n[7] Resolved v2 with the sidecar ✓');

// The privacy property: without the sidecar the update bytes are nowhere to be
// found (Bitcoin only holds the 32-byte hash), so resolution MUST fail.
let sidecarlessError: Error | undefined;
try {
  await api.resolveDid(did);
} catch (err) {
  sidecarlessError = err as Error;
}
assert.ok(sidecarlessError, 'sidecar-less resolve should fail: the update was never published');
const cause = sidecarlessError.cause as Error | undefined;
console.log(`    without it: "${(cause ?? sidecarlessError).message}" ✓`);

// ─── Step 8: Deactivate (an update whose patch sets /deactivated) ────────────

// The update tx returned its change to the beacon address, so the beacon is
// still funded; we only need that change output confirmed and indexed.
await waitForUtxo(beaconAddress, api.btc.connection, {
  requireConfirmed : true,
  timeoutMs        : utxoTimeoutMs(NETWORK),
});

console.log('\n[8] Broadcasting deactivation v2 -> v3 ...');
const update2 = await api.updateDid({
  did,
  patches              : [{ op: 'add', path: '/deactivated', value: true }],
  sourceDocument       : v2.document,
  sourceVersionId      : Number(v2.metadata?.versionId),
  verificationMethodId : `${did}#initialKey`,
  beaconId             : beaconService.id,
  signer,
});
console.log(`    broadcast (targetVersionId: ${update2.signedUpdate.targetVersionId}, txid: ${update2.txid})`);

await confirmBroadcast({ bitcoin: api.btc.connection, network: NETWORK, minerAddr, watchAddress: beaconAddress });

// ─── Step 9: Final resolve - both updates in the sidecar ─────────────────────

const final = await api.tryResolveDid(did, {
  sidecar : { updates: [update1.signedUpdate, update2.signedUpdate] },
});
if (!final.ok) throw new Error(`Final resolve failed: ${final.errorMessage ?? final.error}`);
assert.equal(final.metadata?.versionId, '3', 'deactivation should land as version 3');
assert.equal(final.metadata?.deactivated, true, 'metadata should report the DID deactivated');
console.log('\n[9] Resolved v3: deactivated ✓');

api.dispose();

console.log(`\n══ E2E PASSED (full lifecycle / ${NETWORK}) ══`);
console.log(`  DID:    ${did}`);
console.log(`  update: ${update1.txid}`);
console.log(`  retire: ${update2.txid}`);
process.exit(0);

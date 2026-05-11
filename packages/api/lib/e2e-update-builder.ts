/**
 * E2E: DidBtcr2Api.buildUpdate(...).signer(...).execute() against a live Bitcoin node.
 *
 * Drives the full high-level api facade end-to-end:
 *   - `DidBtcr2Api` configured with a live Bitcoin connection
 *   - `UpdateBuilder` fluent chain ending in `.signer(LocalSigner).execute()`
 *   - The Updater state machine + Beacon broadcast wired together via the api
 *
 * This catches wiring bugs between UpdateBuilder, DidMethodApi.update, the
 * Updater state machine, and the Beacon broadcast pipeline that the unit-level
 * tests can't see.
 *
 * Env:
 *   BITCOIN_NETWORK   default: regtest
 *   BEACON_KIND       default: p2pkh — one of p2pkh|p2wpkh|p2tr
 *
 * Usage:
 *   npx tsx packages/api/lib/e2e-update-builder.ts
 *   BEACON_KIND=p2tr npx tsx packages/api/lib/e2e-update-builder.ts
 *
 * Exit code: 0 on success, non-zero on any assertion failure.
 */
import assert from 'node:assert/strict';
import { DidBtcr2Api } from '@did-btcr2/api';
import { canonicalHash } from '@did-btcr2/common';
import { SchnorrMultikey } from '@did-btcr2/cryptosuite';
import { LocalSigner, SchnorrKeyPair } from '@did-btcr2/keypair';
import { BeaconSignalDiscovery, DidBtcr2, Identifier, Resolver } from '@did-btcr2/method';
import { bitcoinFor, confirmBroadcast, fundBeacon, parseNetworkEnv, persistKey } from './_e2e-helpers.js';

const NETWORK = parseNetworkEnv();

const KIND_INDEX = { p2pkh: 0, p2wpkh: 1, p2tr: 2 } as const;
type Kind = keyof typeof KIND_INDEX;
const KIND = (process.env.BEACON_KIND ?? 'p2pkh') as Kind;
if(!(KIND in KIND_INDEX)) {
  throw new Error(`BEACON_KIND must be one of p2pkh|p2wpkh|p2tr; got "${KIND}".`);
}

console.log(`E2E: UpdateBuilder / ${KIND.toUpperCase()} against ${NETWORK}\n`);

// ─── Step 1: Build the api with a live Bitcoin connection ───────────────────

const api = new DidBtcr2Api({
  btc : NETWORK === 'regtest'
    ? { network: NETWORK, rpc: { username: 'polaruser', password: 'polarpass' } }
    : { network: NETWORK },
});

// Independent connection used for funding + signal discovery. On regtest we
// also need RPC for mining; on other networks REST is sufficient.
const bitcoin = bitcoinFor(NETWORK);

console.log(`[1] api initialized, height: ${await bitcoin.rest.block.count()}`);

// ─── Step 2: Generate key + create DID ──────────────────────────────────────

const kp = SchnorrKeyPair.generate();
const signer = new LocalSigner(kp.raw.secret!);
const did = DidBtcr2.create(kp.publicKey.compressed, { idType: 'KEY', network: NETWORK });
console.log(`[2] DID: ${did}`);

// ─── Step 3: Resolve source document deterministically ──────────────────────

const sourceDocument = Resolver.deterministic(Identifier.decode(did));
// service[0]=p2pkh, service[1]=p2wpkh, service[2]=p2tr — selected by BEACON_KIND.
const beaconService = sourceDocument.service![KIND_INDEX[KIND]]!;
const beaconAddress = beaconService.serviceEndpoint.replace('bitcoin:', '');
console.log(`[3] Beacon address (${KIND.toUpperCase()}): ${beaconAddress}`);

persistKey({
  network        : NETWORK,
  did,
  secretKeyBytes : kp.raw.secret!,
  pubkeyBytes    : kp.publicKey.compressed,
  beaconAddress,
  label          : `update-builder-${KIND}`,
});

// ─── Step 4: Fund the beacon address ────────────────────────────────────────

console.log(`\n[4] Funding ${beaconAddress} ...`);
const { minerAddr } = await fundBeacon({ beaconAddress, bitcoin, network: NETWORK });
console.log(`    funded + confirmed + indexed`);

// ─── Step 5: Drive the UpdateBuilder fluent chain ───────────────────────────

console.log(`\n[5] Calling api.btcr2.buildUpdate(...).signer(LocalSigner).execute() ...`);
const signed = await api.btcr2
  .buildUpdate(sourceDocument)
  .patch({
    op    : 'add',
    path  : '/service/3',
    value : {
      id              : `${did}#dwn`,
      type            : 'DecentralizedWebNode',
      serviceEndpoint : 'http://example.com/dwn',
    },
  })
  .version(1)
  .verificationMethodId(sourceDocument.verificationMethod![0]!.id)
  .beacon(beaconService.id)
  .signer(signer)
  .execute();

console.log(`    update broadcast (targetVersionId: ${signed.targetVersionId})`);

// Verify the DI proof.
const verifierMultikey = SchnorrMultikey.fromVerificationMethod(sourceDocument.verificationMethod![0]!);
const verifyResult = verifierMultikey.toCryptosuite().verifyProof(signed);
assert.equal(verifyResult.verified, true, 'DI proof should verify');
console.log(`    DI proof verified ✓`);

// ─── Step 6: Confirm broadcast + discover the signal ────────────────────────

await confirmBroadcast({ bitcoin, network: NETWORK, minerAddr, watchAddress: beaconAddress });

const expectedHashHex = canonicalHash(signed, { encoding: 'hex' });
const discovered = await BeaconSignalDiscovery.indexer([beaconService], bitcoin);
const signals = discovered.get(beaconService) ?? [];
const match = signals.find((s) => s.signalBytes === expectedHashHex);

assert.ok(match, `Expected to discover signal with hash ${expectedHashHex}`);
console.log(`\n[6] Signal discovered at block ${match.blockMetadata.height} ✓`);

console.log(`\n══ E2E PASSED (${KIND.toUpperCase()} / ${NETWORK}) ══`);
console.log(`  DID:    ${did}`);
console.log(`  beacon: ${beaconService.serviceEndpoint}`);
console.log(`  signal: ${expectedHashHex}`);
process.exit(0);

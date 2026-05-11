/**
 * E2E: KeyManagerSigner update path across networks.
 *
 * Mirrors `e2e-local-signer-update.ts` but the signer is a `KeyManagerSigner`
 * wrapping a key imported into a `LocalKeyManager` instance. Validates the
 * production signing path: secret bytes never leave the key manager; the
 * Updater + Beacon code sees only the abstract `Signer` interface.
 *
 * Env:
 *   BITCOIN_NETWORK   default: regtest. One of: regtest|mutinynet|signet|testnet3|testnet4.
 *   BEACON_KIND       default: p2pkh. One of: p2pkh|p2wpkh|p2tr.
 *
 * On regtest the funding/confirmation flow is fully automated via bitcoind RPC.
 * On every other network the operator funds the beacon manually (faucet) and
 * presses Y to continue; broadcast and discovery go through Esplora/REST.
 *
 * Exit code: 0 on success, non-zero on any assertion failure.
 */
import assert from 'node:assert/strict';
import { canonicalHash } from '@did-btcr2/common';
import { SchnorrMultikey } from '@did-btcr2/cryptosuite';
import { KeyManagerSigner, LocalKeyManager } from '@did-btcr2/key-manager';
import { SchnorrKeyPair } from '@did-btcr2/keypair';
import { BeaconSignalDiscovery, DidBtcr2, Identifier, Resolver, Updater } from '@did-btcr2/method';
import { bitcoinFor, confirmBroadcast, fundBeacon, parseNetworkEnv, persistKey } from './_e2e-helpers.js';

const NETWORK = parseNetworkEnv();

const KIND_INDEX = { p2pkh: 0, p2wpkh: 1, p2tr: 2 } as const;
type Kind = keyof typeof KIND_INDEX;
const KIND = (process.env.BEACON_KIND ?? 'p2pkh') as Kind;
if(!(KIND in KIND_INDEX)) {
  throw new Error(`BEACON_KIND must be one of p2pkh|p2wpkh|p2tr; got "${KIND}".`);
}

console.log(`E2E: KeyManagerSigner / ${KIND.toUpperCase()} update against ${NETWORK}\n`);

// ─── Step 1: Connect to Bitcoin ─────────────────────────────────────────────

const bitcoin = bitcoinFor(NETWORK);
console.log(`[1] Connected to ${NETWORK}, height: ${await bitcoin.rest.block.count()}`);

// ─── Step 2: Generate key inside a LocalKeyManager, then create DID ─────────

const kms = new LocalKeyManager();
const kp = SchnorrKeyPair.generate();
const keyId = kms.importKey(kp, { setActive: true });
const signer = new KeyManagerSigner(kms, keyId);
console.log(`[2] Imported key into LocalKeyManager (id: ${keyId})`);

const did = DidBtcr2.create(signer.publicKey, { idType: 'KEY', network: NETWORK });
console.log(`    DID: ${did}`);

// ─── Step 3: Resolve source document deterministically ──────────────────────

const sourceDocument = Resolver.deterministic(Identifier.decode(did));
const beaconService = sourceDocument.service![KIND_INDEX[KIND]]!;
const beaconAddress = beaconService.serviceEndpoint.replace('bitcoin:', '');
console.log(`[3] Beacon address (${KIND.toUpperCase()}): ${beaconAddress}`);

persistKey({
  network        : NETWORK,
  did,
  secretKeyBytes : kp.secretKey.bytes,
  pubkeyBytes    : kp.publicKey.compressed,
  beaconAddress,
  label          : `kms-signer-${KIND}`,
});

// ─── Step 4: Fund the beacon address (regtest mines; others prompt) ─────────

console.log(`\n[4] Funding ${beaconAddress} ...`);
const { minerAddr } = await fundBeacon({ beaconAddress, bitcoin, network: NETWORK });
console.log(`    funded + confirmed + Esplora indexed`);

// ─── Step 5: Construct + sign the update via KeyManagerSigner ──────────────

const vm = sourceDocument.verificationMethod![0]!;
const unsigned = Updater.construct(sourceDocument, [{
  op    : 'add',
  path  : '/service/3',
  value : {
    id              : `${did}#dwn`,
    type            : 'DecentralizedWebNode',
    serviceEndpoint : 'http://example.com/dwn',
  },
}], 1);

const signed = Updater.sign(did, unsigned, vm, signer);
console.log(`\n[5] Update signed via KeyManagerSigner`);
console.log(`    targetVersionId: ${signed.targetVersionId}`);
console.log(`    cryptosuite: ${signed.proof.cryptosuite}`);

const verifierMultikey = SchnorrMultikey.fromVerificationMethod(vm);
assert.equal(verifierMultikey.toCryptosuite().verifyProof(signed).verified, true);
console.log(`    DI proof verified ✓`);

// ─── Step 6: Broadcast via Updater.announce (KeyManagerSigner) ─────────────

console.log(`\n[6] Broadcasting beacon signal via KeyManagerSigner-driven announce ...`);
await Updater.announce(beaconService, signed, signer, bitcoin);
await confirmBroadcast({ bitcoin, network: NETWORK, minerAddr, watchAddress: beaconAddress });
console.log(`    broadcast confirmed`);

// ─── Step 7: Discover the signal on-chain ───────────────────────────────────

const expectedHashHex = canonicalHash(signed, { encoding: 'hex' });
console.log(`\n[7] Discovering signals at ${beaconAddress} ...`);
console.log(`    expected hash: ${expectedHashHex}`);

const discovered = await BeaconSignalDiscovery.indexer([beaconService], bitcoin);
const signals = discovered.get(beaconService) ?? [];
const match = signals.find((s) => s.signalBytes === expectedHashHex);
assert.ok(match, `Expected to discover signal with hash ${expectedHashHex}`);
console.log(`    signal match ✓`);
console.log(`    block height: ${match.blockMetadata.height}`);

console.log(`\n══ E2E PASSED (${KIND.toUpperCase()} / ${NETWORK}) ══`);
console.log(`  DID:              ${did}`);
console.log(`  KeyManager keyId: ${keyId}`);
console.log(`  beacon:           ${beaconService.serviceEndpoint}`);
console.log(`  signal hash:      ${expectedHashHex}`);
process.exit(0);

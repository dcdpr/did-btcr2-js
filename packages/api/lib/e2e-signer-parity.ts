/**
 * E2E: Cross-signer parity against a live Bitcoin regtest node.
 *
 * Validates the unified `Signer.sign(data, scheme, opts?)` interface produces
 * functionally-equivalent results across the two bundled implementations:
 *
 *   1. `LocalSigner` (secret in heap)
 *   2. `KeyManagerSigner` wrapping `LocalKeyManager`
 *
 * Same 32-byte secret key on both sides, same update payload, same beacon.
 * Both updates must:
 *   - Verify the Data Integrity proof
 *   - Broadcast successfully (Bitcoin accepts both txs)
 *   - Be discoverable on chain as beacon signals
 *
 * Signature bytes themselves WILL differ because BIP-340 Schnorr uses random
 * aux_rand by default — parity is at the *contract* level (verifiability,
 * broadcast acceptance, discovery), not at the byte level.
 *
 * Env:
 *   BITCOIN_NETWORK   default: regtest
 *   BEACON_KIND       default: p2pkh — one of p2pkh|p2wpkh|p2tr
 */
import assert from 'node:assert/strict';
import { canonicalHash } from '@did-btcr2/common';
import { SchnorrMultikey } from '@did-btcr2/cryptosuite';
import { KeyManagerSigner, LocalKeyManager } from '@did-btcr2/key-manager';
import { LocalSigner, SchnorrKeyPair } from '@did-btcr2/keypair';
import { BeaconSignalDiscovery, DidBtcr2, Identifier, Resolver, Updater } from '@did-btcr2/method';
import { bitcoinFor, confirmBroadcast, fundBeacon, parseNetworkEnv, persistKey } from './_e2e-helpers.js';

const NETWORK = parseNetworkEnv();

const KIND_INDEX = { p2pkh: 0, p2wpkh: 1, p2tr: 2 } as const;
type Kind = keyof typeof KIND_INDEX;
const KIND = (process.env.BEACON_KIND ?? 'p2pkh') as Kind;
if(!(KIND in KIND_INDEX)) {
  throw new Error(`BEACON_KIND must be one of p2pkh|p2wpkh|p2tr; got "${KIND}".`);
}

console.log(`E2E: Signer parity / ${KIND.toUpperCase()} against ${NETWORK}\n`);

// ─── Step 1: Connect ────────────────────────────────────────────────────────

const bitcoin = bitcoinFor(NETWORK);
console.log(`[1] Connected to ${NETWORK}, height: ${await bitcoin.rest.block.count()}`);

// ─── Step 2: Single key on both sides ───────────────────────────────────────

const kp = SchnorrKeyPair.generate();
const localSigner = new LocalSigner(kp.secretKey.bytes);

const km = new LocalKeyManager();
const keyId = km.importKey(kp, { setActive: true });
const kmsSigner = new KeyManagerSigner(km, keyId);

// Same pubkey from both signers — sanity check before broadcasting.
assert.deepEqual(
  Array.from(localSigner.publicKey),
  Array.from(kmsSigner.publicKey),
  'parity precondition: both signers must derive the same pubkey',
);
console.log(`[2] Same key wired into LocalSigner + KeyManagerSigner`);

// Single DID — both signers must produce updates the resolver accepts as
// distinct on-chain signals tied to this identifier.
const did = DidBtcr2.create(localSigner.publicKey, { idType: 'KEY', network: NETWORK });
console.log(`    DID: ${did}`);

// ─── Step 3: Beacon address + funding for TWO broadcasts ────────────────────

const sourceDocument = Resolver.deterministic(Identifier.decode(did));
const beaconService = sourceDocument.service![KIND_INDEX[KIND]]!;
const beaconAddress = beaconService.serviceEndpoint.replace('bitcoin:', '');
const vm = sourceDocument.verificationMethod![0]!;
console.log(`[3] Beacon address: ${beaconAddress}`);

persistKey({
  network        : NETWORK,
  did,
  secretKeyBytes : kp.secretKey.bytes,
  pubkeyBytes    : kp.publicKey.compressed,
  beaconAddress,
  label          : `signer-parity-${KIND}`,
});

console.log(`\n[4] Funding (twice — one UTXO per broadcast) ...`);
const { minerAddr } = await fundBeacon({ beaconAddress, bitcoin, network: NETWORK, count: 2 });
console.log(`    2 UTXOs funded + confirmed + indexed`);

// ─── Step 5: Sign + broadcast via LocalSigner ───────────────────────────────

const unsignedA = Updater.construct(sourceDocument, [{
  op    : 'add',
  path  : '/service/3',
  value : {
    id              : `${did}#parity-local`,
    type            : 'DecentralizedWebNode',
    serviceEndpoint : 'http://example.com/parity-local',
  },
}], 1);
const signedA = Updater.sign(did, unsignedA, vm, localSigner);
assert.equal(
  SchnorrMultikey.fromVerificationMethod(vm).toCryptosuite().verifyProof(signedA).verified, true,
  'LocalSigner DI proof verifies',
);
const hashA = canonicalHash(signedA, { encoding: 'hex' });

console.log(`\n[5] Broadcasting LocalSigner update ...`);
await Updater.announce(beaconService, signedA, localSigner, bitcoin);
await confirmBroadcast({ bitcoin, network: NETWORK, minerAddr, watchAddress: beaconAddress });
console.log(`    LocalSigner broadcast accepted (hash ${hashA.slice(0, 16)}...)`);

// ─── Step 6: Sign + broadcast via KeyManagerSigner ──────────────────────────

const unsignedB = Updater.construct(sourceDocument, [{
  op    : 'add',
  path  : '/service/3',
  value : {
    id              : `${did}#parity-kms`,
    type            : 'DecentralizedWebNode',
    serviceEndpoint : 'http://example.com/parity-kms',
  },
}], 1);
const signedB = Updater.sign(did, unsignedB, vm, kmsSigner);
assert.equal(
  SchnorrMultikey.fromVerificationMethod(vm).toCryptosuite().verifyProof(signedB).verified, true,
  'KeyManagerSigner DI proof verifies',
);
const hashB = canonicalHash(signedB, { encoding: 'hex' });
assert.notEqual(hashA, hashB, 'distinct payloads have distinct hashes');

console.log(`\n[6] Broadcasting KeyManagerSigner update ...`);
await Updater.announce(beaconService, signedB, kmsSigner, bitcoin);
await confirmBroadcast({ bitcoin, network: NETWORK, minerAddr, watchAddress: beaconAddress });
console.log(`    KeyManagerSigner broadcast accepted (hash ${hashB.slice(0, 16)}...)`);

// ─── Step 7: Both signals discoverable on chain ─────────────────────────────

const discovered = await BeaconSignalDiscovery.indexer([beaconService], bitcoin);
const signals = discovered.get(beaconService) ?? [];
const matchA = signals.find((s) => s.signalBytes === hashA);
const matchB = signals.find((s) => s.signalBytes === hashB);
assert.ok(matchA, `LocalSigner signal ${hashA} discovered`);
assert.ok(matchB, `KeyManagerSigner signal ${hashB} discovered`);
console.log(`\n[7] Both signals discovered on chain`);
console.log(`    LocalSigner       @ height ${matchA.blockMetadata.height}`);
console.log(`    KeyManagerSigner  @ height ${matchB.blockMetadata.height}`);

console.log(`\n══ PARITY VERIFIED (${KIND.toUpperCase()}) ══`);
console.log(`  Same key, two signer paths, both DI-proof-verifiable and bitcoin-accepted.`);
process.exit(0);

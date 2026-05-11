/**
 * E2E: `KeyManagerSigner` active-key resolution against a live Bitcoin regtest node.
 *
 * `new KeyManagerSigner(keyManager)` constructed without an explicit `keyId`
 * resolves to the KeyManager's *active key at sign-time*. This is a subtle
 * contract — earlier audit work flagged it as a sharp edge:
 *
 *   - Two `KeyManagerSigner(km)` instances constructed before `setActiveKey()`
 *     and after it sign with different keys despite identical construction.
 *   - The cached `publicKey` (lazy-init on first read) goes stale after
 *     `setActiveKey()` changes the underlying active key, but `sign()` still
 *     resolves at call time. So `signer.publicKey` and `signer.sign(...)` can
 *     disagree about which key they reference.
 *
 * This e2e validates the active-key resolution path end-to-end:
 *
 *   1. Single active-key signer broadcasts a beacon signal that confirms.
 *   2. After `setActiveKey()` swap, a NEW signer instance signs with the new key.
 *   3. A signer constructed BEFORE the swap (and which has cached the old pubkey
 *      via `.publicKey` access) is expected to surface the stale-cache hazard:
 *      `signer.sign(...)` will sign with the NEW active key, mismatching the
 *      cached `.publicKey` — proving the documented behavior matches reality.
 *
 * Env:
 *   BITCOIN_NETWORK   default: regtest
 *   BEACON_KIND       default: p2pkh — one of p2pkh|p2wpkh|p2tr
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

console.log(`E2E: KeyManagerSigner active-key resolution / ${KIND.toUpperCase()} against ${NETWORK}\n`);

// ─── Step 1: Connect ────────────────────────────────────────────────────────

const bitcoin = bitcoinFor(NETWORK);
console.log(`[1] Connected to ${NETWORK}, height: ${await bitcoin.rest.block.count()}`);

// ─── Step 2: KeyManager with active key, NO explicit keyId on signer ────────

const km = new LocalKeyManager();
const kpA = SchnorrKeyPair.generate();
const idA = km.importKey(kpA, { setActive: true });

// Construct signer WITHOUT explicit keyId. Resolves to active key at sign-time.
const signer = new KeyManagerSigner(km);
console.log(`[2] KeyManagerSigner constructed without explicit keyId`);
console.log(`    KM active key: ${idA}`);
console.log(`    signer.publicKey resolves to active key on first access`);

// Force the lazy cache to populate with kpA's public key.
const cachedPubkeyA = Array.from(signer.publicKey);
assert.deepEqual(cachedPubkeyA, Array.from(kpA.publicKey.compressed),
  'signer.publicKey resolves to the active key');

const didA = DidBtcr2.create(signer.publicKey, { idType: 'KEY', network: NETWORK });
const sourceDoc = Resolver.deterministic(Identifier.decode(didA));
const beaconService = sourceDoc.service![KIND_INDEX[KIND]]!;
const beaconAddress = beaconService.serviceEndpoint.replace('bitcoin:', '');
const vm = sourceDoc.verificationMethod![0]!;
console.log(`    DID (from active key A): ${didA}`);

persistKey({
  network        : NETWORK,
  did            : didA,
  secretKeyBytes : kpA.secretKey.bytes,
  pubkeyBytes    : kpA.publicKey.compressed,
  beaconAddress,
  label          : `active-key-${KIND}`,
});

// ─── Step 3: Fund + broadcast a signed update via active key A ──────────────

const { minerAddr } = await fundBeacon({ beaconAddress, bitcoin, network: NETWORK });

const unsigned = Updater.construct(sourceDoc, [{
  op    : 'add',
  path  : '/service/3',
  value : {
    id              : `${didA}#active-key-test`,
    type            : 'DecentralizedWebNode',
    serviceEndpoint : 'http://example.com/active-key',
  },
}], 1);
const signed = Updater.sign(didA, unsigned, vm, signer);
assert.equal(
  SchnorrMultikey.fromVerificationMethod(vm).toCryptosuite().verifyProof(signed).verified, true,
  'active-key A signed update verifies',
);

console.log(`\n[3] Broadcasting update signed by active key A ...`);
await Updater.announce(beaconService, signed, signer, bitcoin);
await confirmBroadcast({ bitcoin, network: NETWORK, minerAddr, watchAddress: beaconAddress });
const hashA = canonicalHash(signed, { encoding: 'hex' });

const discovered = await BeaconSignalDiscovery.indexer([beaconService], bitcoin);
const match = (discovered.get(beaconService) ?? []).find((s) => s.signalBytes === hashA);
assert.ok(match, `signal ${hashA} discovered on chain`);
console.log(`    accepted + confirmed (height ${match.blockMetadata.height})`);

// ─── Step 4: setActiveKey swap, surface the cache-staleness hazard ──────────

const kpB = SchnorrKeyPair.generate();
const idB = km.importKey(kpB);
km.setActiveKey(idB);
console.log(`\n[4] Active key swapped: ${idA} -> ${idB}`);

// `signer` was constructed without an explicit keyId and already cached
// kpA's pubkey on first read. Its sign() will now resolve to active key B.
// This demonstrates the stale-cache hazard: pubkey != sign-key.
const stillCachedPubkey = Array.from(signer.publicKey);
assert.deepEqual(stillCachedPubkey, Array.from(kpA.publicKey.compressed),
  'pre-swap signer still reports kpA pubkey (cached)');

// Verify sign() picks the NEW key by produced signature shape: BIP-340 sigs
// produced by kpB will not verify under kpA's x-only pubkey.
const probe = new Uint8Array(32).fill(0xab);
const sigUnderNewActive = signer.sign(probe, 'bip340');

// Verify against the OLD cached pubkey — should FAIL (proves sign() resolved
// to the new active key, not the cached one).
const { schnorr } = await import('@noble/curves/secp256k1.js');
const verifiesAgainstOldCached = schnorr.verify(
  sigUnderNewActive, probe, kpA.publicKey.x,
);
const verifiesAgainstNewActive = schnorr.verify(
  sigUnderNewActive, probe, kpB.publicKey.x,
);

console.log(`    sig verifies under cached pubkey A: ${verifiesAgainstOldCached}`);
console.log(`    sig verifies under new active   B: ${verifiesAgainstNewActive}`);

assert.equal(verifiesAgainstOldCached, false,
  'CACHE-STALENESS HAZARD: signer.publicKey is kpA but sign() used kpB. This is the documented behavior.');
assert.equal(verifiesAgainstNewActive, true,
  'sign() correctly resolved to the current active key at call-time');

// ─── Step 5: A FRESHLY-constructed signer post-swap matches kpB on both axes ─

const signerFresh = new KeyManagerSigner(km);
assert.deepEqual(
  Array.from(signerFresh.publicKey), Array.from(kpB.publicKey.compressed),
  'fresh signer after swap reports kpB pubkey',
);
const sigFresh = signerFresh.sign(probe, 'bip340');
assert.equal(schnorr.verify(sigFresh, probe, kpB.publicKey.x), true,
  'fresh signer sign() matches its own publicKey');
console.log(`\n[5] Fresh KeyManagerSigner post-swap: publicKey and sign() both reference kpB ✓`);

console.log(`\n══ E2E PASSED (active-key resolution) ══`);
console.log(`  - Active-key broadcast on chain ✓`);
console.log(`  - Cache-staleness hazard surfaced and characterized ✓`);
console.log(`  - Fresh signer construction post-swap is consistent ✓`);
console.log(`  Recommendation for production callers: always supply an explicit keyId.`);
process.exit(0);

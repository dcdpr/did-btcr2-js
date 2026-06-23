/**
 * E2E: Custom Signer adapter across networks.
 *
 * Identical end-to-end flow to `e2e-local-signer-update.ts`, but the signer is
 * an inline literal object satisfying the {@link Signer} interface: no class,
 * no LocalSigner, no KeyManagerSigner. This proves the cryptosuite chain and the
 * beacon broadcast pipeline are interface-only: any third party can plug in a
 * custom `Signer` (HSM, hardware wallet, browser extension, remote signer)
 * without touching the DID method code.
 *
 * Env:
 *   BITCOIN_NETWORK   default: regtest. One of: regtest|mutinynet|signet|testnet3|testnet4.
 *   BEACON_KIND       default: p2pkh. One of: p2pkh|p2wpkh|p2tr.
 *
 * Exit code: 0 on success, non-zero on any assertion failure.
 */
import assert from 'node:assert/strict';
import { canonicalHash } from '@did-btcr2/common';
import { SchnorrMultikey } from '@did-btcr2/cryptosuite';
import type { Signer } from '@did-btcr2/keypair';
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

console.log(`E2E: custom inline Signer / ${KIND.toUpperCase()} adapter against ${NETWORK}\n`);

// ─── Step 1: Connect to Bitcoin ─────────────────────────────────────────────

const bitcoin = bitcoinFor(NETWORK);
console.log(`[1] Connected to ${NETWORK}, height: ${await bitcoin.rest.block.count()}`);

// ─── Step 2: Build a custom Signer as an inline literal ─────────────────────

const kp = SchnorrKeyPair.generate();
const secretKey = kp.raw.secret!;

// The Signer satisfies the interface structurally; it is a plain literal
// object, not an instance of `LocalSigner`. The Updater + Beacon chain has
// no `instanceof` checks anywhere, any object that conforms to
// `{ publicKey: KeyBytes, sign(data, scheme, opts?): SignatureBytes }` works.
// A real caller might back this with fetch() to a remote signer, a hardware
// wallet, a WebAuthn API, or a browser extension.
const inner = new LocalSigner(secretKey);
const customSigner: Signer = {
  publicKey : inner.publicKey,
  sign      : (data, scheme, opts) => inner.sign(data, scheme, opts),
};
console.log(`[2] Built inline custom Signer (literal object, no class instance)`);

const did = DidBtcr2.create(customSigner.publicKey, { idType: 'KEY', network: NETWORK });
console.log(`    DID: ${did}`);

// ─── Step 3: Resolve source document deterministically ──────────────────────

const sourceDocument = Resolver.deterministic(Identifier.decode(did));
const beaconService = sourceDocument.service![KIND_INDEX[KIND]]!;
const beaconAddress = beaconService.serviceEndpoint.replace('bitcoin:', '');
console.log(`[3] Beacon address (${KIND.toUpperCase()}): ${beaconAddress}`);

persistKey({
  network        : NETWORK,
  did,
  secretKeyBytes : secretKey,
  pubkeyBytes    : kp.publicKey.compressed,
  beaconAddress,
  label          : `custom-signer-${KIND}`,
});

// ─── Step 4: Fund the beacon address ────────────────────────────────────────

console.log(`\n[4] Funding ${beaconAddress} ...`);
const { minerAddr } = await fundBeacon({ beaconAddress, bitcoin, network: NETWORK });
console.log(`    funded + confirmed + indexed`);

// ─── Step 5: Sign update via the custom Signer ──────────────────────────────

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

const signed = Updater.sign(did, unsigned, vm, customSigner);
console.log(`\n[5] Update signed via custom Signer`);

const verifyResult = SchnorrMultikey.fromVerificationMethod(vm)
  .toCryptosuite()
  .verifyProof(signed);
assert.equal(verifyResult.verified, true, 'DI proof should verify');
console.log(`    DI proof verified ✓`);

// ─── Step 6: Broadcast via Updater.announce ─────────────────────────────────

console.log(`\n[6] Broadcasting beacon signal ...`);
await Updater.announce(beaconService, signed, customSigner, bitcoin);
await confirmBroadcast({ bitcoin, network: NETWORK, minerAddr, watchAddress: beaconAddress });
console.log(`    broadcast confirmed`);

// ─── Step 7: Discover signal on-chain ───────────────────────────────────────

const expectedHashHex = canonicalHash(signed, { encoding: 'hex' });
const discovered = await BeaconSignalDiscovery.indexer([beaconService], bitcoin);
const signals = discovered.get(beaconService) ?? [];
const match = signals.find((s) => s.signalBytes === expectedHashHex);
assert.ok(match, `Expected to discover signal with hash ${expectedHashHex}`);
console.log(`\n[7] Signal discovered at block ${match.blockMetadata.height} ✓`);

console.log(`\n══ E2E PASSED (${KIND.toUpperCase()} / ${NETWORK}) ══`);
console.log(`  DID:    ${did}`);
console.log(`  beacon: ${beaconService.serviceEndpoint}`);
console.log(`  signal: ${expectedHashHex}`);
process.exit(0);

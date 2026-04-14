/**
 * E2E Check: End-to-end MuSig2 signing over a real Nostr relay, with
 * cryptographic verification of the aggregated signature against the
 * Taproot-tweaked aggregated pubkey and the BIP-341 witness-v1 sighash.
 *
 * This is the one test that proves the full MuSig2 pipeline — keyAgg, TapTweak,
 * nonceAgg, partial-sig pre-verify, and partialSigAgg — produces a Bitcoin-valid
 * witness signature. In-process unit tests can't catch a transport regression
 * that only shows up with real relay serialization.
 *
 * Uses mutinynet-labeled DIDs / addresses so the Taproot output format matches
 * what a real mutinynet node would validate. Does NOT broadcast — the BIP-340
 * signature check against the tweaked pubkey is the cryptographic ground truth
 * a broadcast would rely on.
 *
 * Requires a running Nostr relay. Default assumes a local nostr-rs-relay on
 * ws://localhost:7777 (matching the other demos in this folder).
 *
 * Usage:
 *   npx tsx lib/operations/aggregation/e2e-verify-signing.ts
 *   RELAY=wss://relay.damus.io \
 *     npx tsx lib/operations/aggregation/e2e-verify-signing.ts
 *
 * Exit code: 0 on success, non-zero on any assertion failure.
 */
import assert from 'node:assert/strict';
import { SchnorrKeyPair } from '@did-btcr2/keypair';
import { schnorr } from '@noble/curves/secp256k1.js';
import { bytesToHex } from '@noble/hashes/utils';
import { p2tr, SigHash, Transaction } from '@scure/btc-signer';
import * as musig2 from '@scure/btc-signer/musig2';
import type { Transport } from '../../../src/index.js';
import {
  AggregationParticipantRunner,
  AggregationServiceRunner,
  DidBtcr2,
  NostrTransport,
  Resolver,
  SILENT_LOGGER,
  Updater,
} from '../../../src/index.js';

const RELAY = process.env.RELAY ?? 'ws://localhost:7777';
const TIMEOUT_MS = Number(process.env.TIMEOUT_MS ?? 60_000);

// ── Identities ──
const serviceKeys = SchnorrKeyPair.generate();
const serviceDid = DidBtcr2.create(serviceKeys.publicKey.compressed, { idType: 'KEY', network: 'mutinynet' });
const aliceKeys = SchnorrKeyPair.generate();
const aliceDid = DidBtcr2.create(aliceKeys.publicKey.compressed, { idType: 'KEY', network: 'mutinynet' });
const bobKeys = SchnorrKeyPair.generate();
const bobDid = DidBtcr2.create(bobKeys.publicKey.compressed, { idType: 'KEY', network: 'mutinynet' });

// ── Transports (one per actor, same relay) ──
const serviceTransport = new NostrTransport({ relays: [RELAY], logger: SILENT_LOGGER });
const aliceTransport = new NostrTransport({ relays: [RELAY], logger: SILENT_LOGGER });
const bobTransport = new NostrTransport({ relays: [RELAY], logger: SILENT_LOGGER });

serviceTransport.registerActor(serviceDid, serviceKeys);
aliceTransport.registerActor(aliceDid, aliceKeys);
bobTransport.registerActor(bobDid, bobKeys);

serviceTransport.start();
aliceTransport.start();
bobTransport.start();

// Pre-register peer comms keys (prod code exchanges these via the protocol handshake).
serviceTransport.registerPeer(aliceDid, aliceKeys.publicKey.compressed);
serviceTransport.registerPeer(bobDid, bobKeys.publicKey.compressed);
aliceTransport.registerPeer(serviceDid, serviceKeys.publicKey.compressed);
bobTransport.registerPeer(serviceDid, serviceKeys.publicKey.compressed);

function buildSignedUpdate(did: string, kp: SchnorrKeyPair, beaconAddress: string) {
  const doc = Resolver.deterministic({
    genesisBytes : kp.publicKey.compressed,
    hrp          : 'k',
    idType       : 'KEY',
    version      : 1,
    network      : 'mutinynet',
  });
  const vm = doc.verificationMethod![0];
  const unsigned = Updater.construct(doc, [{
    op    : 'add',
    path  : '/service/-',
    value : {
      id              : `${did}#beacon-cas`,
      type            : 'CASBeacon',
      serviceEndpoint : `bitcoin:${beaconAddress}`,
    },
  }], 1);
  return Updater.sign(did, unsigned, vm, kp.raw.secret!);
}

// ── Capture artefacts for post-run cryptographic verification ──
let capturedSighash: Uint8Array | undefined;
let capturedTweakedPk: Uint8Array | undefined;
let capturedBeaconAddress: string | undefined;

const service = new AggregationServiceRunner({
  transport   : serviceTransport,
  did         : serviceDid,
  keys        : serviceKeys,
  config      : { minParticipants: 2, network: 'mutinynet', beaconType: 'CASBeacon' },
  cohortTtlMs : TIMEOUT_MS,

  onProvideTxData : async () => {
    const cohort = service.session.getCohort(service.session.cohorts[0].id)!;
    const aggPk = musig2.keyAggExport(musig2.keyAggregate(cohort.cohortKeys));
    const payment = p2tr(aggPk);
    const prevOutValue = 100_000n;
    const tx = new Transaction({ version: 2 });
    tx.addInput({
      txid        : '00'.repeat(32),
      index       : 0,
      witnessUtxo : { amount: prevOutValue, script: payment.script },
    });
    tx.addOutput({ script: payment.script, amount: prevOutValue - 500n });

    capturedTweakedPk = payment.tweakedPubkey;
    capturedSighash = tx.preimageWitnessV1(0, [payment.script], SigHash.DEFAULT, [prevOutValue]);
    capturedBeaconAddress = cohort.beaconAddress;

    return { tx, prevOutScripts: [payment.script], prevOutValues: [prevOutValue] };
  },
});

function makeParticipantRunner(name: string, did: string, keys: SchnorrKeyPair, transport: Transport) {
  const runner = new AggregationParticipantRunner({
    transport,
    did,
    keys,
    shouldJoin      : async () => true,
    onProvideUpdate : async ({ beaconAddress }) => buildSignedUpdate(did, keys, beaconAddress),
  });
  runner.on('cohort-discovered', (advert) => console.log(`[${name}] discovered cohort ${advert.cohortId}`));
  runner.on('cohort-joined', () => console.log(`[${name}] joined`));
  runner.on('cohort-ready', ({ beaconAddress }) => console.log(`[${name}] ready: ${beaconAddress}`));
  runner.on('update-submitted', () => console.log(`[${name}] update submitted`));
  runner.on('cohort-complete', ({ beaconAddress }) => console.log(`[${name}] complete: ${beaconAddress}`));
  runner.on('cohort-failed', ({ reason }) => console.error(`[${name}] failed: ${reason}`));
  runner.on('error', (err) => console.error(`[${name}] error:`, err.message));
  return runner;
}

const alice = makeParticipantRunner('alice', aliceDid, aliceKeys, aliceTransport);
const bob = makeParticipantRunner('bob', bobDid, bobKeys, bobTransport);

service.on('cohort-advertised', ({ cohortId }) => console.log(`[service] cohort ${cohortId} advertised`));
service.on('keygen-complete', ({ beaconAddress }) => console.log(`[service] keygen complete: ${beaconAddress}`));
service.on('signing-started', () => console.log('[service] signing started'));
service.on('signing-complete', () => console.log('[service] signing complete'));
service.on('cohort-failed', ({ reason }) => console.error(`[service] cohort failed: ${reason}`));
service.on('error', (err) => console.error('[service] error:', err.message));

console.log(`\n══ Connecting to relay: ${RELAY} ══\n`);

alice.start();
bob.start();
const result = await service.run();

// ── Assertions ──
assert.ok(result.signature instanceof Uint8Array, 'result.signature is not a Uint8Array');
assert.equal(result.signature.length, 64, `expected 64-byte Schnorr signature, got ${result.signature.length}`);
assert.ok(capturedSighash, 'onProvideTxData never ran — sighash not captured');
assert.ok(capturedTweakedPk, 'tweaked pubkey not captured');

// Definitive check: the aggregated MuSig2 signature must verify against the
// Taproot-tweaked x-only pubkey + BIP-341 sighash. If this fails, the key
// aggregation, TapTweak, nonce aggregation, or partial-sig aggregation is
// broken in a way unit tests couldn't see.
const verified = schnorr.verify(result.signature, capturedSighash, capturedTweakedPk);
assert.ok(verified, 'aggregated MuSig2 signature failed BIP-340 verification');

console.log('\n══ Result ══');
console.log(`Relay:            ${RELAY}`);
console.log(`Beacon address:   ${capturedBeaconAddress ?? '(unknown)'}`);
console.log(`Signature:        ${bytesToHex(result.signature)}`);
console.log(`BIP-340 verify:   ok`);
console.log('\nE2E check passed.\n');

alice.stop();
bob.stop();
service.stop();

process.exit(0);

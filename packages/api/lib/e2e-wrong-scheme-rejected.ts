/**
 * E2E: Wrong-scheme P2TR signing rejected by Bitcoin consensus.
 *
 * Deliberately signs a P2TR-spending tx with `'bip340'` (raw, untweaked
 * BIP-340 Schnorr) instead of `'bip341'` (taproot-tweaked). The signature is
 * structurally a valid 64-byte BIP-340 signature over the BIP-341 sighash,
 * scure-btc-signer happily accepts it for `tapKeySig` and finalizes the tx,
 * and the resulting hex broadcasts cleanly to the local mempool, but
 * consensus rejects it because BIP-341 §3 mandates that `tapKeySig` verify
 * against the tweaked output internal key `Q = P + tG`, not against the
 * untweaked Schnorr pubkey `P`. The reject reason is
 * `mandatory-script-verify-flag-failed (Invalid Schnorr signature)`.
 *
 * The local-side correctness check `tx.finalize()` does not perform
 * signature verification, so a unit test alone cannot catch a regression to
 * untweaked signing. This script exercises the BIP-341 tweak contract
 * end-to-end against a live bitcoind, with inverted polarity: success means
 * the broadcast was rejected.
 *
 * Env:
 *   BITCOIN_NETWORK   default: regtest. One of: regtest|mutinynet|signet|testnet3|testnet4.
 *
 * Exit code: 0 if Bitcoin correctly REJECTS the broadcast.
 *            Non-zero if Bitcoin ACCEPTS the broadcast.
 */
import assert from 'node:assert/strict';
import { hexToBytes } from '@noble/hashes/utils.js';
import { p2tr, SigHash, Transaction } from '@scure/btc-signer';
import { LocalSigner, SchnorrKeyPair } from '@did-btcr2/keypair';
import { DidBtcr2, Identifier, opReturnScript, Resolver } from '@did-btcr2/method';
import { bitcoinFor, fundBeacon, parseNetworkEnv, persistKey } from './_e2e-helpers.js';

const NETWORK = parseNetworkEnv();

console.log(`E2E: wrong-scheme P2TR rejected by Bitcoin / against ${NETWORK}\n`);

// ─── Step 1: Connect ────────────────────────────────────────────────────────

const bitcoin = bitcoinFor(NETWORK);
console.log(`[1] Connected to ${NETWORK}, height: ${await bitcoin.rest.block.count()}`);

// ─── Step 2: P2TR beacon address from a fresh key ───────────────────────────

const kp = SchnorrKeyPair.generate();
const signer = new LocalSigner(kp.secretKey.bytes);
const did = DidBtcr2.create(signer.publicKey, { idType: 'KEY', network: NETWORK });
const sourceDoc = Resolver.deterministic(Identifier.decode(did));
const p2trBeaconService = sourceDoc.service![2]!; // service[2] = P2TR
const beaconAddress = p2trBeaconService.serviceEndpoint.replace('bitcoin:', '');
console.log(`[2] P2TR beacon address: ${beaconAddress}`);

persistKey({
  network        : NETWORK,
  did,
  secretKeyBytes : kp.secretKey.bytes,
  pubkeyBytes    : kp.publicKey.compressed,
  beaconAddress,
  label          : 'wrong-scheme-rejected',
});

// ─── Step 3: Fund + confirm ─────────────────────────────────────────────────

console.log(`\n[3] Funding ${beaconAddress} ...`);
await fundBeacon({ beaconAddress, bitcoin, network: NETWORK });
console.log(`    funded + confirmed`);

// ─── Step 4: Build a P2TR-spending tx and sign with WRONG scheme ────────────

const utxos = await bitcoin.rest.address.getUtxos(beaconAddress);
const utxo = utxos[0]!;
const prevTxHex = await bitcoin.rest.transaction.getHex(utxo.txid);
const prevTxBytes = hexToBytes(prevTxHex);

const internalKey = signer.publicKey.slice(1, 33); // x-only
const tapOut = p2tr(internalKey, undefined, bitcoin.data);
const prevOutScript = tapOut.script;
const amount = BigInt(utxo.value);
const feeSats = 800n; // conservative - vsize ~160 at 5 sat/vB

const tx = new Transaction({ allowUnknownOutputs: true });
tx.addInput({
  txid           : utxo.txid,
  index          : utxo.vout,
  nonWitnessUtxo : prevTxBytes,
  witnessUtxo    : { amount, script: prevOutScript },
  tapInternalKey : internalKey,
});
tx.addOutputAddress(beaconAddress, amount - feeSats, bitcoin.data);
tx.addOutput({ script: opReturnScript(new Uint8Array(32).fill(0x42)), amount: 0n });

// Sign with 'bip340' (raw, untweaked) instead of 'bip341' (taproot-tweaked).
// The correct call for a P2TR-spending input is `signer.sign(sighash, 'bip341')`;
// using 'bip340' produces a 64-byte signature over the BIP-341 sighash with
// the untweaked secret. scure accepts this for `tapKeySig`, finalizes the
// tx, and the resulting hex broadcasts cleanly to the local pool, but
// consensus rejects it because the verifier checks against Q = P + tG.
const sighash = tx.preimageWitnessV1(0, [prevOutScript], SigHash.DEFAULT, [amount]);
const wrongSig = signer.sign(sighash, 'bip340');

tx.updateInput(0, { tapKeySig: wrongSig });
tx.finalize();
const rawHex = tx.hex;
console.log(`[4] Built P2TR-spending tx signed with WRONG scheme 'bip340'`);
console.log(`    raw tx hex (first 64 chars): ${rawHex.slice(0, 64)}...`);

// ─── Step 5: Broadcast - MUST be rejected ───────────────────────────────────

let broadcastError: unknown;
try {
  await bitcoin.rest.transaction.send(rawHex);
} catch(e) {
  broadcastError = e;
}

if(!broadcastError) {
  console.error(`\n══ FAIL: Bitcoin ACCEPTED a P2TR-spending tx signed with the untweaked secret. ══`);
  console.error(`The BIP-341 tweak contract requires tapKeySig to verify against Q = P + tG,`);
  console.error(`so this acceptance contradicts consensus expectations.`);
  process.exit(1);
}

const errStr = (broadcastError as any).data.data;
console.log(`\n[5] Broadcast REJECTED as expected:`);
console.log(`    ${errStr.split('\n')[0]}`);

// The reject reason MUST be a script-verify failure. Any other reason (e.g.
// `bad-txns-inputs-missingorspent`) means we failed to even reach the
// verifier, which would make this test useless.
assert.ok(
  errStr.includes('script-verify-flag-failed') || errStr.includes('Invalid Schnorr signature'),
  `expected a script-verify rejection, got: ${errStr}`,
);

console.log(`\n══ E2E PASSED (negative): untweaked P2TR signing rejected by consensus ══`);
console.log(`  Confirms BIP-341 §3: tapKeySig must verify against the tweaked output`);
console.log(`  internal key Q, not against the untweaked Schnorr pubkey P.`);
process.exit(0);

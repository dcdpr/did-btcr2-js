/**
 * E2E: Watch-only KeyManager entry rejected at the api/method layer.
 *
 * A `KeyManager` entry can be imported as public-key-only (watch-only) when
 * the caller has the pubkey but not the secret. Attempting to sign with such
 * an entry must fail with a clear `KEY_NOT_SIGNER` error surfaced at the api
 * layer — NOT deep inside scure-btc-signer where the failure mode becomes
 * opaque ("input not finalized" or similar).
 *
 * This script imports a watch-only entry, constructs a `KeyManagerSigner`
 * wrapping it, drives the full update path through `Updater.sign`, and
 * asserts the rejection happens at the KeyManager.sign() boundary with the
 * documented error code.
 *
 * Env:
 *   BITCOIN_NETWORK   default: regtest
 *   BEACON_KIND       default: p2pkh — one of p2pkh|p2wpkh|p2tr
 */
import assert from 'node:assert/strict';
import { KeyManagerError } from '@did-btcr2/common';
import { KeyManagerSigner, LocalKeyManager } from '@did-btcr2/key-manager';
import { SchnorrKeyPair } from '@did-btcr2/keypair';
import { DidBtcr2, Identifier, Resolver, Updater } from '@did-btcr2/method';
import { bitcoinFor, parseNetworkEnv } from './_e2e-helpers.js';

const NETWORK = parseNetworkEnv();

const KIND_INDEX = { p2pkh: 0, p2wpkh: 1, p2tr: 2 } as const;
type Kind = keyof typeof KIND_INDEX;
const KIND = (process.env.BEACON_KIND ?? 'p2pkh') as Kind;
if(!(KIND in KIND_INDEX)) {
  throw new Error(`BEACON_KIND must be one of p2pkh|p2wpkh|p2tr; got "${KIND}".`);
}

console.log(`E2E: watch-only KeyManager rejection / ${KIND.toUpperCase()} against ${NETWORK}\n`);

// ─── Step 1: Connect (REST only — we don't reach broadcast) ─────────────────

const bitcoin = bitcoinFor(NETWORK);
console.log(`[1] Connected to ${NETWORK}, height: ${await bitcoin.rest.block.count()}`);

// ─── Step 2: Watch-only KeyManager entry ────────────────────────────────────

// First generate a full keypair so we have a valid pubkey, then import only
// the public side. The KeyManager stores `publicKey` and leaves `secretKey`
// undefined — this is the watch-only path (a wallet observer, not a signer).
const fullKp = SchnorrKeyPair.generate();
const watchOnlyKp = new SchnorrKeyPair({ publicKey: fullKp.publicKey });

const km = new LocalKeyManager();
const watchOnlyId = km.importKey(watchOnlyKp, { setActive: true });
const signer = new KeyManagerSigner(km, watchOnlyId);

console.log(`[2] Imported watch-only entry: ${watchOnlyId}`);
console.log(`    signer.publicKey resolves (pubkey IS present): ${signer.publicKey.length}-byte key`);

// ─── Step 3: Build the unsigned update (this part succeeds — no signing yet) ─

const did = DidBtcr2.create(signer.publicKey, { idType: 'KEY', network: NETWORK });
const sourceDoc = Resolver.deterministic(Identifier.decode(did));
const vm = sourceDoc.verificationMethod![0]!;
const unsigned = Updater.construct(sourceDoc, [{
  op    : 'add',
  path  : '/service/3',
  value : {
    id              : `${did}#watch-only-attempt`,
    type            : 'DecentralizedWebNode',
    serviceEndpoint : 'http://example.com/watch-only',
  },
}], 1);
console.log(`[3] Unsigned update constructed (pure, no signing required)`);

// ─── Step 4: Updater.sign MUST throw KEY_NOT_SIGNER ─────────────────────────

let thrown: unknown;
try {
  Updater.sign(did, unsigned, vm, signer);
} catch(e) {
  thrown = e;
}

if(!thrown) {
  console.error(`\n══ FAIL: Updater.sign succeeded for a watch-only entry! ══`);
  console.error(`A signed update was produced from an entry with no secret key.`);
  console.error(`This means the watch-only guard at KeyManager.sign() was bypassed`);
  console.error(`or the Updater silently substituted some other signing material.`);
  process.exit(1);
}

console.log(`\n[4] Updater.sign threw as expected:`);
console.log(`    type: ${thrown.constructor.name}`);
console.log(`    message: ${(thrown as Error).message}`);

assert.ok(
  thrown instanceof KeyManagerError,
  `expected KeyManagerError, got ${(thrown as Error).constructor.name}: ${(thrown as Error).message}`,
);
assert.equal(
  (thrown as KeyManagerError & { type?: string }).type,
  'KEY_NOT_SIGNER',
  'error type must be KEY_NOT_SIGNER (the documented contract)',
);

// ─── Step 5: Sentinel — error did NOT come from scure or some other layer ───
//
// If the watch-only guard ever regresses, the failure might still happen,
// but it would happen deeper (e.g., scure rejects an unsigned input at
// finalize, or noble throws on a zero scalar). Such failures would be
// confusing for callers — the api contract says "fail fast at sign()".

const errMsg = (thrown as Error).message.toLowerCase();
assert.ok(
  errMsg.includes('not a signing key') || errMsg.includes('signer'),
  `error message must indicate the entry lacks signing material, got: ${errMsg}`,
);

console.log(`\n══ E2E PASSED: watch-only rejection happens at api layer ══`);
console.log(`  Error surfaced at Updater.sign -> KeyManagerSigner.sign -> KeyManager.sign.`);
console.log(`  Caller gets KEY_NOT_SIGNER immediately, not an opaque scure/noble error.`);
process.exit(0);

/**
 * E2E: Updater.sign refuses a watch-only KeyManager entry.
 *
 * A caller can import a `KeyManager` entry with only the public key (a
 * watch-only entry). A signature with such an entry must fail at
 * `Updater.sign`, before any transaction, with a clear error. It must not fail
 * deep inside scure-btc-signer, where the error is not clear ("input not
 * finalized", for example).
 *
 * This script imports a watch-only entry and makes a `KeyManagerSigner` for it.
 * Then it signs an update with `Updater.sign`. `Updater.sign` must throw an
 * `UpdateError` of type `INVALID_DID_UPDATE`. The `cause` in the error data
 * must be the `KEY_NOT_SIGNER` error of `KeyManager.sign()`.
 *
 * Env:
 *   BITCOIN_NETWORK   default: regtest
 *   BEACON_KIND       default: p2pkh - one of p2pkh|p2wpkh|p2tr
 */
import assert from 'node:assert/strict';
import { INVALID_DID_UPDATE, UpdateError } from '@did-btcr2/std';
import { KeyManagerSigner, LocalKeyManager } from '@did-btcr2/key-manager';
import { SchnorrKeyPair } from '@did-btcr2/keys';
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

// ─── Step 1: Connect (REST only - we don't reach broadcast) ─────────────────

const bitcoin = bitcoinFor(NETWORK);
console.log(`[1] Connected to ${NETWORK}, height: ${await bitcoin.rest.block.count()}`);

// ─── Step 2: Watch-only KeyManager entry ────────────────────────────────────

// First generate a full keypair so we have a valid pubkey, then import only
// the public side. The KeyManager stores `publicKey` and leaves `secretKey`
// undefined: this is the watch-only path (a wallet observer, not a signer).
const fullKp = SchnorrKeyPair.generate();
const watchOnlyKp = new SchnorrKeyPair({ publicKey: fullKp.publicKey });

const km = new LocalKeyManager();
const watchOnlyId = km.importKey(watchOnlyKp, { setActive: true });
const signer = new KeyManagerSigner(km, watchOnlyId);

console.log(`[2] Imported watch-only entry: ${watchOnlyId}`);
console.log(`    signer.publicKey resolves (pubkey IS present): ${signer.publicKey.length}-byte key`);

// ─── Step 3: Build the unsigned update (this part succeeds - no signing yet) ─

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

// ─── Step 4: Updater.sign must throw, with KEY_NOT_SIGNER as the cause ──────

let thrown: unknown;
try {
  Updater.sign(sourceDoc, unsigned, vm.id, signer);
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
  thrown instanceof UpdateError,
  `expected UpdateError, got ${(thrown as Error).constructor.name}: ${(thrown as Error).message}`,
);
assert.equal(thrown.type, INVALID_DID_UPDATE, 'error type must be INVALID_DID_UPDATE');
// The cause is the error of KeyManager.sign(). Its type is the documented contract.
const methodId = `${did}#initialKey`;
const notSignerMessage = `Key is not a signing key: ${watchOnlyId}`;
assert.deepEqual(
  thrown.data,
  { verificationMethodId: methodId, cause: { type: 'KEY_NOT_SIGNER', message: notSignerMessage } },
  'data.cause must be the KEY_NOT_SIGNER error of KeyManager.sign()',
);

// ─── Step 5: Sentinel - error did NOT come from scure or some other layer ───
//
// If the watch-only guard ever regresses, the failure can still occur, but at
// a deeper layer (scure refuses an unsigned input at finalize, or noble throws
// on a zero scalar, for example). Such an error is not clear to the caller:
// the contract is "fail fast at sign()". The message must name the method and
// the error of KeyManager.sign().

assert.equal(
  thrown.message,
  `Invalid update: cannot make the proof with "${methodId}": ${notSignerMessage}`,
  'the message must name the method and the error of KeyManager.sign()',
);

console.log(`\n══ E2E PASSED: Updater.sign refuses the watch-only entry ══`);
console.log(`  KeyManager.sign threw KEY_NOT_SIGNER. Updater.sign wrapped it as INVALID_DID_UPDATE with the cause.`);
console.log(`  The caller gets the error before any transaction, not an opaque scure/noble error.`);
process.exit(0);

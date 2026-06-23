/**
 * E2E: External KeyManager adapter against a live Bitcoin regtest node.
 *
 * Validates the BYO-KMS direction: a non-`LocalKeyManager` implementation of
 * the `KeyManager` interface can drive the full DID-update + beacon-broadcast
 * flow without any code path quietly depending on the bundled reference
 * implementation.
 *
 * The adapter is a minimal stub: a private in-process `Map` backing store and
 * direct noble-curves calls for sign/verify. It does NOT call into
 * `LocalKeyManager`. If `KeyManagerSigner`, `Updater`, or `Beacon` ever
 * implicitly require `LocalKeyManager` (instanceof check, or quirk of its
 * URN format, or anything else), this script fails.
 *
 * The same stub shape is what a real AWS KMS / GCP KMS / HashiCorp Vault
 * adapter would look like, with the in-process Map replaced by an SDK client.
 *
 * Env:
 *   BITCOIN_NETWORK   default: regtest
 *   BEACON_KIND       default: p2pkh - one of p2pkh|p2wpkh|p2tr
 */
import assert from 'node:assert/strict';
import type { Bytes, HashBytes, KeyBytes, SignatureBytes } from '@did-btcr2/common';
import { canonicalHash, KeyManagerError } from '@did-btcr2/common';
import { SchnorrMultikey } from '@did-btcr2/cryptosuite';
import type {
  GenerateKeyOptions,
  ImportKeyOptions,
  KeyIdentifier,
  KeyManager,
  SignOptions,
  VerifyOptions,
} from '@did-btcr2/key-manager';
import { KeyManagerSigner } from '@did-btcr2/key-manager';
import { SchnorrKeyPair } from '@did-btcr2/keypair';
import { schnorr, secp256k1 } from '@noble/curves/secp256k1.js';
import { sha256 } from '@noble/hashes/sha2.js';
import { randomBytes } from '@noble/hashes/utils.js';
import { taprootTweakPrivKey } from '@scure/btc-signer/utils.js';
import { BeaconSignalDiscovery, DidBtcr2, Identifier, Resolver, Updater } from '@did-btcr2/method';
import { bitcoinFor, confirmBroadcast, fundBeacon, parseNetworkEnv, persistKey } from './_e2e-helpers.js';

const NETWORK = parseNetworkEnv();

const KIND_INDEX = { p2pkh: 0, p2wpkh: 1, p2tr: 2 } as const;
type Kind = keyof typeof KIND_INDEX;
const KIND = (process.env.BEACON_KIND ?? 'p2pkh') as Kind;
if(!(KIND in KIND_INDEX)) {
  throw new Error(`BEACON_KIND must be one of p2pkh|p2wpkh|p2tr; got "${KIND}".`);
}

/**
 * StubKeyManager: minimal `KeyManager` implementation that does NOT delegate
 * to `LocalKeyManager`. Mimics the shape an external KMS adapter (AWS, Vault,
 * HSM) would have: a private store and direct crypto calls. Identified by a
 * distinct URN namespace (`urn:external-kms:...`) to make stub-vs-bundled
 * easy to spot in logs.
 */
class StubKeyManager implements KeyManager {
  readonly #store = new Map<KeyIdentifier, { secretKey?: KeyBytes; publicKey: KeyBytes }>();
  #activeKeyId?: KeyIdentifier;

  get activeKeyId(): KeyIdentifier | undefined {
    return this.#activeKeyId;
  }

  setActiveKey(id: KeyIdentifier): void {
    if(!this.#store.has(id)) throw new KeyManagerError(`Key not found: ${id}`, 'KEY_NOT_FOUND');
    this.#activeKeyId = id;
  }

  importKey(kp: SchnorrKeyPair, options: ImportKeyOptions = {}): KeyIdentifier {
    const pub = kp.publicKey.compressed;
    const id = options.id ?? this.#mintId(pub);
    if(this.#store.has(id)) throw new KeyManagerError(`Key already exists: ${id}`, 'KEY_FOUND');
    const entry: { secretKey?: KeyBytes; publicKey: KeyBytes } = { publicKey: pub };
    try { if(kp.secretKey) entry.secretKey = kp.secretKey.bytes; } catch { /* watch-only */ }
    this.#store.set(id, entry);
    if(options.setActive) this.#activeKeyId = id;
    return id;
  }

  removeKey(id: KeyIdentifier, options: { force?: boolean } = {}): void {
    if(this.#activeKeyId === id && !options.force) {
      throw new KeyManagerError('Cannot remove active key', 'ACTIVE_KEY_DELETE');
    }
    if(!this.#store.delete(id)) throw new KeyManagerError(`Key not found: ${id}`, 'KEY_NOT_FOUND');
    if(this.#activeKeyId === id) this.#activeKeyId = undefined;
  }

  listKeys(): KeyIdentifier[] {
    return Array.from(this.#store.keys());
  }

  getPublicKey(id?: KeyIdentifier): KeyBytes {
    return this.#entry(id).publicKey;
  }

  sign(data: Bytes, id?: KeyIdentifier, options: SignOptions = {}): SignatureBytes {
    const entry = this.#entry(id);
    if(!entry.secretKey) {
      throw new KeyManagerError(`Key is not a signing key: ${id ?? this.#activeKeyId}`, 'KEY_NOT_SIGNER');
    }
    const scheme = options.scheme ?? 'bip340';
    if(scheme === 'ecdsa') {
      return secp256k1.sign(data, entry.secretKey, { format: 'der', lowS: true, prehash: false });
    }
    if(scheme === 'bip340') {
      return schnorr.sign(data, entry.secretKey, randomBytes(32));
    }
    if(scheme === 'bip341') {
      const tweaked = taprootTweakPrivKey(entry.secretKey, options.merkleRoot ?? new Uint8Array(0));
      return schnorr.sign(data, tweaked, randomBytes(32));
    }
    throw new KeyManagerError(`Unsupported scheme: ${scheme as string}`, 'SIGN_ERROR');
  }

  verify(signature: SignatureBytes, data: Bytes, id?: KeyIdentifier, options: VerifyOptions = {}): boolean {
    const entry = this.#entry(id);
    const scheme = options.scheme ?? 'bip340';
    if(scheme === 'ecdsa') {
      return secp256k1.verify(signature, data, entry.publicKey, { format: 'der', prehash: false });
    }
    return schnorr.verify(signature, data, entry.publicKey.slice(1, 33));
  }

  digest(data: Uint8Array): HashBytes {
    return sha256(data);
  }

  generateKey(options: GenerateKeyOptions = {}): KeyIdentifier {
    return this.importKey(SchnorrKeyPair.generate(), options);
  }

  #entry(id?: KeyIdentifier): { secretKey?: KeyBytes; publicKey: KeyBytes } {
    const keyId = id ?? this.#activeKeyId;
    if(!keyId) throw new KeyManagerError('No active key set', 'ACTIVE_KEY_NOT_SET');
    const entry = this.#store.get(keyId);
    if(!entry) throw new KeyManagerError(`Key not found: ${keyId}`, 'KEY_NOT_FOUND');
    return entry;
  }

  #mintId(pub: KeyBytes): KeyIdentifier {
    const fp = Array.from(sha256(pub).slice(0, 8))
      .map(b => b.toString(16).padStart(2, '0')).join('');
    return `urn:external-kms:secp256k1:${fp}`;
  }
}

console.log(`E2E: external KeyManager / ${KIND.toUpperCase()} update against ${NETWORK}\n`);

// ─── Step 1: Connect to Bitcoin ─────────────────────────────────────────────

const bitcoin = bitcoinFor(NETWORK);
console.log(`[1] Connected to ${NETWORK}, height: ${await bitcoin.rest.block.count()}`);

// ─── Step 2: Stub KeyManager + key import (NOT LocalKeyManager) ─────────────

const externalKm = new StubKeyManager();
const kp = SchnorrKeyPair.generate();
const keyId = externalKm.importKey(kp, { setActive: true });

// Sanity: the stub is NOT a LocalKeyManager. Catches accidental coupling.
assert.ok(keyId.startsWith('urn:external-kms:'), 'stub minted its own URN namespace');

const signer = new KeyManagerSigner(externalKm, keyId);
console.log(`[2] StubKeyManager backing KeyManagerSigner (id: ${keyId})`);

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
  label          : `external-kms-${KIND}`,
});

// ─── Step 4: Fund + confirm ─────────────────────────────────────────────────

console.log(`\n[4] Funding ${beaconAddress} ...`);
const { minerAddr } = await fundBeacon({ beaconAddress, bitcoin, network: NETWORK });
console.log(`    funded + confirmed + indexed`);

// ─── Step 5: Construct + sign via external KeyManager ───────────────────────

const vm = sourceDocument.verificationMethod![0]!;
const unsigned = Updater.construct(sourceDocument, [{
  op    : 'add',
  path  : '/service/3',
  value : {
    id              : `${did}#external-km`,
    type            : 'DecentralizedWebNode',
    serviceEndpoint : 'http://example.com/external-km',
  },
}], 1);

const signed = Updater.sign(did, unsigned, vm, signer);
console.log(`\n[5] Signed via external KeyManager`);

const verifierMultikey = SchnorrMultikey.fromVerificationMethod(vm);
assert.equal(verifierMultikey.toCryptosuite().verifyProof(signed).verified, true);
console.log(`    DI proof verifies (external-signed) ✓`);

// ─── Step 6: Broadcast ──────────────────────────────────────────────────────

console.log(`\n[6] Broadcasting ...`);
await Updater.announce(beaconService, signed, signer, bitcoin);
await confirmBroadcast({ bitcoin, network: NETWORK, minerAddr, watchAddress: beaconAddress });
console.log(`    accepted + confirmed`);

// ─── Step 7: Discover ───────────────────────────────────────────────────────

const expectedHashHex = canonicalHash(signed, { encoding: 'hex' });
const discovered = await BeaconSignalDiscovery.indexer([beaconService], bitcoin);
const signals = discovered.get(beaconService) ?? [];
const match = signals.find((s) => s.signalBytes === expectedHashHex);
assert.ok(match, `expected signal ${expectedHashHex} on chain`);
console.log(`[7] Signal discovered at height ${match.blockMetadata.height}`);

console.log(`\n══ E2E PASSED (external KeyManager / ${KIND.toUpperCase()}) ══`);
console.log(`  DID:               ${did}`);
console.log(`  External KM keyId: ${keyId}`);
console.log(`  Signal hash:       ${expectedHashHex}`);
process.exit(0);

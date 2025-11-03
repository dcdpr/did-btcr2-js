/* eslint-disable no-undef */
import { KeyManagerError, Logger } from '@did-btcr2/common';
import { sha256 } from '@noble/hashes/sha2.js';
import { CryptoBox } from './crypto-box.js';
import { KeyManager } from './interface.js';
import { Secp256k1SchnorrProvider, type AlgoProvider } from './providers/secp256k1.js';
import { FileEncryptedStore, KeyValueStore } from './stores/file-encrypted.js';
import type { Algo, Capability, KeyHandle, KeyIdentifier, KeyRecord } from './types.js';
import { makeKeyUri } from './uris.js';

export type KmsOptions = {
  keyUri?: KeyIdentifier;
  keyPair?: { publicKey: Uint8Array; secretKey: Uint8Array }; // optional legacy import
  store?: KeyValueStore<KeyIdentifier, KeyRecord>;
  exportable?: boolean;
  passphrase?: string;
};

export class Kms implements KeyManager {
  static #instance?: Kms;

  public activeKeyUri?: KeyIdentifier;

  readonly #store: KeyValueStore<KeyIdentifier, KeyRecord>;
  readonly #box: CryptoBox;
  readonly #providers = new Map<Algo, AlgoProvider>();
  #unlockedPassphrase?: string;
  #lockTimer?: NodeJS.Timeout;

  private constructor(store?: KeyValueStore<KeyIdentifier, KeyRecord>) {
    this.#store = store ?? new FileEncryptedStore('.kms'); // default folder in CWD
    this.#box = new CryptoBox();
    const schnorr = new Secp256k1SchnorrProvider();
    this.#providers.set(schnorr.algo, schnorr);
  }

  public static async initialize(opts: KmsOptions = {}): Promise<Kms> {
    if (Kms.#instance) {
      Logger.warn('Kms global instance is already initialized.');
      return Kms.#instance;
    }
    const km = new Kms(opts.store);
    Kms.#instance = km;

    if (opts.keyPair) {
      if (!opts.passphrase) throw new KeyManagerError('passphrase required to import key', 'INVALID_PARAMS');
      const algo: Algo = 'secp256k1-schnorr';
      const keyUri = makeKeyUri('local', algo, opts.keyPair.publicKey);
      await km.#saveNewSecretKey({
        algo,
        keyUri,
        publicKey  : opts.keyPair.publicKey,
        secretKey  : opts.keyPair.secretKey,
        exportable : !!opts.exportable,
        passphrase : opts.passphrase
      });
      km.activeKeyUri = opts.keyUri ?? keyUri;
    } else if (opts.keyUri) {
      km.activeKeyUri = opts.keyUri;
    }
    return km;
  }

  public static get instance(): Kms {
    if (!Kms.#instance) {
      throw new KeyManagerError('Kms not initialized. Call initialize() first.', 'KEY_MANAGER_NOT_INITIALIZED');
    }
    return Kms.#instance;
  }

  public async unlock(passphrase: string, idleMs = 5 * 60 * 1000): Promise<void> {
    this.#unlockedPassphrase = passphrase;
    this.#resetLock(idleMs);
  }

  public lock(): void {
    if (this.#lockTimer) clearTimeout(this.#lockTimer);
    this.#lockTimer = undefined;
    if (this.#unlockedPassphrase) {
      this.#unlockedPassphrase = this.#unlockedPassphrase.replace(/./g, '\0');
    }
    this.#unlockedPassphrase = undefined;
  }

  public isLocked(): boolean {
    return !this.#unlockedPassphrase;
  }

  #resetLock(idleMs: number) {
    if (this.#lockTimer) clearTimeout(this.#lockTimer);
    this.#lockTimer = setTimeout(() => this.lock(), idleMs);
  }

  public async sign(data: Uint8Array, keyUri?: KeyIdentifier): Promise<Uint8Array> {
    const handle = await this.requestHandle(keyUri ?? this.activeKeyUri!, ['sign', 'readPublic']);
    this.#resetLock(5 * 60 * 1000);
    return await handle.sign!(data);
  }

  public async verify(signature: Uint8Array, data: Uint8Array, keyUri?: KeyIdentifier): Promise<boolean> {
    const rec = await this.#getRecordOrThrow(keyUri ?? this.activeKeyUri!);
    const provider = this.#providers.get(rec.algo)!;
    return provider.verify(rec.publicKey, signature, data);
  }

  public digest(data: Uint8Array): Uint8Array {
    return sha256(data);
  }

  public async signTransaction(_txHex: string, _keyUri?: KeyIdentifier): Promise<string> {
    throw new Error('signTransaction not implemented yet');
  }

  public async importKey(secretKey: Uint8Array, publicKey: Uint8Array, opts: {
    algo?: Algo;
    exportable?: boolean;
    passphrase?: string;
    active?: boolean;
  } = {}): Promise<KeyIdentifier> {
    const algo = opts.algo ?? 'secp256k1-schnorr';
    const passphrase = opts.passphrase ?? this.#unlockedPassphrase;
    if (!passphrase) throw new KeyManagerError('unlock or provide passphrase to import', 'LOCKED');
    const keyUri = makeKeyUri('local', algo, publicKey);
    await this.#saveNewSecretKey({ algo, keyUri, publicKey, secretKey, exportable: !!opts.exportable, passphrase });
    if (opts.active) this.activeKeyUri = keyUri;
    return keyUri;
  }

  public async generate(opts: {
    algo?: Algo;
    derivation?: string;
    exportable?: boolean;
    active?: boolean;
    passphrase?: string;
  } = {}): Promise<KeyIdentifier> {
    const algo = opts.algo ?? 'secp256k1-schnorr';
    const passphrase = opts.passphrase ?? this.#unlockedPassphrase;
    if (!passphrase) throw new KeyManagerError('unlock or provide passphrase to generate', 'LOCKED');
    const provider = this.#providers.get(algo);
    if (!provider) throw new Error(`No provider registered for ${algo}`);
    const { publicKey, secret } = await provider.generate();
    const keyUri = makeKeyUri('local', algo, publicKey, opts.derivation);
    await this.#saveNewSecretKey({ algo, keyUri, publicKey, secretKey: secret, exportable: !!opts.exportable, passphrase });
    if (opts.active) this.activeKeyUri = keyUri;
    secret.fill(0);
    return keyUri;
  }

  public async requestHandle(keyUri: KeyIdentifier, caps: Capability[]): Promise<KeyHandle> {
    if (!keyUri) throw new KeyManagerError('No key URI provided or active', 'ACTIVE_KEY_URI_NOT_SET');
    const rec = await this.#getRecordOrThrow(keyUri);

    const provider = this.#providers.get(rec.algo);
    if (!provider) throw new Error(`No provider for ${rec.algo}`);

    const allowSign = caps.includes('sign');
    const handle: KeyHandle = {
      keyUri,
      algo         : rec.algo,
      capabilities : caps,
      getPublic    : async () => rec.publicKey
    };

    if (allowSign) {
      handle.sign = async (msg: Uint8Array) => {
        const passphrase = this.#unlockedPassphrase;
        if (!passphrase) throw new KeyManagerError('KMS is locked', 'LOCKED');
        const box = rec.encryptedSecret;
        if (!box) throw new KeyManagerError('Key has no secret material (external?)', 'KEY_NOT_SIGNER');
        const secret = this.#box.unwrap(box, passphrase);
        try {
          const sig = await provider.sign(secret, msg);
          return sig;
        } finally {
          secret.fill(0);
        }
      };
    }

    return handle;
  }

  async #getRecordOrThrow(keyUri: KeyIdentifier): Promise<KeyRecord> {
    const rec = await this.#store.get(keyUri);
    if (!rec) {
      throw new KeyManagerError(`Key not found for URI: ${keyUri}`, 'KEY_NOT_FOUND');
    }
    return rec;
  }

  async #saveNewSecretKey(args: {
    algo: Algo;
    keyUri: KeyIdentifier;
    publicKey: Uint8Array;
    secretKey: Uint8Array;
    exportable: boolean;
    passphrase: string;
  }) {
    const now = new Date().toISOString();
    const encryptedSecret = this.#box.wrap(args.secretKey, args.passphrase);
    const record: KeyRecord = {
      keyUri     : args.keyUri,
      algo       : args.algo,
      publicKey  : args.publicKey,
      createdAt  : now,
      encryptedSecret,
      exportable : args.exportable,
      usage      : ['sign'],
      scope      : 'local'
    };
    await this.#store.set(args.keyUri, record);
  }
}

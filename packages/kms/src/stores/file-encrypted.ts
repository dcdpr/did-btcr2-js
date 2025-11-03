import { promises as fsp } from 'node:fs';
import { dirname, join } from 'node:path';
import { mkdir } from 'node:fs/promises';
import type { KeyIdentifier, KeyRecord } from '../types.js';

export interface KeyValueStore<K, V> {
  get(key: K): Promise<V | undefined>;
  set(key: K, val: V): Promise<void>;
  delete(key: K): Promise<void>;
  list(): Promise<V[]>;
}

export class FileEncryptedStore implements KeyValueStore<KeyIdentifier, KeyRecord> {
  constructor(private readonly dir: string) {}

  private pathFor(keyUri: string): string {
    const safe = keyUri.replace(/[:/\\@]/g, '_');
    return join(this.dir, `${safe}.json`);
  }

  async get(key: KeyIdentifier): Promise<KeyRecord | undefined> {
    try {
      const p = this.pathFor(key);
      const buf = await fsp.readFile(p);
      const json = JSON.parse(buf.toString());
      return {
        ...json,
        publicKey       : Uint8Array.from(json.publicKey.data ?? json.publicKey),
        encryptedSecret : json.encryptedSecret
          ? {
            ...json.encryptedSecret,
            salt       : Uint8Array.from(json.encryptedSecret.salt.data ?? json.encryptedSecret.salt),
            nonce      : Uint8Array.from(json.encryptedSecret.nonce.data ?? json.encryptedSecret.nonce),
            ciphertext : Uint8Array.from(json.encryptedSecret.ciphertext.data ?? json.encryptedSecret.ciphertext)
          }
          : undefined
      } as KeyRecord;
    } catch (e: any) {
      if (e.code === 'ENOENT') return undefined;
      throw e;
    }
  }

  async set(key: KeyIdentifier, val: KeyRecord): Promise<void> {
    await mkdir(dirname(this.pathFor(key)), { recursive: true });
    const replacer = (_k: string, v: any) =>
      v instanceof Uint8Array ? Array.from(v) : v;
    await fsp.writeFile(this.pathFor(key), JSON.stringify(val, replacer, 2));
  }

  async delete(key: KeyIdentifier): Promise<void> {
    try {
      await fsp.unlink(this.pathFor(key));
    } catch (e: any) {
      if (e.code !== 'ENOENT') throw e;
    }
  }

  async list(): Promise<KeyRecord[]> {
    const entries = await fsp.readdir(this.dir).catch(() => []);
    const out: KeyRecord[] = [];
    for (const f of entries) {
      if (!f.endsWith('.json')) continue;
      const rec = await this.get(f.replace(/\.json$/, ''));
      if (rec) out.push(rec);
    }
    return out;
  }
}

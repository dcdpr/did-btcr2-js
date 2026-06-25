import { SchnorrKeyPair } from '@did-btcr2/keypair';
import { base64urlnopad } from '@scure/base';
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { ArgonParams } from '../src/keystore/envelope.js';
import { FileBackedKeyManager } from '../src/keystore/file-backed-key-manager.js';
import { expect } from './helpers.js';

const FAST: ArgonParams = { t: 1, m: 256, p: 1, dkLen: 32 };

describe('FileBackedKeyManager', () => {
  let dir: string;
  let path: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'btcr2-fbkm-'));
    path = join(dir, 'keystore.json');
  });

  afterEach(() => { rmSync(dir, { recursive: true, force: true }); });

  function open(): FileBackedKeyManager {
    return new FileBackedKeyManager({ path, getPassphrase: () => 'pw', argonParams: FAST });
  }

  it('persists the active pointer set via generateKey({ setActive }) across instances', () => {
    const id = open().generateKey({ setActive: true });
    expect(open().activeKeyId).to.equal(id);
  });

  it('persists the active pointer set via setActiveKey across instances', () => {
    const km = open();
    const a = km.generateKey();
    km.generateKey({ setActive: true });
    km.setActiveKey(a);
    expect(open().activeKeyId).to.equal(a);
  });

  it('clears the persisted active pointer when the active key is removed', () => {
    const km = open();
    const id = km.generateKey({ setActive: true });
    km.removeKey(id, { force: true });
    expect(open().activeKeyId).to.equal(undefined);
  });

  it('signs and verifies through the inner manager', () => {
    const km = open();
    const id = km.generateKey({ setActive: true });
    const digest = km.digest(new Uint8Array([1, 2, 3]));
    const sig = km.sign(digest, id);
    expect(km.verify(sig, digest, id)).to.equal(true);
  });

  it('exports a generated signing key', () => {
    const km = open();
    const id = km.generateKey();
    expect(km.exportKey(id).secretKey).to.exist;
  });

  it('ignores a dangling persisted active pointer instead of bricking', () => {
    const id = 'urn:kms:secp256k1:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
    const pub = base64urlnopad.encode(SchnorrKeyPair.generate().publicKey.compressed);
    writeFileSync(path, JSON.stringify({
      v      : 1,
      active : 'urn:kms:secp256k1:ffffffffffffffffffffffffffffffff',
      keys   : { [id]: { publicKey: pub } },
    }), { mode: 0o600 });
    chmodSync(path, 0o600);
    const km = open();
    expect(km.activeKeyId).to.equal(undefined);
    expect(km.listKeys()).to.deep.equal([id]);
  });
});

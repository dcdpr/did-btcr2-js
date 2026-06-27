import { existsSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { KeyEntry } from '@did-btcr2/key-manager';
import type { ArgonParams } from '../src/keystore/envelope.js';
import { KeyStoreError } from '../src/keystore/error.js';
import { FileKeyStore } from '../src/keystore/file-key-store.js';
import type { LockOptions } from '../src/keystore/lock.js';
import { withFileLock } from '../src/keystore/lock.js';
import { expect } from './helpers.js';

const FAST: ArgonParams = { t: 1, m: 256, p: 1, dkLen: 32 };
const PASS = 'test passphrase';

/** Watch-only entries avoid the argon2id cost; locking is independent of secret sealing. */
function watchOnlyEntry(seed: number): KeyEntry {
  return { publicKey: new Uint8Array(33).fill(seed), tags: { name: `watch-${seed}` } };
}

describe('keystore locking', () => {
  let dir: string;
  let path: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'btcr2-lock-'));
    path = join(dir, 'keystore.json');
  });

  afterEach(() => { rmSync(dir, { recursive: true, force: true }); });

  function openStore(lock?: LockOptions): FileKeyStore {
    return new FileKeyStore({ path, getPassphrase: () => PASS, argonParams: FAST, ...(lock && { lock }) });
  }

  describe('withFileLock', () => {
    it('serializes: a nested acquisition of a held lock fails with KEYSTORE_LOCKED_ERROR', () => {
      const lockPath = join(dir, 'x.lock');
      let innerRan = false;
      withFileLock(lockPath, () => {
        expect(() => withFileLock(lockPath, () => { innerRan = true; },
          { timeoutMs: 60, retryMs: 10, staleMs: 60_000 },
        )).to.throw(KeyStoreError).with.property('type', 'KEYSTORE_LOCKED_ERROR');
      }, { timeoutMs: 1000, retryMs: 10 });
      expect(innerRan).to.equal(false);
    });

    it('removes the lock file after running', () => {
      const lockPath = join(dir, 'y.lock');
      const result = withFileLock(lockPath, () => 42);
      expect(result).to.equal(42);
      expect(existsSync(lockPath)).to.equal(false);
    });

    it('releases the lock even when the body throws', () => {
      const lockPath = join(dir, 'z.lock');
      expect(() => withFileLock(lockPath, () => { throw new Error('boom'); })).to.throw('boom');
      expect(existsSync(lockPath)).to.equal(false);
    });

    it('breaks a lock whose writer process is gone', () => {
      const lockPath = join(dir, 'dead.lock');
      writeFileSync(lockPath, '999999999.0', { mode: 0o600 }); // a pid that does not exist
      let ran = false;
      withFileLock(lockPath, () => { ran = true; }, { timeoutMs: 1000, retryMs: 10 });
      expect(ran).to.equal(true);
    });

    it('breaks a lock that has aged past the stale threshold', () => {
      const lockPath = join(dir, 'old.lock');
      writeFileSync(lockPath, `${process.pid}.0`, { mode: 0o600 }); // our live pid...
      const old = new Date(Date.now() - 60_000);
      utimesSync(lockPath, old, old); // ...but backdated well past staleMs
      let ran = false;
      withFileLock(lockPath, () => { ran = true; }, { timeoutMs: 1000, retryMs: 10, staleMs: 1000 });
      expect(ran).to.equal(true);
    });
  });

  describe('FileKeyStore concurrent mutation', () => {
    it('merges a concurrent writer\'s addition instead of clobbering it', () => {
      // Both instances load the empty file, then each writes a different key.
      // Without the reload-under-lock, the second flush would drop the first key.
      const a = openStore();
      const b = openStore();
      a.set('urn:a', watchOnlyEntry(1));
      b.set('urn:b', watchOnlyEntry(2));

      const reopened = openStore();
      expect(reopened.has('urn:a')).to.equal(true);
      expect(reopened.has('urn:b')).to.equal(true);
    });

    it('merges concurrent deletes instead of resurrecting a removed key', () => {
      openStore().set('urn:a', watchOnlyEntry(1));
      openStore().set('urn:b', watchOnlyEntry(2));

      const a = openStore(); // stale snapshot {a, b}
      const b = openStore(); // stale snapshot {a, b}
      a.delete('urn:a');
      b.delete('urn:b'); // b's snapshot still held urn:a; the reload must not resurrect it

      const reopened = openStore();
      expect(reopened.has('urn:a')).to.equal(false);
      expect(reopened.has('urn:b')).to.equal(false);
    });

    it('blocks a mutation while another process holds the lock, then fails with KEYSTORE_LOCKED_ERROR', () => {
      writeFileSync(`${path}.lock`, `${process.pid}.held`, { mode: 0o600 }); // a fresh, live holder
      const store = openStore({ timeoutMs: 80, retryMs: 10, staleMs: 60_000 });
      expect(() => store.set('urn:a', watchOnlyEntry(1)))
        .to.throw(KeyStoreError).with.property('type', 'KEYSTORE_LOCKED_ERROR');

      rmSync(`${path}.lock`, { force: true }); // holder releases
      store.set('urn:a', watchOnlyEntry(1));
      expect(openStore().has('urn:a')).to.equal(true);
    });

    it('does not take the lock for reads', () => {
      openStore().set('urn:a', watchOnlyEntry(1));
      writeFileSync(`${path}.lock`, `${process.pid}.held`, { mode: 0o600 }); // hold the lock
      const store = openStore({ timeoutMs: 50, retryMs: 10, staleMs: 60_000 });

      // Reads complete despite the held lock; only mutations serialize.
      expect(store.has('urn:a')).to.equal(true);
      expect(store.list().length).to.equal(1);
      expect(store.getActive()).to.equal(undefined);
      rmSync(`${path}.lock`, { force: true });
    });

    it('leaves no lock file behind after a successful mutation', () => {
      openStore().set('urn:a', watchOnlyEntry(1));
      expect(existsSync(`${path}.lock`)).to.equal(false);
    });
  });
});

import { chmodSync, existsSync, mkdtempSync, readFileSync, rmSync, statSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { keystoreApiFactory, type ConnectionOverrides } from '../src/config.js';
import type { ArgonParams } from '../src/keystore/envelope.js';
import {
  changeKeystorePassphrase,
  FileKeyStore,
  initKeystore,
  keystoreVerifierId,
  verifyKeystorePassphrase,
} from '../src/keystore/file-key-store.js';
import { ENV_KEYSTORE_PASSPHRASE } from '../src/keystore/passphrase.js';
import {
  clearSession,
  DEFAULT_SESSION_TTL_MS,
  MAX_SESSION_TTL_MS,
  parseTtlToMs,
  readLiveSessionPassphrase,
  readSessionStatus,
  SESSION_VERSION,
  writeSession,
  type SessionFile,
} from '../src/keystore/session.js';
import { expect } from './helpers.js';

/** Low-cost argon2id so keystore-backed tests do not pay the production cost. */
const FAST: ArgonParams = { t: 1, m: 256, p: 1, dkLen: 32 };
const SECRET = new Uint8Array(32).fill(7);
const PUBLIC = new Uint8Array(33).fill(2);
const ID = 'urn:kms:secp256k1:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';

describe('session unlock agent (ADR 081)', () => {
  let dir: string;
  let home: string;
  let keystorePath: string;
  let sessionPath: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'btcr2-session-'));
    home = dir;
    keystorePath = join(home, 'keystore.json');
    sessionPath = join(home, 'session.json');
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  /** Establishes a FAST encrypted keystore holding one sealed key under `pw`. */
  function establishKeystore(pw = 'pw'): void {
    new FileKeyStore({ path: keystorePath, argonParams: FAST, getPassphrase: () => pw })
      .set(ID, { publicKey: PUBLIC, secretKey: SECRET });
  }

  /** Writes a raw session object at 0600 (bypassing writeSession) for edge cases. */
  function writeRawSession(obj: Partial<SessionFile>): void {
    writeFileSync(sessionPath, JSON.stringify(obj));
    chmodSync(sessionPath, 0o600);
  }

  describe('parseTtlToMs', () => {
    it('parses bare seconds and s/m/h suffixes', () => {
      expect(parseTtlToMs('3600')).to.equal(3_600_000);
      expect(parseTtlToMs('10s')).to.equal(10_000);
      expect(parseTtlToMs('45m')).to.equal(2_700_000);
      expect(parseTtlToMs('2h')).to.equal(7_200_000);
      expect(parseTtlToMs('0')).to.equal(0);
    });

    it('returns undefined for malformed input', () => {
      for (const bad of [ 'abc', '', '-5', '1.5', '10x', '10 m', 'm10' ]) {
        expect(parseTtlToMs(bad), bad).to.equal(undefined);
      }
    });

    it('exposes sane default and cap constants', () => {
      expect(DEFAULT_SESSION_TTL_MS).to.equal(60 * 60 * 1000);
      expect(MAX_SESSION_TTL_MS).to.equal(24 * 60 * 60 * 1000);
    });
  });

  describe('write / read round trip', () => {
    it('caches and returns the passphrase for the bound keystore', () => {
      establishKeystore();
      const vid = keystoreVerifierId(keystorePath);
      const written = writeSession(sessionPath, { keystorePath, verifierId: vid!, passphrase: 'pw', ttlMs: 60_000 });
      expect(written.v).to.equal(SESSION_VERSION);
      expect(readLiveSessionPassphrase(sessionPath, keystorePath, vid)).to.equal('pw');
    });

    it('writes the file 0600 and never stores the passphrase in the clear', () => {
      if (process.platform === 'win32') return; // POSIX perms only
      establishKeystore();
      writeSession(sessionPath, { keystorePath, verifierId: keystoreVerifierId(keystorePath)!, passphrase: 'hunter2', ttlMs: 60_000 });
      const raw = readFileSync(sessionPath, 'utf-8');
      expect(raw).to.not.include('hunter2'); // base64url-encoded, not plaintext-searchable
      expect(chmodMode(sessionPath)).to.equal(0o600);
    });

    it('round-trips a passphrase verbatim, including a trailing newline and multibyte characters', () => {
      // The cache must reproduce the passphrase byte-for-byte: it is the KDF input.
      // A trailing newline is significant (not formatting to strip) and non-ASCII
      // characters must survive the utf8/base64url encode-decode.
      for (const pw of [ 'pw\n', 'päss-🔑', 'trailing ' ]) {
        establishKeystore(pw);
        const vid = keystoreVerifierId(keystorePath);
        writeSession(sessionPath, { keystorePath, verifierId: vid!, passphrase: pw, ttlMs: 60_000 });
        expect(readLiveSessionPassphrase(sessionPath, keystorePath, vid)).to.equal(pw);
        expect(verifyKeystorePassphrase(keystorePath, pw)).to.equal(true);
        clearSession(sessionPath);
        rmSync(keystorePath, { force: true }); // re-establish under the next passphrase
      }
    });
  });

  describe('binding and staleness', () => {
    it('ignores (but does not prune) a session bound to a different keystore', () => {
      establishKeystore();
      const vid = keystoreVerifierId(keystorePath);
      writeSession(sessionPath, { keystorePath, verifierId: vid!, passphrase: 'pw', ttlMs: 60_000 });
      const otherKeystore = join(home, 'other-keystore.json');
      expect(readLiveSessionPassphrase(sessionPath, otherKeystore, keystoreVerifierId(otherKeystore))).to.equal(undefined);
      expect(existsSync(sessionPath)).to.equal(true); // a live foreign session is left in place
    });

    it('prunes a session whose keystore verifier rotated (change-passphrase)', () => {
      establishKeystore();
      const vidBefore = keystoreVerifierId(keystorePath);
      writeSession(sessionPath, { keystorePath, verifierId: vidBefore!, passphrase: 'pw', ttlMs: 60_000 });
      changeKeystorePassphrase(keystorePath, 'pw', 'new-pw', FAST);
      const vidAfter = keystoreVerifierId(keystorePath);
      expect(vidAfter).to.not.equal(vidBefore);
      expect(readLiveSessionPassphrase(sessionPath, keystorePath, vidAfter)).to.equal(undefined);
      expect(existsSync(sessionPath)).to.equal(false); // stale-for-this-keystore is pruned
    });

    it('prunes an expired session and reports it inactive', () => {
      establishKeystore();
      const vid = keystoreVerifierId(keystorePath);
      const now = Date.now();
      writeRawSession({ v: SESSION_VERSION, keystore: keystorePath, verifierId: vid!, passphrase: 'cGE', allowMainnet: false, createdAt: now - 10_000, expiresAt: now - 1, ttlSeconds: 10 });
      expect(readSessionStatus(sessionPath, keystorePath, vid).active).to.equal(false);
      expect(existsSync(sessionPath)).to.equal(true); // status does not prune
      expect(readLiveSessionPassphrase(sessionPath, keystorePath, vid)).to.equal(undefined);
      expect(existsSync(sessionPath)).to.equal(false); // consume prunes
    });

    it('refuses a future-dated session (copied file / backward clock)', () => {
      establishKeystore();
      const vid = keystoreVerifierId(keystorePath);
      const now = Date.now();
      writeRawSession({ v: SESSION_VERSION, keystore: keystorePath, verifierId: vid!, passphrase: 'cGE', allowMainnet: false, createdAt: now + 60_000, expiresAt: now + 120_000, ttlSeconds: 60 });
      expect(readLiveSessionPassphrase(sessionPath, keystorePath, vid)).to.equal(undefined);
      expect(existsSync(sessionPath)).to.equal(false);
    });

    it('refuses an unknown session version and a malformed shape', () => {
      establishKeystore();
      const vid = keystoreVerifierId(keystorePath);
      writeRawSession({ v: 2 as never, keystore: keystorePath, verifierId: vid!, passphrase: 'cGE', allowMainnet: false, createdAt: 1, expiresAt: Date.now() + 60_000, ttlSeconds: 60 });
      expect(readLiveSessionPassphrase(sessionPath, keystorePath, vid)).to.equal(undefined);
      writeFileSync(sessionPath, 'not json {');
      chmodSync(sessionPath, 0o600);
      expect(readLiveSessionPassphrase(sessionPath, keystorePath, vid)).to.equal(undefined);
    });

    it('treats a session with a missing or non-boolean allowMainnet as malformed', () => {
      establishKeystore();
      const vid = keystoreVerifierId(keystorePath);
      const base = { v: SESSION_VERSION, keystore: keystorePath, verifierId: vid!, passphrase: 'cGE', createdAt: 1, expiresAt: Date.now() + 60_000, ttlSeconds: 60 };
      writeRawSession(base); // allowMainnet omitted
      expect(readLiveSessionPassphrase(sessionPath, keystorePath, vid)).to.equal(undefined);
      expect(existsSync(sessionPath)).to.equal(false); // malformed is pruned
      writeRawSession({ ...base, allowMainnet: 'yes' as never });
      expect(readLiveSessionPassphrase(sessionPath, keystorePath, vid)).to.equal(undefined);
    });
  });

  describe('mainnet consumption gate', () => {
    it('withholds a non-mainnet-allowed session from a mainnet operation without pruning it', () => {
      establishKeystore();
      const vid = keystoreVerifierId(keystorePath);
      writeSession(sessionPath, { keystorePath, verifierId: vid!, passphrase: 'pw', ttlMs: 60_000 }); // allowMainnet defaults false
      // A mainnet operation must not consume it, but it stays valid for others.
      expect(readLiveSessionPassphrase(sessionPath, keystorePath, vid, true)).to.equal(undefined);
      expect(existsSync(sessionPath)).to.equal(true);
      expect(readLiveSessionPassphrase(sessionPath, keystorePath, vid, false)).to.equal('pw');
    });

    it('serves a mainnet-allowed session to a mainnet operation', () => {
      establishKeystore();
      const vid = keystoreVerifierId(keystorePath);
      writeSession(sessionPath, { keystorePath, verifierId: vid!, passphrase: 'pw', ttlMs: 60_000, allowMainnet: true });
      expect(readLiveSessionPassphrase(sessionPath, keystorePath, vid, true)).to.equal('pw');
    });
  });

  describe('status', () => {
    it('reports a live session with a remaining lifetime', () => {
      establishKeystore();
      const vid = keystoreVerifierId(keystorePath);
      writeSession(sessionPath, { keystorePath, verifierId: vid!, passphrase: 'pw', ttlMs: 60_000 });
      const status = readSessionStatus(sessionPath, keystorePath, vid);
      expect(status.active).to.equal(true);
      expect(status.secondsRemaining).to.be.within(1, 60);
      expect(JSON.stringify(status)).to.not.include('pw'); // never emits the passphrase
    });

    it('reports inactive when there is no session', () => {
      establishKeystore();
      expect(readSessionStatus(sessionPath, keystorePath, keystoreVerifierId(keystorePath)).active).to.equal(false);
    });

    it('reflects the mainnet allowance of a live session', () => {
      establishKeystore();
      const vid = keystoreVerifierId(keystorePath);
      writeSession(sessionPath, { keystorePath, verifierId: vid!, passphrase: 'pw', ttlMs: 60_000 });
      expect(readSessionStatus(sessionPath, keystorePath, vid).allowMainnet).to.equal(false);
      writeSession(sessionPath, { keystorePath, verifierId: vid!, passphrase: 'pw', ttlMs: 60_000, allowMainnet: true });
      expect(readSessionStatus(sessionPath, keystorePath, vid).allowMainnet).to.equal(true);
    });
  });

  describe('clearSession', () => {
    it('removes the session and reports whether one existed', () => {
      establishKeystore();
      writeSession(sessionPath, { keystorePath, verifierId: keystoreVerifierId(keystorePath)!, passphrase: 'pw', ttlMs: 60_000 });
      expect(clearSession(sessionPath)).to.equal(true);
      expect(existsSync(sessionPath)).to.equal(false);
      expect(clearSession(sessionPath)).to.equal(false); // idempotent
    });

    it('sweeps crash-orphaned temp files that would hold a plaintext passphrase', () => {
      const orphan = join(home, '.session.json.999.0.tmp');
      writeFileSync(orphan, '{"passphrase":"leak"}');
      clearSession(sessionPath);
      expect(existsSync(orphan)).to.equal(false);
    });
  });

  describe('POSIX hardening of the plaintext file', () => {
    it('refuses a symlinked session path (O_NOFOLLOW)', function () {
      if (process.platform === 'win32') return this.skip();
      establishKeystore();
      const real = join(home, 'real-session.json');
      writeSession(real, { keystorePath, verifierId: keystoreVerifierId(keystorePath)!, passphrase: 'pw', ttlMs: 60_000 });
      symlinkSync(real, sessionPath);
      expect(readLiveSessionPassphrase(sessionPath, keystorePath, keystoreVerifierId(keystorePath))).to.equal(undefined);
    });

    it('ignores and deletes a group/other-readable session file', function () {
      if (process.platform === 'win32') return this.skip();
      establishKeystore();
      const vid = keystoreVerifierId(keystorePath);
      writeSession(sessionPath, { keystorePath, verifierId: vid!, passphrase: 'pw', ttlMs: 60_000 });
      chmodSync(sessionPath, 0o644);
      expect(readLiveSessionPassphrase(sessionPath, keystorePath, vid)).to.equal(undefined);
      expect(existsSync(sessionPath)).to.equal(false); // a loose-perm plaintext file is removed
    });
  });

  describe('keystore helpers', () => {
    it('keystoreVerifierId is stable and changes on rotation; undefined for dev/absent', () => {
      expect(keystoreVerifierId(keystorePath)).to.equal(undefined); // absent
      establishKeystore();
      const a = keystoreVerifierId(keystorePath);
      expect(a).to.be.a('string');
      expect(keystoreVerifierId(keystorePath)).to.equal(a); // stable across reads
      const devPath = join(home, 'dev.json');
      initKeystore(devPath, { protection: 'none', getPassphrase: () => 'x' });
      expect(keystoreVerifierId(devPath)).to.equal(undefined); // dev has no verifier
    });

    it('verifyKeystorePassphrase accepts the right passphrase and rejects others', () => {
      establishKeystore();
      expect(verifyKeystorePassphrase(keystorePath, 'pw')).to.equal(true);
      expect(verifyKeystorePassphrase(keystorePath, 'wrong')).to.equal(false);
      expect(verifyKeystorePassphrase(join(home, 'missing.json'), 'pw')).to.equal(false);
    });

    it('the verifier id (and a live session) survives a key-adding re-flush', () => {
      // A second key re-flushes the keystore file. The verifier is preserved, so its
      // fingerprint must not change and a session bound to it must stay live: this is
      // what keeps `unlock` -> `key generate` -> ... prompt-free across commands.
      establishKeystore();
      const vid = keystoreVerifierId(keystorePath);
      writeSession(sessionPath, { keystorePath, verifierId: vid!, passphrase: 'pw', ttlMs: 60_000 });
      new FileKeyStore({ path: keystorePath, argonParams: FAST, getPassphrase: () => 'pw' })
        .set('urn:kms:secp256k1:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb', { publicKey: PUBLIC, secretKey: SECRET });
      expect(keystoreVerifierId(keystorePath)).to.equal(vid);
      expect(readLiveSessionPassphrase(sessionPath, keystorePath, keystoreVerifierId(keystorePath))).to.equal('pw');
    });
  });

  describe('getPassphrase wiring (keystoreApiFactory)', () => {
    const saved: Record<string, string | undefined> = {};
    const keys = [ 'BTCR2_HOME', ENV_KEYSTORE_PASSPHRASE ];

    beforeEach(() => { for (const k of keys) { saved[k] = process.env[k]; delete process.env[k]; } });

    afterEach(() => { for (const k of keys) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; } });

    const overrides = (): ConnectionOverrides => ({ home });

    it('a live session opens a sealed key with no env var, file, or prompt', function () {
      if (process.stdin.isTTY) return this.skip(); // relies on a non-interactive test runner
      establishKeystore();
      // Without a session, opening must fail (no env/file, non-TTY).
      expect(() => keystoreApiFactory(undefined, overrides()).kms.export(ID)).to.throw(/passphrase/i);
      // With a session, the same open succeeds and yields the secret.
      writeSession(sessionPath, { keystorePath, verifierId: keystoreVerifierId(keystorePath)!, passphrase: 'pw', ttlMs: 60_000 });
      expect(keystoreApiFactory(undefined, overrides()).kms.export(ID).secretKey.bytes).to.deep.equal(SECRET);
    });

    it('the env var wins over a session cached with a wrong passphrase', () => {
      establishKeystore();
      writeSession(sessionPath, { keystorePath, verifierId: keystoreVerifierId(keystorePath)!, passphrase: 'wrong', ttlMs: 60_000 });
      process.env[ENV_KEYSTORE_PASSPHRASE] = 'pw';
      expect(keystoreApiFactory(undefined, overrides()).kms.export(ID).secretKey.bytes).to.deep.equal(SECRET);
    });

    it('a non-mainnet session is withheld from a bitcoin operation but still serves other networks', function () {
      if (process.stdin.isTTY) return this.skip(); // relies on a non-interactive test runner
      establishKeystore();
      writeSession(sessionPath, { keystorePath, verifierId: keystoreVerifierId(keystorePath)!, passphrase: 'pw', ttlMs: 60_000 }); // allowMainnet false
      // A bitcoin-network factory derives isMainnetOperation and must not consume it.
      expect(() => keystoreApiFactory('bitcoin', overrides()).kms.export(ID)).to.throw(/passphrase/i);
      // The refused session is left in place and still opens a signet operation.
      expect(existsSync(sessionPath)).to.equal(true);
      expect(keystoreApiFactory('signet', overrides()).kms.export(ID).secretKey.bytes).to.deep.equal(SECRET);
    });

    it('a mainnet-allowed session opens a bitcoin operation prompt-free', function () {
      if (process.stdin.isTTY) return this.skip();
      establishKeystore();
      writeSession(sessionPath, { keystorePath, verifierId: keystoreVerifierId(keystorePath)!, passphrase: 'pw', ttlMs: 60_000, allowMainnet: true });
      expect(keystoreApiFactory('bitcoin', overrides()).kms.export(ID).secretKey.bytes).to.deep.equal(SECRET);
    });
  });
});

/** POSIX file mode bits, for asserting 0600. */
function chmodMode(path: string): number {
  return statSync(path).mode & 0o777;
}

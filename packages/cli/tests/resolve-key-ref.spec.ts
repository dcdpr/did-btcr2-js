import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { CLIError } from '../src/error.js';
import type { ArgonParams } from '../src/keystore/envelope.js';
import { FileBackedKeyManager } from '../src/keystore/file-backed-key-manager.js';
import { resolveKeyRef } from '../src/keystore/resolve-key-ref.js';
import { expect } from './helpers.js';

const FAST: ArgonParams = { t: 1, m: 256, p: 1, dkLen: 32 };

describe('resolveKeyRef', () => {
  let dir: string;
  let path: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'btcr2-resolveref-'));
    path = join(dir, 'keystore.json');
  });

  afterEach(() => { rmSync(dir, { recursive: true, force: true }); });

  function open(): FileBackedKeyManager {
    return new FileBackedKeyManager({ path, getPassphrase: () => 'pw', argonParams: FAST });
  }

  it('returns the active key when no reference is given', () => {
    const km = open();
    const id = km.generateKey({ setActive: true });
    expect(resolveKeyRef(km)).to.equal(id);
  });

  it('throws when no reference and no active key', () => {
    const km = open();
    km.generateKey();
    expect(() => resolveKeyRef(km)).to.throw(CLIError).with.property('type', 'INVALID_ARGUMENT_ERROR');
  });

  it('matches an exact URN identifier', () => {
    const km = open();
    const id = km.generateKey();
    expect(resolveKeyRef(km, id)).to.equal(id);
  });

  it('matches a unique fingerprint prefix', () => {
    const km = open();
    const id = km.generateKey();
    const fingerprint = id.split(':').pop()!;
    expect(resolveKeyRef(km, fingerprint.slice(0, 8))).to.equal(id);
  });

  it('matches a unique name tag', () => {
    const km = open();
    const id = km.generateKey({ tags: { name: 'alice' } });
    expect(resolveKeyRef(km, 'alice')).to.equal(id);
  });

  it('throws on an ambiguous name', () => {
    const km = open();
    km.generateKey({ tags: { name: 'dup' } });
    km.generateKey({ tags: { name: 'dup' } });
    expect(() => resolveKeyRef(km, 'dup')).to.throw(CLIError).with.property('type', 'KEY_REF_AMBIGUOUS_ERROR');
  });

  it('throws when no key matches', () => {
    const km = open();
    km.generateKey();
    expect(() => resolveKeyRef(km, 'no-such-key')).to.throw(CLIError).with.property('type', 'KEY_NOT_FOUND_ERROR');
  });
});

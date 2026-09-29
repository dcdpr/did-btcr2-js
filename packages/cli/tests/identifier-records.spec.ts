import type { DidUpdateResult, Sidecar } from '@did-btcr2/api';
import { createApi } from '@did-btcr2/api';
import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  changeFromUpdate,
  IdentifierRecords,
  mergeSidecar,
  recordAfterWork,
  withRecordSidecar,
  type RecordChange,
} from '../src/identifier-records.js';
import { expect } from './helpers.js';

/** The api of the fixtures: offline, with no connection and no key. */
const sdk = createApi();

/** A new KEY identifier on regtest. */
function keyDid(): string {
  return sdk.createDid('deterministic', sdk.crypto.keypair.generate().publicKey.compressed, { network: 'regtest' });
}

/** A sidecar data entry. The records module treats an entry as an opaque JSON object. */
const entry = (n: number): never => ({ n }) as never;

describe('identifier records (ADR 133)', () => {
  let dir: string;
  let records: IdentifierRecords;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'btcr2-records-'));
    records = new IdentifierRecords(join(dir, 'home', 'dids.json'));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('an absent file gives no records', () => {
    expect(records.list()).to.deep.equal([]);
    expect(records.get(keyDid())).to.equal(undefined);
  });

  it('record makes a record and writes the file 0600', () => {
    const did = keyDid();
    const record = records.record(did);
    expect(record.keys).to.deep.equal([]);
    expect(record.txids).to.deep.equal([]);
    expect(record.sidecar).to.deep.equal({});
    expect(Number.isNaN(Date.parse(record.added))).to.equal(false);
    const file = JSON.parse(readFileSync(records.path, 'utf-8'));
    expect(file.v).to.equal(1);
    expect(file.identifiers[did]).to.deep.equal(record);
    if (process.platform !== 'win32') expect(statSync(records.path).mode & 0o777).to.equal(0o600);
  });

  it('a signing key joins the keys once and becomes the signing key', () => {
    const did = keyDid();
    records.record(did, { signingKey: 'urn:kms:secp256k1:a' });
    records.record(did, { signingKey: 'urn:kms:secp256k1:b' });
    const record = records.record(did, { signingKey: 'urn:kms:secp256k1:a' });
    expect(record.keys).to.deep.equal([ 'urn:kms:secp256k1:a', 'urn:kms:secp256k1:b' ]);
    expect(record.signingKey).to.equal('urn:kms:secp256k1:a');
  });

  it('a transaction joins the txids once, and deactivated stays', () => {
    const did = keyDid();
    records.record(did, { txid: 'aa' });
    records.record(did, { txid: 'aa', deactivated: true });
    const record = records.record(did, { txid: 'bb' });
    expect(record.txids).to.deep.equal([ 'aa', 'bb' ]);
    expect(record.deactivated).to.equal(true);
  });

  it('keeps the records of other identifiers and the order of the first record', () => {
    const [ a, b ] = [ keyDid(), keyDid() ];
    records.record(a);
    records.record(b);
    records.record(a, { txid: 'aa' });
    expect(records.list().map(([ did ]) => did)).to.deep.equal([ a, b ]);
  });

  describe('names', () => {
    it('resolveRef returns an identifier as is, and the identifier of a name', () => {
      const did = keyDid();
      records.record(did, { name: 'alice' });
      expect(records.resolveRef('alice')).to.equal(did);
      const other = keyDid();
      expect(records.resolveRef(other)).to.equal(other);
    });

    it('resolveRef refuses a name that no record has', () => {
      expect(() => records.resolveRef('bob')).to.throw('No identifier record has the name "bob". An identifier starts with "did:btcr2:".');
    });

    it('refuses a name that another identifier has', () => {
      const [ a, b ] = [ keyDid(), keyDid() ];
      records.record(a, { name: 'alice' });
      expect(() => records.record(b, { name: 'alice' })).to.throw(`The name "alice" belongs to the identifier ${a}.`);
      expect(() => records.assertNameAvailable('alice', b)).to.throw('belongs to the identifier');
      expect(() => records.assertNameAvailable('alice')).to.throw('belongs to the identifier');
    });

    it('accepts the name of the same identifier again, and a new name for it', () => {
      const did = keyDid();
      records.record(did, { name: 'alice' });
      records.assertNameAvailable('alice', did);
      expect(records.record(did, { name: 'alice-2' }).name).to.equal('alice-2');
      expect(records.findByName('alice')).to.equal(undefined);
    });

    it('refuses an empty name and a name that starts with did:', () => {
      expect(() => records.assertNameAvailable(' ')).to.throw('--name must not be empty.');
      expect(() => records.record(keyDid(), { name: 'did:x' })).to.throw('A name must not start with "did:".');
    });
  });

  it('remove deletes a record and returns false for an identifier with no record', () => {
    const did = keyDid();
    records.record(did);
    expect(records.remove(did)).to.equal(true);
    expect(records.get(did)).to.equal(undefined);
    expect(records.remove(did)).to.equal(false);
  });

  describe('a malformed file', () => {
    it('refuses a file that is not JSON', () => {
      records.record(keyDid());
      writeFileSync(records.path, '{');
      expect(() => records.list()).to.throw(`The identifier records file ${records.path} is not valid JSON.`);
    });

    it('refuses a file of another version, and never writes over it', () => {
      records.record(keyDid());
      writeFileSync(records.path, JSON.stringify({ v: 2, identifiers: {} }));
      expect(() => records.record(keyDid())).to.throw('is not a version 1 records file.');
      expect(JSON.parse(readFileSync(records.path, 'utf-8')).v).to.equal(2);
    });
  });

  describe('mergeSidecar', () => {
    it('keeps the entries of primary first and drops an entry with the same canonical hash', () => {
      const merged = mergeSidecar(
        { updates: [ entry(1), entry(2) ] },
        { updates: [ { n: 2 } as never, entry(3) ], casUpdates: [ entry(4) ] },
      );
      expect(merged).to.deep.equal({ updates: [ entry(1), entry(2), entry(3) ], casUpdates: [ entry(4) ] });
    });

    it('the genesis document of primary wins', () => {
      const merged = mergeSidecar({ genesisDocument: { a: 1 } }, { genesisDocument: { b: 2 }, smtProofs: [ entry(5) ] });
      expect(merged).to.deep.equal({ genesisDocument: { a: 1 }, smtProofs: [ entry(5) ] });
    });

    it('gives an empty object for two empty sets', () => {
      expect(mergeSidecar({}, {})).to.deep.equal({});
    });
  });

  describe('withRecordSidecar', () => {
    const recordWith = (sidecar: Sidecar) => ({ added: '', keys: [], txids: [], sidecar });

    it('returns the options unchanged with no record or an empty record sidecar', () => {
      const options = { minConf: 3 };
      expect(withRecordSidecar(options, undefined)).to.equal(options);
      expect(withRecordSidecar(undefined, recordWith({}))).to.equal(undefined);
    });

    it('adds the record sidecar to the options, and the flag sidecar wins', () => {
      const options = { minConf: 3, sidecar: { genesisDocument: { flag: true }, updates: [ entry(1) ] } };
      const merged = withRecordSidecar(options, recordWith({ genesisDocument: { record: true }, updates: [ entry(2) ] }));
      expect(merged).to.deep.equal({
        minConf : 3,
        sidecar : { genesisDocument: { flag: true }, updates: [ entry(1), entry(2) ] },
      });
    });

    it('makes resolution options from the record sidecar alone', () => {
      expect(withRecordSidecar(undefined, recordWith({ updates: [ entry(1) ] })))
        .to.deep.equal({ sidecar: { updates: [ entry(1) ] } });
    });
  });

  describe('changeFromUpdate', () => {
    const result = (extra: Partial<DidUpdateResult> = {}): DidUpdateResult => ({
      signedUpdate   : entry(1),
      txid           : 'ab'.repeat(32),
      publishedToCas : { update: false, announcement: false },
      ...extra,
    });

    it('holds the signing key, the transaction, and the signed update', () => {
      expect(changeFromUpdate(result(), 'urn:kms:secp256k1:a', undefined)).to.deep.equal({
        signingKey : 'urn:kms:secp256k1:a',
        txid       : 'ab'.repeat(32),
        sidecar    : { updates: [ entry(1) ] },
      });
    });

    it('holds the announcement, the proof, and the sidecar data of the resolution', () => {
      const change = changeFromUpdate(
        result({ announcement: entry(2), proof: entry(3) }),
        'urn:kms:secp256k1:a',
        { updates: [ entry(0) ], genesisDocument: { g: 1 } },
      );
      expect(change.sidecar).to.deep.equal({
        genesisDocument : { g: 1 },
        updates         : [ entry(1), entry(0) ],
        casUpdates      : [ entry(2) ],
        smtProofs       : [ entry(3) ],
      });
    });
  });

  describe('recordAfterWork', () => {
    let err: string[];
    let originalStderrWrite: typeof process.stderr.write;

    beforeEach(() => {
      err = [];
      originalStderrWrite = process.stderr.write;
      process.stderr.write = ((chunk: unknown) => { err.push(String(chunk)); return true; }) as typeof process.stderr.write;
    });

    afterEach(() => {
      process.stderr.write = originalStderrWrite;
    });

    it('prints a warning and does not throw if the write fails', () => {
      // The parent of the records file is a regular file, so the write fails.
      const blocker = join(dir, 'blocker');
      writeFileSync(blocker, '');
      const blocked = new IdentifierRecords(join(blocker, 'dids.json'));
      const did = keyDid();
      recordAfterWork(blocked, did, { txid: 'aa' });
      expect(err.join('')).to.match(new RegExp(`^Warning: the CLI could not write the record of ${did} to `));
    });

    it('prints a warning and does not throw if the change cannot be made', () => {
      const did = keyDid();
      recordAfterWork(records, did, (): RecordChange => { throw new Error('bad result'); });
      expect(err.join('')).to.include('bad result');
      expect(records.get(did)).to.equal(undefined);
    });
  });
});

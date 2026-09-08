import { canonicalHashBytes } from '@did-btcr2/common';
import { GenesisDocument, Identifier } from '@did-btcr2/api';
import { SchnorrKeyPair } from '@did-btcr2/keypair';
import { bytesToHex } from '@noble/hashes/utils.js';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DidBtcr2Cli } from '../src/cli.js';
import { createTestApiFactory, expect, originalConsoleError, originalConsoleLog } from './helpers.js';

/** The check names of a valid identifier with no genesis document, in run order. */
const CHECKS = ['prefix', 'lowercase', 'bech32m', 'version', 'network', 'genesisBytes', 'roundTrip'];

/** A KEY identifier on regtest. */
function keyDid(): string {
  const keyPair = SchnorrKeyPair.generate();
  return Identifier.encode(keyPair.publicKey.compressed, { idType: 'KEY', network: 'regtest' });
}

/** A genesis document and the EXTERNAL identifier on regtest that encodes its hash. */
function externalFixture(): { did: string; document: object } {
  const keyPair = SchnorrKeyPair.generate();
  const document = JSON.parse(JSON.stringify(GenesisDocument.fromPublicKey(keyPair.publicKey.compressed, 'regtest')));
  const did = Identifier.encode(canonicalHashBytes(document), { idType: 'EXTERNAL', network: 'regtest' });
  return { did, document };
}

describe('identifier commands', () => {
  let dir: string;
  let out: string[];
  let err: string[];

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'btcr2-identifier-'));
    out = [];
    err = [];
    console.log = (m?: unknown) => { if (m !== undefined) out.push(String(m)); };
    console.error = (m?: unknown) => { if (m !== undefined) err.push(String(m)); };
    // Start each test with a clean exit code so that a set exit code is observable.
    process.exitCode = undefined;
  });

  afterEach(() => {
    console.log = originalConsoleLog;
    console.error = originalConsoleError;
    process.exitCode = 0;
    rmSync(dir, { recursive: true, force: true });
  });

  async function run(...args: string[]): Promise<void> {
    const cli = new DidBtcr2Cli(createTestApiFactory());
    await cli.run(['node', 'btcr2', ...args]);
  }

  function writeJson(name: string, value: unknown): string {
    const path = join(dir, name);
    writeFileSync(path, JSON.stringify(value));
    return path;
  }

  describe('decode', () => {
    it('prints the components of a KEY identifier', async () => {
      const did = keyDid();
      await run('-o', 'json', 'identifier', 'decode', did);
      const result = JSON.parse(out[0]);
      expect(result.action).to.equal('identifier-decode');
      expect(result.data).to.deep.include({ did, idType: 'KEY', hrp: 'k', version: 1, network: 'regtest' });
      expect(result.data.genesisBytes).to.match(/^0[23][0-9a-f]{64}$/);
      expect(result.data).to.not.have.property('initialDocument');
    });

    it('prints the components of an EXTERNAL identifier', async () => {
      const { did } = externalFixture();
      await run('-o', 'json', 'identifier', 'decode', did);
      const { data } = JSON.parse(out[0]);
      expect(data).to.deep.include({ did, idType: 'EXTERNAL', hrp: 'x', version: 1, network: 'regtest' });
      expect(data.genesisBytes).to.match(/^[0-9a-f]{64}$/);
    });

    it('prints the data alone in text mode', async () => {
      const did = keyDid();
      await run('identifier', 'decode', did);
      const data = JSON.parse(out[0]);
      expect(data).to.not.have.property('action');
      expect(data.did).to.equal(did);
    });

    it('adds the initial document of a KEY identifier with no I/O', async () => {
      const did = keyDid();
      await run('-o', 'json', 'identifier', 'decode', did, '--initial-document');
      const { data } = JSON.parse(out[0]);
      expect(data.initialDocument.id).to.equal(did);
      expect(data.initialDocument.service).to.have.lengthOf(3);
    });

    it('adds the initial document of an EXTERNAL identifier from its genesis document', async () => {
      const { did, document } = externalFixture();
      const path = writeJson('genesis.json', document);
      await run('-o', 'json', 'identifier', 'decode', did, '--initial-document', '--genesis-document', path);
      const { data } = JSON.parse(out[0]);
      expect(data.initialDocument.id).to.equal(did);
      expect(data.initialDocument.verificationMethod[0].id).to.equal(`${did}#key-0`);
    });

    it('refuses --initial-document for an EXTERNAL identifier without --genesis-document', async () => {
      const { did } = externalFixture();
      await run('identifier', 'decode', did, '--initial-document');
      expect(err.join(' ')).to.match(/needs --genesis-document/);
      expect(process.exitCode).to.equal(1);
    });

    it('refuses --genesis-document for a KEY identifier', async () => {
      await run('identifier', 'decode', keyDid(), '--initial-document', '--genesis-document', join(dir, 'absent.json'));
      expect(err.join(' ')).to.match(/applies only to external identifiers/);
      expect(process.exitCode).to.equal(1);
    });

    it('refuses --genesis-document without --initial-document', async () => {
      const { did } = externalFixture();
      await run('identifier', 'decode', did, '--genesis-document', join(dir, 'absent.json'));
      expect(err.join(' ')).to.match(/requires --initial-document/);
      expect(process.exitCode).to.equal(1);
    });

    it('fails a genesis document that does not hash to the identifier', async () => {
      const { did } = externalFixture();
      const other = externalFixture();
      const path = writeJson('other.json', other.document);
      await run('identifier', 'decode', did, '--initial-document', '--genesis-document', path);
      expect(err.join(' ')).to.match(/Initial document mismatch/);
      expect(process.exitCode).to.equal(1);
    });

    it('names the failed check for an invalid identifier', async () => {
      const did = keyDid();
      const upper = `did:btcr2:${did.slice('did:btcr2:'.length).toUpperCase()}`;
      await run('identifier', 'decode', upper);
      expect(err.join(' ')).to.match(/Invalid identifier \(lowercase check\)/);
      expect(process.exitCode).to.equal(1);
      expect(out).to.have.length(0);
    });

    it('prints one message line for a malformed Bech32m body', async () => {
      await run('identifier', 'decode', 'did:btcr2:k1notavalidbech32m');
      expect(err).to.have.length(1);
      expect(err[0]).to.match(/^Invalid identifier \(bech32m check\)/);
      expect(process.exitCode).to.equal(1);
    });
  });

  describe('validate', () => {
    it('prints a report with every check passed and keeps exit code 0', async () => {
      const did = keyDid();
      await run('-o', 'json', 'identifier', 'validate', did);
      const result = JSON.parse(out[0]);
      expect(result.action).to.equal('identifier-validate');
      expect(result.data).to.deep.include({ did, valid: true, idType: 'KEY', network: 'regtest' });
      expect(result.data.checks.map((check: { name: string }) => check.name)).to.deep.equal(CHECKS);
      expect(process.exitCode).to.equal(undefined);
    });

    it('prints the report and sets exit code 1 for an invalid identifier', async () => {
      const did = keyDid();
      const upper = `did:btcr2:${did.slice('did:btcr2:'.length).toUpperCase()}`;
      await run('-o', 'json', 'identifier', 'validate', upper);
      const { data } = JSON.parse(out[0]);
      expect(data.valid).to.equal(false);
      expect(data.checks[data.checks.length - 1]).to.include({ name: 'lowercase', ok: false });
      expect(process.exitCode).to.equal(1);
      expect(err).to.have.length(0);
    });

    it('reports a string that is not a DID', async () => {
      await run('-o', 'json', 'identifier', 'validate', 'not-a-did');
      const { data } = JSON.parse(out[0]);
      expect(data.valid).to.equal(false);
      expect(data.checks).to.deep.equal([{ name: 'prefix', ok: false, detail: data.checks[0].detail }]);
      expect(process.exitCode).to.equal(1);
    });

    it('adds the genesisDocument check for an EXTERNAL identifier', async () => {
      const { did, document } = externalFixture();
      const path = writeJson('genesis.json', document);
      await run('-o', 'json', 'identifier', 'validate', did, '--genesis-document', path);
      const { data } = JSON.parse(out[0]);
      expect(data.valid).to.equal(true);
      expect(data.checks[data.checks.length - 1]).to.include({ name: 'genesisDocument', ok: true });
      expect(process.exitCode).to.equal(undefined);
    });

    it('fails the genesisDocument check for a document that does not hash to the identifier', async () => {
      const { did } = externalFixture();
      const path = writeJson('other.json', externalFixture().document);
      await run('-o', 'json', 'identifier', 'validate', did, '--genesis-document', path);
      const { data } = JSON.parse(out[0]);
      expect(data.valid).to.equal(false);
      expect(data.checks[data.checks.length - 1]).to.include({ name: 'genesisDocument', ok: false });
      expect(process.exitCode).to.equal(1);
    });

    it('refuses --genesis-document for a KEY identifier before the file read', async () => {
      await run('identifier', 'validate', keyDid(), '--genesis-document', join(dir, 'absent.json'));
      expect(err.join(' ')).to.match(/applies only to external identifiers/);
      expect(err.join(' ')).to.not.match(/genesis document path/);
      expect(process.exitCode).to.equal(1);
    });

    it('rejects an unreadable genesis document path', async () => {
      const { did } = externalFixture();
      await run('identifier', 'validate', did, '--genesis-document', join(dir, 'absent.json'));
      expect(err.join(' ')).to.match(/Invalid genesis document path/);
      expect(process.exitCode).to.equal(1);
    });

    it('passes the public key of a KEY identifier with -b', async () => {
      const keyPair = SchnorrKeyPair.generate();
      const did = Identifier.encode(keyPair.publicKey.compressed, { idType: 'KEY', network: 'regtest' });
      await run('-o', 'json', 'identifier', 'validate', did, '-b', bytesToHex(keyPair.publicKey.compressed));
      const { data } = JSON.parse(out[0]);
      expect(data.valid).to.equal(true);
      expect(data.checks[data.checks.length - 1]).to.include({ name: 'genesisBytesMatch', ok: true });
      expect(process.exitCode).to.equal(undefined);
    });

    it('passes the genesis document hash of an EXTERNAL identifier with --bytes', async () => {
      const { did, document } = externalFixture();
      await run('-o', 'json', 'identifier', 'validate', did, '--bytes', bytesToHex(canonicalHashBytes(document)));
      const { data } = JSON.parse(out[0]);
      expect(data.valid).to.equal(true);
      expect(data.checks[data.checks.length - 1]).to.include({ name: 'genesisBytesMatch', ok: true });
    });

    it('fails the genesisBytesMatch check for other bytes and sets exit code 1', async () => {
      const did = keyDid();
      await run('-o', 'json', 'identifier', 'validate', did, '-b', bytesToHex(SchnorrKeyPair.generate().publicKey.compressed));
      const { data } = JSON.parse(out[0]);
      expect(data.valid).to.equal(false);
      expect(data.checks[data.checks.length - 1]).to.include({ name: 'genesisBytesMatch', ok: false });
      expect(process.exitCode).to.equal(1);
    });

    it('reports bytes of the wrong length as a failed check, not as an argument error', async () => {
      const did = keyDid();
      await run('-o', 'json', 'identifier', 'validate', did, '-b', 'ab'.repeat(32));
      const { data } = JSON.parse(out[0]);
      expect(data.valid).to.equal(false);
      expect(data.checks[data.checks.length - 1].detail).to.include('Expected 33 genesis bytes');
      expect(err).to.have.length(0);
      expect(process.exitCode).to.equal(1);
    });

    it('rejects --bytes that are not hex', async () => {
      await run('identifier', 'validate', keyDid(), '-b', 'not-hex');
      expect(err.join(' ')).to.match(/Invalid bytes: not valid hex/);
      expect(process.exitCode).to.equal(1);
    });

    it('rejects a genesis document file that is not a JSON object', async () => {
      const { did } = externalFixture();
      const path = writeJson('array.json', [1, 2]);
      await run('identifier', 'validate', did, '--genesis-document', path);
      expect(err.join(' ')).to.match(/must contain a JSON object/);
      expect(process.exitCode).to.equal(1);
    });
  });
});

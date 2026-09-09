import { canonicalHashBytes } from '@did-btcr2/common';
import { createApi, GenesisDocument, Identifier } from '@did-btcr2/api';
import { SchnorrKeyPair } from '@did-btcr2/keypair';
import { BeaconUtils } from '@did-btcr2/method';
import { bytesToHex, hexToBytes } from '@noble/hashes/utils.js';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DidBtcr2Cli } from '../src/cli.js';
import { collectGenesisSpec } from '../src/genesis-wizard.js';
import type { WizardContext } from '../src/genesis-wizard.js';
import { createKeystoreTestApiFactory, createTestApiFactory, expect, originalConsoleError, originalConsoleLog } from './helpers.js';

/** A fresh 33-byte compressed public key as hex. */
function publicKeyHex(): string {
  return bytesToHex(SchnorrKeyPair.generate().publicKey.compressed);
}

/** A genesis document and the EXTERNAL identifier on regtest that encodes its hash. */
function externalFixture(): { did: string; document: object } {
  const keyPair = SchnorrKeyPair.generate();
  const document = JSON.parse(JSON.stringify(GenesisDocument.fromPublicKey(keyPair.publicKey.compressed, 'regtest')));
  const did = Identifier.encode(canonicalHashBytes(document), { idType: 'EXTERNAL', network: 'regtest' });
  return { did, document };
}

/** A KEY identifier on regtest. */
function keyDid(): string {
  return Identifier.encode(SchnorrKeyPair.generate().publicKey.compressed, { idType: 'KEY', network: 'regtest' });
}

/** The P2TR address of a public key on regtest, derived through the KEY identifier of that key. */
function p2trAddress(publicKey: Uint8Array): string {
  const did = Identifier.encode(publicKey, { idType: 'KEY', network: 'regtest' });
  return BeaconUtils.createBeaconService(did, 'p2tr', 'SingletonBeacon').serviceEndpoint.replace(/^bitcoin:/, '');
}

describe('genesis commands', () => {
  let dir: string;
  let keystore: string;
  let out: string[];
  let err: string[];
  let originalStderrWrite: typeof process.stderr.write;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'btcr2-genesis-'));
    keystore = join(dir, 'keystore.json');
    out = [];
    err = [];
    console.log = (m?: unknown) => { if (m !== undefined) out.push(String(m)); };
    console.error = (m?: unknown) => { if (m !== undefined) err.push(String(m)); };
    originalStderrWrite = process.stderr.write;
    process.stderr.write = ((chunk: unknown) => { err.push(String(chunk)); return true; }) as typeof process.stderr.write;
    process.exitCode = undefined;
  });

  afterEach(() => {
    console.log = originalConsoleLog;
    console.error = originalConsoleError;
    process.stderr.write = originalStderrWrite;
    process.exitCode = 0;
    rmSync(dir, { recursive: true, force: true });
  });

  async function run(...args: string[]): Promise<void> {
    const cli = new DidBtcr2Cli(createTestApiFactory(), createKeystoreTestApiFactory(keystore, 'pw'));
    await cli.run(['node', 'btcr2', ...args]);
  }

  function writeJson(name: string, value: unknown): string {
    const path = join(dir, name);
    writeFileSync(path, JSON.stringify(value));
    return path;
  }

  function readJson(path: string): any {
    return JSON.parse(readFileSync(path, 'utf-8'));
  }

  describe('genesis build --spec', () => {
    it('builds a document from a hex public key, writes it, and prints the identifier', async () => {
      const key = publicKeyHex();
      const spec = writeJson('spec.json', { verificationMethods: [{ publicKey: key }] });
      const outPath = join(dir, 'genesis.json');
      await run('-o', 'json', 'genesis', 'build', '-n', 'regtest', '--spec', spec, '--out', outPath);
      expect(err, err.join('\n')).to.have.length(0);
      const result = JSON.parse(out[0]);
      expect(result.action).to.equal('genesis-build');
      expect(result.data.did).to.match(/^did:btcr2:x1/);
      expect(result.data.network).to.equal('regtest');
      expect(result.data.path).to.equal(outPath);
      expect(result.data.genesisBytes).to.match(/^[0-9a-f]{64}$/);
      expect(result.data.beacons).to.have.lengthOf(1);
      expect(result.data.beacons[0]).to.deep.include({ id: `${result.data.did}#service-0`, type: 'SingletonBeacon' });
      expect(result.data.beacons[0].address).to.match(/^bcrt1q/);

      const document = readJson(outPath);
      expect(document.id).to.equal('did:btcr2:_');
      expect(document.verificationMethod[0].id).to.equal('did:btcr2:_#key-0');
      expect(document.service[0].serviceEndpoint).to.equal(`bitcoin:${result.data.beacons[0].address}`);
      // The identifier encodes the hash of the file as written.
      expect(bytesToHex(canonicalHashBytes(document))).to.equal(result.data.genesisBytes);
      expect(bytesToHex(Identifier.decode(result.data.did).genesisBytes)).to.equal(result.data.genesisBytes);
    });

    it('the written document passes identifier validate and reproduces the identifier through create', async () => {
      const spec = writeJson('spec.json', { verificationMethods: [{ publicKey: publicKeyHex() }] });
      const outPath = join(dir, 'genesis.json');
      await run('-o', 'json', 'genesis', 'build', '-n', 'regtest', '--spec', spec, '--out', outPath);
      const { did } = JSON.parse(out[0]).data;
      out = [];
      await run('-o', 'json', 'identifier', 'validate', did, '--genesis-document', outPath);
      const report = JSON.parse(out[0]).data;
      expect(report.valid, JSON.stringify(report.checks)).to.equal(true);
      expect(report.checks[report.checks.length - 1].name).to.equal('genesisDocument');
      out = [];
      await run('-o', 'json', 'create', '-t', 'x', '-n', 'regtest', '--document', outPath);
      expect(JSON.parse(out[0]).data).to.equal(did);
    });

    it('resolves keystore references by name, and takes beacons and services from the spec', async () => {
      await run('-o', 'json', 'key', 'generate', '--name', 'alice');
      await run('-o', 'json', 'key', 'generate', '--name', 'bob');
      const cohort = p2trAddress(SchnorrKeyPair.generate().publicKey.compressed);
      const spec = writeJson('spec.json', {
        verificationMethods : [
          { key: 'alice', relationships: ['authentication', 'capabilityInvocation'] },
          { key: 'bob', relationships: ['assertionMethod'], fragment: 'assert' },
        ],
        beacons : [
          { type: 'SingletonBeacon', key: 'alice', addressType: 'p2tr' },
          { type: 'SMTBeacon', address: cohort },
        ],
        services : [{ id: '#website', type: 'LinkedDomains', serviceEndpoint: 'https://example.com' }],
      });
      out = [];
      const outPath = join(dir, 'genesis.json');
      await run('-o', 'json', 'genesis', 'build', '-n', 'regtest', '--spec', spec, '--out', outPath);
      const result = JSON.parse(out[0]);
      expect(result.data.beacons.map((b: any) => b.type)).to.deep.equal(['SingletonBeacon', 'SMTBeacon']);
      expect(result.data.beacons[0].address).to.match(/^bcrt1p/);
      expect(result.data.beacons[1].address).to.equal(cohort);

      const document = readJson(outPath);
      expect(document.verificationMethod.map((vm: any) => vm.id)).to.deep.equal(['did:btcr2:_#key-0', 'did:btcr2:_#assert']);
      expect(document.authentication).to.deep.equal(['did:btcr2:_#key-0']);
      expect(document.assertionMethod).to.deep.equal(['did:btcr2:_#assert']);
      expect(document.capabilityInvocation).to.deep.equal(['did:btcr2:_#key-0']);
      expect(document).to.not.have.property('capabilityDelegation');
      expect(document.service).to.have.lengthOf(3);
      expect(document.service[2]).to.deep.equal({ id: 'did:btcr2:_#website', type: 'LinkedDomains', serviceEndpoint: 'https://example.com' });
      // The singleton beacon address is the P2TR address of the key of alice.
      out = [];
      await run('-o', 'json', 'key', 'show', 'alice');
      const alicePublicKey = hexToBytes(JSON.parse(out[0]).data.publicKey);
      expect(result.data.beacons[0].address).to.equal(p2trAddress(alicePublicKey));
    });

    it('derives the beacon address for -n and prints a funding hint in text mode', async () => {
      const spec = writeJson('spec.json', { verificationMethods: [{ publicKey: publicKeyHex() }] });
      const outPath = join(dir, 'genesis.json');
      await run('genesis', 'build', '-n', 'mutinynet', '--spec', spec, '--out', outPath);
      const data = JSON.parse(out[0]);
      expect(data.network).to.equal('mutinynet');
      expect(data.beacons[0].address).to.match(/^tb1q/);
      expect(Identifier.decode(data.did).network).to.equal('mutinynet');
      const stderr = err.join('');
      expect(stderr).to.include(`Wrote the genesis document to ${outPath}`);
      expect(stderr).to.include('Fund the initial beacon');
      expect(stderr).to.include(data.beacons[0].address);
    });

    it('prints no hint in json mode', async () => {
      const spec = writeJson('spec.json', { verificationMethods: [{ publicKey: publicKeyHex() }] });
      await run('-o', 'json', 'genesis', 'build', '-n', 'mutinynet', '--spec', spec, '--out', join(dir, 'g.json'));
      expect(err).to.have.length(0);
    });

    it('refuses to overwrite an existing --out file without --force', async () => {
      const spec = writeJson('spec.json', { verificationMethods: [{ publicKey: publicKeyHex() }] });
      const outPath = writeJson('genesis.json', { keep: true });
      await run('genesis', 'build', '-n', 'regtest', '--spec', spec, '--out', outPath);
      expect(err.join(' ')).to.match(/exists\. Pass --force/);
      expect(process.exitCode).to.equal(1);
      expect(readJson(outPath)).to.deep.equal({ keep: true });
      err = [];
      process.exitCode = undefined;
      await run('-o', 'json', 'genesis', 'build', '-n', 'regtest', '--spec', spec, '--out', outPath, '--force');
      expect(err, err.join('\n')).to.have.length(0);
      expect(readJson(outPath).id).to.equal('did:btcr2:_');
    });

    it('writes to genesis.json in the working directory by default', async () => {
      const spec = writeJson('spec.json', { verificationMethods: [{ publicKey: publicKeyHex() }] });
      const cwd = process.cwd();
      process.chdir(dir);
      try {
        await run('-o', 'json', 'genesis', 'build', '-n', 'regtest', '--spec', spec);
      } finally {
        process.chdir(cwd);
      }
      expect(JSON.parse(out[0]).data.path).to.equal(join(dir, 'genesis.json'));
      expect(existsSync(join(dir, 'genesis.json'))).to.equal(true);
    });

    it('refuses to run without a terminal and without --spec', async function () {
      if (process.stdin.isTTY) return this.skip();
      await run('genesis', 'build', '-n', 'regtest', '--out', join(dir, 'g.json'));
      expect(err.join(' ')).to.match(/No terminal is attached\. Pass --spec/);
      expect(process.exitCode).to.equal(1);
      expect(existsSync(join(dir, 'g.json'))).to.equal(false);
    });

    it('refuses an invalid network', async () => {
      const spec = writeJson('spec.json', { verificationMethods: [{ publicKey: publicKeyHex() }] });
      await run('genesis', 'build', '-n', 'moonnet', '--spec', spec, '--out', join(dir, 'g.json'));
      expect(err.join(' ')).to.match(/Invalid network/);
      expect(process.exitCode).to.equal(1);
    });

    it('refuses a spec path that is not a JSON file', async () => {
      await run('genesis', 'build', '-n', 'regtest', '--spec', join(dir, 'absent.json'), '--out', join(dir, 'g.json'));
      expect(err.join(' ')).to.match(/Invalid genesis spec path/);
      expect(process.exitCode).to.equal(1);
    });

    it('refuses a spec whose shape is not valid', async () => {
      const cases: Array<[unknown, RegExp]> = [
        [[], /must contain a JSON object/],
        [{}, /"verificationMethods" must be a non-empty array/],
        [{ verificationMethods: [{ key: 'a', publicKey: publicKeyHex() }] }, /exactly one of "key"/],
        [{ verificationMethods: [{}] }, /exactly one of "key"/],
        [{ verificationMethods: [{ publicKey: publicKeyHex() }], beacons: [{ type: 'SingletonBeacon', key: 'a', address: 'x' }] }, /Give only one of "key", "publicKey", or "address"/],
        [{ verificationMethods: [{ publicKey: publicKeyHex() }], services: {} }, /"services" must be an array/],
      ];
      for (const [spec, message] of cases) {
        err = [];
        process.exitCode = undefined;
        await run('genesis', 'build', '-n', 'regtest', '--spec', writeJson('spec.json', spec), '--out', join(dir, 'g.json'));
        expect(err.join(' '), JSON.stringify(spec)).to.match(message);
        expect(process.exitCode).to.equal(1);
      }
      expect(existsSync(join(dir, 'g.json'))).to.equal(false);
    });

    it('refuses a public key that is not hex', async () => {
      const spec = writeJson('spec.json', { verificationMethods: [{ publicKey: 'zz' }] });
      await run('genesis', 'build', '-n', 'regtest', '--spec', spec, '--out', join(dir, 'g.json'));
      expect(err.join(' ')).to.match(/not valid hex/);
      expect(process.exitCode).to.equal(1);
    });

    it('refuses a key reference that no key matches', async () => {
      const spec = writeJson('spec.json', { verificationMethods: [{ key: 'nobody' }] });
      await run('genesis', 'build', '-n', 'regtest', '--spec', spec, '--out', join(dir, 'g.json'));
      expect(err.join(' ')).to.match(/No key matches reference "nobody"/);
      expect(process.exitCode).to.equal(1);
    });

    it('reports an api refusal and writes no file', async () => {
      const spec = writeJson('spec.json', {
        verificationMethods : [{ publicKey: publicKeyHex(), relationships: ['authentication'] }],
      });
      await run('genesis', 'build', '-n', 'regtest', '--spec', spec, '--out', join(dir, 'g.json'));
      expect(err.join(' ')).to.match(/capabilityInvocation/);
      expect(process.exitCode).to.equal(1);
      expect(existsSync(join(dir, 'g.json'))).to.equal(false);
    });
  });

  describe('collectGenesisSpec (wizard)', () => {
    /** A wizard context with two keys and a scripted answer list. */
    function scripted(answers: string[], keys: WizardContext['keys'] = []): { ask: (q: string) => Promise<string>; ctx: WizardContext; questions: string[]; said: string[] } {
      const questions: string[] = [];
      const said: string[] = [];
      const ask = async (question: string): Promise<string> => {
        questions.push(question);
        if (answers.length === 0) throw new Error(`No answer for: ${question}`);
        return answers.shift() as string;
      };
      const ctx: WizardContext = {
        say        : (line) => said.push(line),
        keys,
        resolveKey : (ref) => {
          const key = keys.find(k => k.name === ref || k.keyId === ref || k.fingerprint.startsWith(ref));
          if (!key) throw new Error(`No key matches reference "${ref}".`);
          return key.keyId;
        },
      };
      return { ask, ctx, questions, said };
    }

    const alice = { keyId: 'urn:kms:secp256k1:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', fingerprint: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', name: 'alice', active: true };
    const bob = { keyId: 'urn:kms:secp256k1:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb', fingerprint: 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb', active: false };

    it('defaults to the active key, all relationships, and one P2WPKH singleton beacon on that key', async () => {
      const { ask, ctx, questions, said } = scripted(['', '', 'n', '', '', '', 'n', 'n'], [alice, bob]);
      const spec = await collectGenesisSpec(ask, ctx);
      expect(spec).to.deep.equal({
        verificationMethods : [{ key: 'alice' }],
        beacons             : [{ type: 'SingletonBeacon', key: 'alice', addressType: 'p2wpkh' }],
      });
      expect(questions[0]).to.include('[alice]');
      expect(said[0]).to.equal('Keys in the keystore:');
      expect(said[1]).to.include('alice').and.include('(active)');
      expect(said[2]).to.include(bob.fingerprint).and.not.include('(active)');
    });

    it('takes a hex public key, named relationships, a beacon address, and a service', async () => {
      const key = publicKeyHex().toUpperCase();
      const { ask, ctx } = scripted([
        key, 'capabilityInvocation, assertionMethod', 'y',
        'bb', '', 'n',
        'CASBeacon', 'bcrt1qexample', 'y',
        '', '', 'p2tr', 'n',
        'y', 'website', 'LinkedDomains', 'https://example.com', 'n',
      ], [alice, bob]);
      const spec = await collectGenesisSpec(ask, ctx);
      expect(spec).to.deep.equal({
        verificationMethods : [
          { publicKey: key.toLowerCase(), relationships: ['capabilityInvocation', 'assertionMethod'] },
          { key: 'bb' },
        ],
        beacons : [
          { type: 'CASBeacon', address: 'bcrt1qexample' },
          { type: 'SingletonBeacon', publicKey: key.toLowerCase(), addressType: 'p2tr' },
        ],
        services : [{ id: '#website', type: 'LinkedDomains', serviceEndpoint: 'https://example.com' }],
      });
    });

    it('asks again after an unknown key, an unknown relationship, an unknown type, and an empty required value', async () => {
      const { ask, ctx, said } = scripted([
        'carol', 'alice', 'keyAgreement', 'authentication,capabilityInvocation', 'n',
        'MyBeacon', '', '', 'p2sh', '', 'n',
        'y', '', '', 'T', 'https://x', 'n',
      ], [alice]);
      const spec = await collectGenesisSpec(ask, ctx);
      expect(spec.verificationMethods).to.deep.equal([{ key: 'alice', relationships: ['authentication', 'capabilityInvocation'] }]);
      expect(spec.beacons).to.deep.equal([{ type: 'SingletonBeacon', key: 'alice', addressType: 'p2wpkh' }]);
      expect(spec.services).to.deep.equal([{ type: 'T', serviceEndpoint: 'https://x' }]);
      expect(said).to.include('No key matches reference "carol".');
      expect(said.some(line => line.includes('Unknown relationship: keyAgreement'))).to.equal(true);
      expect(said.some(line => line.includes('Unknown value "MyBeacon"'))).to.equal(true);
      expect(said.some(line => line.includes('Unknown value "p2sh"'))).to.equal(true);
      expect(said).to.include('A value is required.');
    });

    it('requires a key when the keystore is empty and no default exists', async () => {
      const key = publicKeyHex();
      const { ask, ctx, said } = scripted(['', key, '', 'n', '', '', '', 'n', 'n']);
      const spec = await collectGenesisSpec(ask, ctx);
      expect(spec.verificationMethods).to.deep.equal([{ publicKey: key }]);
      expect(spec.beacons).to.deep.equal([{ type: 'SingletonBeacon', publicKey: key, addressType: 'p2wpkh' }]);
      expect(said[0]).to.include('The keystore has no keys');
      expect(said).to.include('A key is required.');
    });
  });

  describe('create -t x --document', () => {
    it('hashes the document and prints the identifier with its genesis bytes', async () => {
      const { did, document } = externalFixture();
      const path = writeJson('genesis.json', document);
      await run('-o', 'json', 'create', '-t', 'x', '-n', 'regtest', '--document', path);
      const result = JSON.parse(out[0]);
      expect(result.action).to.equal('create');
      expect(result.data).to.equal(did);
      expect(result.genesisBytes).to.equal(bytesToHex(canonicalHashBytes(document)));
    });

    it('prints the identifier alone in text mode, with a funding hint on a faucet network', async () => {
      const { document } = externalFixture();
      const path = writeJson('genesis.json', document);
      await run('create', '-t', 'x', '-n', 'mutinynet', '--document', path);
      expect(out[0]).to.match(/^did:btcr2:x1/);
      expect(err.join('')).to.include('Fund the initial beacon');
    });

    it('refuses --document together with --bytes', async () => {
      const { document } = externalFixture();
      const path = writeJson('genesis.json', document);
      await run('create', '-t', 'x', '-n', 'regtest', '--document', path, '-b', 'aa'.repeat(32));
      expect(err.join(' ')).to.match(/at most one of --bytes or --document/);
      expect(process.exitCode).to.equal(1);
    });

    it('refuses --document for a KEY identifier', async () => {
      await run('create', '-t', 'k', '-n', 'regtest', '--document', join(dir, 'absent.json'));
      expect(err.join(' ')).to.match(/--document applies only to external identifiers/);
      expect(process.exitCode).to.equal(1);
    });

    it('names both inputs when -t x has neither', async () => {
      await run('create', '-t', 'x', '-n', 'regtest');
      expect(err.join(' ')).to.match(/require --document <path>.*or --bytes <hex>/);
      expect(process.exitCode).to.equal(1);
    });

    it('refuses a document that is not a genesis document', async () => {
      const { document } = externalFixture();
      const path = writeJson('genesis.json', { ...document, id: 'did:btcr2:k1qq' });
      await run('create', '-t', 'x', '-n', 'regtest', '--document', path);
      expect(err.join(' ')).to.match(/id must be "did:btcr2:_"/);
      expect(process.exitCode).to.equal(1);
    });

    it('refuses a path that is not a JSON file', async () => {
      await run('create', '-t', 'x', '-n', 'regtest', '--document', join(dir, 'absent.json'));
      expect(err.join(' ')).to.match(/Invalid genesis document path/);
      expect(process.exitCode).to.equal(1);
    });
  });

  describe('--genesis-document on resolve, update, and deactivate', () => {
    /** An api whose resolveDid records its arguments and returns a canned result. */
    function recordingApi(did: string): { api: ReturnType<typeof createApi>; calls: unknown[][] } {
      const api = createApi();
      const calls: unknown[][] = [];
      (api as any).resolveDid = async (...args: unknown[]) => {
        calls.push(args);
        return { didDocument: { id: did }, didDocumentMetadata: {}, didResolutionMetadata: {} };
      };
      return { api, calls };
    }

    it('resolve fills sidecar.genesisDocument from the file', async () => {
      const { did, document } = externalFixture();
      const path = writeJson('genesis.json', document);
      const { api, calls } = recordingApi(did);
      await new DidBtcr2Cli(() => api).run(['node', 'btcr2', 'resolve', '-i', did, '--genesis-document', path, '--min-conf', '1']);
      expect(calls).to.deep.equal([[ did, { minConf: 1, sidecar: { genesisDocument: document } } ]]);
    });

    it('the file wins over a sidecar.genesisDocument inside --resolution-options', async () => {
      const { did, document } = externalFixture();
      const path = writeJson('genesis.json', document);
      const { api, calls } = recordingApi(did);
      await new DidBtcr2Cli(() => api).run([
        'node', 'btcr2', 'resolve', '-i', did, '--genesis-document', path,
        '-r', '{"versionId":"1","sidecar":{"genesisDocument":{"id":"other"},"updates":[]}}',
      ]);
      expect(calls).to.deep.equal([[ did, { versionId: '1', sidecar: { updates: [], genesisDocument: document } } ]]);
    });

    it('resolve refuses --genesis-document for a KEY identifier before the file is read', async () => {
      const did = keyDid();
      const { api, calls } = recordingApi(did);
      await new DidBtcr2Cli(() => api).run(['node', 'btcr2', 'resolve', '-i', did, '--genesis-document', join(dir, 'absent.json')]);
      expect(err.join(' ')).to.match(/--genesis-document applies only to external identifiers/);
      expect(process.exitCode).to.equal(1);
      expect(calls).to.deep.equal([]);
    });

    it('update refuses --genesis-document together with the source pair', async () => {
      const { did, document } = externalFixture();
      const path = writeJson('genesis.json', document);
      await run(
        'update', '-i', did, '-p', '[]', '--genesis-document', path,
        '-s', JSON.stringify({ id: did }), '--source-version-id', '1',
      );
      expect(err.join(' ')).to.match(/--genesis-document apply only when/);
      expect(process.exitCode).to.equal(1);
    });

    it('deactivate refuses --genesis-document for a KEY identifier', async () => {
      await run('deactivate', '-i', keyDid(), '--genesis-document', join(dir, 'absent.json'));
      expect(err.join(' ')).to.match(/--genesis-document applies only to external identifiers/);
      expect(process.exitCode).to.equal(1);
    });
  });

  describe('completion', () => {
    it('lists genesis', async () => {
      await run('completion', 'bash');
      expect(out[0]).to.include(' genesis ');
    });
  });
});

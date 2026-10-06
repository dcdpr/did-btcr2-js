import type { Btcr2DidDocument } from '@did-btcr2/api';
import { createApi } from '@did-btcr2/api';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DidBtcr2Cli } from '../src/cli.js';
import type { ApiFactory } from '../src/config.js';
import { IdentifierRecords } from '../src/identifier-records.js';
import { FileBackedKeyManager } from '../src/keystore/file-backed-key-manager.js';
import { initKeystore } from '../src/keystore/file-key-store.js';
import {
  createKeystoreTestApiFactory,
  createTestApiFactory,
  expect,
  originalConsoleError,
  originalConsoleLog,
} from './helpers.js';

/** The api of the fixtures: offline, with no connection and no key. */
const sdk = createApi();

const MESSAGE = 'I control this DID. 2026-10-06 nonce 7f3a';

/** A factory that the command must not call. */
const never: ApiFactory = () => {
  throw new Error('The command must not build this api.');
};

describe('message commands (ADR 137)', () => {
  let dir: string;
  let home: string;
  let keystore: string;
  let out: string[];
  let err: string[];
  let originalStderrWrite: typeof process.stderr.write;
  /** The arguments of each stubbed resolution of the last commands. */
  let resolveCalls: Array<{ did: string; options: any }>;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'btcr2-message-commands-'));
    home = join(dir, 'home');
    keystore = join(dir, 'keystore.json');
    out = [];
    err = [];
    resolveCalls = [];
    console.log = (m?: unknown) => { if (m !== undefined) out.push(String(m)); };
    console.error = (m?: unknown) => { if (m !== undefined) err.push(String(m)); };
    originalStderrWrite = process.stderr.write;
    process.stderr.write = ((chunk: unknown) => { err.push(String(chunk)); return true; }) as typeof process.stderr.write;
    // Start each test with a clean exit code so that a set exit code is observable.
    process.exitCode = undefined;
  });

  afterEach(() => {
    console.log = originalConsoleLog;
    console.error = originalConsoleError;
    process.stderr.write = originalStderrWrite;
    process.exitCode = 0;
    rmSync(dir, { recursive: true, force: true });
  });

  /** The keystore-backed api of the tests. */
  const keystoreApi = (): ApiFactory => createKeystoreTestApiFactory(keystore, 'pw');

  /**
   * Wraps a factory: `tryResolveDid` records its arguments and returns the
   * document of `documentOf`, by default the initial document, so no Bitcoin
   * I/O happens.
   */
  function resolving(base: ApiFactory, documentOf?: (did: string) => Btcr2DidDocument, versionId = '1'): ApiFactory {
    return (network, overrides) => {
      const api = base(network, overrides);
      (api as unknown as { tryResolveDid: unknown }).tryResolveDid = async (did: string, options: unknown) => {
        resolveCalls.push({ did, options });
        const document = documentOf?.(did) ?? api.btcr2.getInitialDocument(did);
        return { ok: true, document, metadata: { versionId }, raw: {} };
      };
      return api;
    };
  }

  /** Wraps a factory: `tryResolveDid` reports a failure. */
  function failing(base: ApiFactory): ApiFactory {
    return (network, overrides) => {
      const api = base(network, overrides);
      (api as unknown as { tryResolveDid: unknown }).tryResolveDid = async (did: string, options: unknown) => {
        resolveCalls.push({ did, options });
        return { ok: false, error: 'NOT_FOUND', errorMessage: 'no beacon signal names the DID', raw: {} };
      };
      return api;
    };
  }

  async function run(args: string[], factories: { factory?: ApiFactory; keystore?: ApiFactory } = {}): Promise<void> {
    const cli = new DidBtcr2Cli(
      factories.factory ?? resolving(createTestApiFactory()),
      factories.keystore ?? resolving(keystoreApi()),
    );
    await cli.run([ 'node', 'btcr2', '--home', home, ...args ]);
  }

  /** Generates a stored key and returns its URN and its KEY identifier on regtest. */
  function seedIdentity(options: { setActive?: boolean; name?: string } = {}): { keyId: string; did: string } {
    const kms = keystoreApi()().kms;
    const keyId = kms.generateKey({ setActive: options.setActive ?? true, ...(options.name && { tags: { name: options.name } }) });
    const did = sdk.btcr2.createDeterministic(kms.getPublicKey(keyId), { network: 'regtest' });
    return { keyId, did };
  }

  /** The initial document of a KEY identifier as a plain object. */
  const initialDocument = (did: string): Btcr2DidDocument =>
    JSON.parse(JSON.stringify(sdk.btcr2.getInitialDocument(did)));

  /** Writes a file in the test directory and returns its path. */
  function writeJson(name: string, value: unknown): string {
    const path = join(dir, name);
    writeFileSync(path, typeof value === 'string' ? value : JSON.stringify(value));
    return path;
  }

  /** Signs the message as the identifier, and writes the text output to a file. */
  async function signToFile(did: string, factories: { keystore?: ApiFactory } = {}): Promise<{ path: string; signed: any }> {
    await run([ 'message', 'sign', '-i', did, MESSAGE ], factories);
    const text = out.pop()!;
    return { path: writeJson('message.json', text), signed: JSON.parse(text) };
  }

  /** The last JSON value on stdout. */
  const lastJson = (): any => JSON.parse(out[out.length - 1]);

  describe('message sign', () => {
    it('prints the signed message as JSON, and -o json prints the envelope', async () => {
      const { did } = seedIdentity();
      await run([ 'message', 'sign', '-i', did, MESSAGE ]);
      const signed = lastJson();
      expect(Object.keys(signed).sort()).to.deep.equal([ 'message', 'proof', 'type' ]);
      expect(signed).to.include({ type: 'BTCR2Message', message: MESSAGE });
      expect(signed.proof).to.include({ proofPurpose: 'assertionMethod', verificationMethod: `${did}#initialKey` });
      expect(sdk.btcr2.verifyMessage(initialDocument(did), signed).verified).to.equal(true);

      await run([ '-o', 'json', 'message', 'sign', '-i', did, MESSAGE ]);
      const envelope = lastJson();
      expect(envelope.action).to.equal('message-sign');
      expect(sdk.btcr2.verifyMessage(initialDocument(did), envelope.data).verified).to.equal(true);
    });

    it('signs with the key of the identifier record, and --signing-key wins', async () => {
      const alice = seedIdentity({ setActive: false });
      seedIdentity({ setActive: true, name: 'bob' });
      new IdentifierRecords(join(home, 'dids.json')).record(alice.did, { name: 'alice', signingKey: alice.keyId });

      await run([ 'message', 'sign', '-i', 'alice', MESSAGE ]);
      expect(sdk.btcr2.verifyMessage(initialDocument(alice.did), lastJson()).verified).to.equal(true);
      expect(resolveCalls[0].did).to.equal(alice.did);

      await run([ 'message', 'sign', '-i', 'alice', '--signing-key', 'bob', MESSAGE ]);
      expect(err.join('\n')).to.include(`No assertionMethod method of ${alice.did} publishes the key of the signer.`);
      expect(process.exitCode).to.equal(1);
    });

    it('refuses a record key that the keystore does not hold', async () => {
      const { did } = seedIdentity();
      new IdentifierRecords(join(home, 'dids.json')).record(did, { signingKey: `urn:kms:secp256k1:${'0'.repeat(32)}` });
      await run([ 'message', 'sign', '-i', did, MESSAGE ]);
      expect(err.join('\n')).to.include('but the keystore does not hold it');
      expect(resolveCalls).to.have.length(0);
    });

    it('-m selects one of two methods that publish the signing key', async () => {
      const { did } = seedIdentity();
      const twoMethods = (id: string): Btcr2DidDocument => {
        const document = initialDocument(id);
        document.verificationMethod.push({ ...document.verificationMethod[0], id: `${id}#second` });
        document.assertionMethod!.push(`${id}#second`);
        return document;
      };
      const keystoreFactory = resolving(keystoreApi(), twoMethods);

      await run([ 'message', 'sign', '-i', did, MESSAGE ], { keystore: keystoreFactory });
      expect(err.join('\n')).to.include('Pass verificationMethodId to choose one.');

      await run([ 'message', 'sign', '-i', did, '-m', '#second', MESSAGE ], { keystore: keystoreFactory });
      expect(lastJson().proof.verificationMethod).to.equal(`${did}#second`);
    });

    it('passes the record sidecar, the --sidecar data, and --min-conf to the resolution', async () => {
      const { did } = seedIdentity();
      const recordGenesis = { id: 'record' };
      const fileGenesis = { id: 'file' };
      new IdentifierRecords(join(home, 'dids.json')).record(did, { sidecar: { genesisDocument: recordGenesis } });
      const sidecar = writeJson('sidecar.json', { genesisDocument: fileGenesis });

      await run([ 'message', 'sign', '-i', did, '--sidecar', sidecar, '--min-conf', '2', MESSAGE ]);
      expect(resolveCalls[0].options).to.deep.equal({ sidecar: { genesisDocument: fileGenesis }, minConf: 2 });

      await run([ 'message', 'sign', '-i', did, MESSAGE ]);
      expect(resolveCalls[1].options).to.deep.equal({ sidecar: { genesisDocument: recordGenesis } });
    });

    it('a resolution failure prints one line, exits 1, and asks for no passphrase', async () => {
      const { did } = seedIdentity();
      let asked = 0;
      const spyKeystore: ApiFactory = () => createApi({
        kms : new FileBackedKeyManager({ path: keystore, getPassphrase: () => { asked += 1; return 'pw'; } }),
      });

      await run([ 'message', 'sign', '-i', did, MESSAGE ], { keystore: failing(spyKeystore) });
      expect(err).to.deep.equal([ `Could not resolve ${did}: no beacon signal names the DID` ]);
      expect(process.exitCode).to.equal(1);
      expect(asked).to.equal(0);
    });

    it('refuses a mainnet identifier with a dev keystore before any resolution (ADR 080)', async () => {
      initKeystore(join(home, 'keystore.json'), { protection: 'none', getPassphrase: () => 'unused' });
      const did = sdk.btcr2.createDeterministic(sdk.crypto.keypair.generate().publicKey.compressed, { network: 'bitcoin' });

      await run([ 'message', 'sign', '-i', did, MESSAGE ]);
      expect(err.join('\n')).to.include('Refusing a mainnet (bitcoin) operation with the unencrypted dev keystore');
      expect(process.exitCode).to.equal(1);
      expect(resolveCalls).to.have.length(0);
    });

    it('shows --signing-key and the message argument in its help', () => {
      const cli = new DidBtcr2Cli(createTestApiFactory(), keystoreApi());
      const message = cli.program.commands.find(command => command.name() === 'message')!;
      const sign = message.commands.find(command => command.name() === 'sign')!;
      // Commander wraps long help lines, so compare with the whitespace collapsed.
      const help = sign.helpInformation().replace(/\s+/g, ' ');
      expect(help).to.include('Usage: btcr2 message sign [options] <message>');
      expect(help).to.include('--signing-key <ref> Key that signs the message');
      expect(cli.program.helpInformation().replace(/\s+/g, ' '))
        .to.include('config validate, identifier validate, and message verify print only OK or the failures');
    });
  });

  describe('message verify', () => {
    it('prints the full report and exits 0; -q prints OK', async () => {
      const { did } = seedIdentity();
      const { path } = await signToFile(did);

      await run([ 'message', 'verify', '-i', did, path ], { keystore: never });
      const report = lastJson();
      expect(report).to.include({ did, verified: true, message: MESSAGE, checkedAgainst: 'current', versionId: '1' });
      expect(report.checks.map((check: { name: string }) => check.name))
        .to.deep.equal([ 'structure', 'signer', 'active', 'assertionMethod', 'signature' ]);
      expect(process.exitCode).to.equal(undefined);

      await run([ '-q', 'message', 'verify', '-i', did, path ], { keystore: never });
      expect(out[out.length - 1]).to.equal('OK');
    });

    it('-i takes the name of an identifier record', async () => {
      const { did } = seedIdentity();
      const { path } = await signToFile(did);
      new IdentifierRecords(join(home, 'dids.json')).record(did, { name: 'alice' });
      const calls = resolveCalls.length;

      await run([ '-q', 'message', 'verify', '-i', 'alice', path ], { keystore: never });
      expect(out[out.length - 1]).to.equal('OK');
      expect(resolveCalls[calls].did).to.equal(did);
    });

    it('unwraps the envelope of a -o json sign output', async () => {
      const { did } = seedIdentity();
      await run([ '-o', 'json', 'message', 'sign', '-i', did, MESSAGE ]);
      const envelope = JSON.parse(out.pop()!);
      const path = writeJson('envelope.json', envelope);

      await run([ '-q', 'message', 'verify', '-i', did, path ], { keystore: never });
      expect(out[out.length - 1]).to.equal('OK');
      expect(process.exitCode).to.equal(undefined);

      // A member next to action and data is not an envelope: the file shows a
      // message that the checks do not read, so it fails the structure check.
      const smuggled = writeJson('smuggled.json', { ...envelope, message: 'FAKE text' });
      await run([ '-q', 'message', 'verify', '-i', did, smuggled ], { keystore: never });
      expect(out[out.length - 1]).to.match(/^Message not verified \(structure check\)/);
      expect(process.exitCode).to.equal(1);
    });

    it('a changed message fails with exit 1 and no message; -q prints the failed check', async () => {
      const { did } = seedIdentity();
      const { signed } = await signToFile(did);
      const path = writeJson('changed.json', { ...signed, message: `${MESSAGE}!` });

      await run([ 'message', 'verify', '-i', did, path ], { keystore: never });
      const report = lastJson();
      expect(report.verified).to.equal(false);
      expect(report).to.not.have.property('message');
      expect(process.exitCode).to.equal(1);

      await run([ '-q', 'message', 'verify', '-i', did, path ], { keystore: never });
      expect(out[out.length - 1]).to.equal(
        'Message not verified (signature check): The signature does not match the message and the key of the method.'
      );
    });

    it('-q escapes each control character that the file puts in the failed check', async () => {
      const { did } = seedIdentity();
      const { signed } = await signToFile(did);
      // ESC [2K erases the line and CR goes to column 0, so a raw line can show only "OK".
      const path = writeJson('escape.json', { ...signed, proof: { ...signed.proof, verificationMethod: 'x\u001b[2K\rOK' } });

      await run([ '-q', 'message', 'verify', '-i', did, path ], { keystore: never });
      const line = out[out.length - 1];
      expect(line).to.not.match(/\p{Cc}/u);
      expect(line).to.include('The proof names the method x\\u001b[2K\\u000dOK, which is not a method of');
      expect(process.exitCode).to.equal(1);
    });

    it('a message of another identifier fails the signer check', async () => {
      const alice = seedIdentity();
      const { path } = await signToFile(alice.did);
      const other = seedIdentity();

      await run([ '-q', 'message', 'verify', '-i', other.did, path ], { keystore: never });
      expect(out[out.length - 1]).to.match(/^Message not verified \(signer check\)/);
      expect(process.exitCode).to.equal(1);
    });

    it('a key that a later update removed fails the assertionMethod check', async () => {
      const { did } = seedIdentity();
      const { path } = await signToFile(did);
      const rotated = (id: string): Btcr2DidDocument => ({ ...initialDocument(id), assertionMethod: [] });

      await run([ 'message', 'verify', '-i', did, path ], { factory: resolving(createTestApiFactory(), rotated, '2'), keystore: never });
      const report = lastJson();
      expect(report).to.include({ verified: false, versionId: '2' });
      expect(report.checks[report.checks.length - 1].name).to.equal('assertionMethod');
      expect(process.exitCode).to.equal(1);
    });

    it('reads the file before any resolution', async () => {
      const { did } = seedIdentity();
      await run([ 'message', 'verify', '-i', did, join(dir, 'missing.json') ], { keystore: never });
      expect(err.join('\n')).to.include('Could not read the signed message file');

      await run([ 'message', 'verify', '-i', did, writeJson('bad.json', '{ not json') ], { keystore: never });
      expect(err.join('\n')).to.include('bad.json');
      expect(resolveCalls).to.have.length(0);
    });

    it('passes the record sidecar, the --sidecar data, and --min-conf to the resolution', async () => {
      const { did } = seedIdentity();
      const { path } = await signToFile(did);
      const recordGenesis = { id: 'record' };
      const fileGenesis = { id: 'file' };
      new IdentifierRecords(join(home, 'dids.json')).record(did, { sidecar: { genesisDocument: recordGenesis } });
      const sidecar = writeJson('sidecar.json', { genesisDocument: fileGenesis });
      const calls = resolveCalls.length;

      await run([ '-q', 'message', 'verify', '-i', did, '--sidecar', sidecar, '--min-conf', '2', path ], { keystore: never });
      expect(out[out.length - 1]).to.equal('OK');
      expect(resolveCalls[calls].options).to.deep.equal({ sidecar: { genesisDocument: fileGenesis }, minConf: 2 });

      await run([ '-q', 'message', 'verify', '-i', did, path ], { keystore: never });
      expect(resolveCalls[calls + 1].options).to.deep.equal({ sidecar: { genesisDocument: recordGenesis } });
    });

    it('--sidecar refuses a minConf member and a resolution options file', async () => {
      const { did } = seedIdentity();
      const { path } = await signToFile(did);

      await run([ 'message', 'verify', '-i', did, path, '--sidecar', writeJson('s1.json', { minConf: 100 }) ], { keystore: never });
      expect(err.join('\n')).to.include('has the unknown field "minConf"');

      await run([ 'message', 'verify', '-i', did, path, '--sidecar', writeJson('s2.json', { sidecar: {}, versionId: 1 }) ], { keystore: never });
      expect(err.join('\n')).to.include('The file holds resolution options');
      expect(resolveCalls).to.have.length(1);
    });

    it('--offline checks the initial document with no resolution, and warns', async () => {
      const { did } = seedIdentity();
      const { path } = await signToFile(did);
      const calls = resolveCalls.length;

      // The connection api is not built: --offline reads no endpoint.
      await run([ 'message', 'verify', '--offline', '-i', did, path ], { factory: never, keystore: never });
      expect(lastJson()).to.include({ verified: true, checkedAgainst: 'initial' });
      expect(lastJson()).to.not.have.property('versionId');
      expect(err.join('\n')).to.include('Warning: --offline checks the initial DID document only.');
      expect(resolveCalls).to.have.length(calls);

      err.length = 0;
      await run([ '-q', 'message', 'verify', '--offline', '-i', did, path ], { factory: never, keystore: never });
      expect(out[out.length - 1]).to.equal('OK');
      expect(err).to.deep.equal([]);
    });

    it('--offline refuses --min-conf, and --sidecar for a KEY identifier', async () => {
      const { did } = seedIdentity();
      const { path } = await signToFile(did);

      await run([ 'message', 'verify', '--offline', '--min-conf', '2', '-i', did, path ], { keystore: never });
      expect(err.join('\n')).to.include('--min-conf applies only without --offline.');

      await run([ 'message', 'verify', '--offline', '--sidecar', writeJson('s.json', {}), '-i', did, path ], { keystore: never });
      expect(err.join('\n')).to.include('--sidecar with --offline applies only to external identifiers (x)');
    });

    it('--offline for an EXTERNAL identifier takes the genesis document of --sidecar, else of the record', async () => {
      const kms = keystoreApi()().kms;
      const genesisOf = (keyId: string) => JSON.parse(JSON.stringify(sdk.btcr2.buildGenesisDocument({
        network             : 'regtest',
        verificationMethods : [{ publicKey: kms.getPublicKey(keyId) }],
      })));
      const genesisDocument = genesisOf(kms.generateKey({ setActive: true }));
      const otherGenesis = genesisOf(kms.generateKey({ setActive: false }));
      const { did, didDocument } = sdk.btcr2.createExternalFromDocument(genesisDocument, { network: 'regtest' });
      const { path } = await signToFile(did, { keystore: resolving(keystoreApi(), () => didDocument) });
      const offline = { factory: never, keystore: never };

      await run([ 'message', 'verify', '--offline', '-i', did, path ], offline);
      expect(err.join('\n')).to.include('An external identifier (x) needs its genesis document for --offline.');

      const sidecar = writeJson('genesis-sidecar.json', { genesisDocument });
      await run([ '-q', 'message', 'verify', '--offline', '--sidecar', sidecar, '-i', did, path ], offline);
      expect(out[out.length - 1]).to.equal('OK');

      // The --sidecar file wins over the genesis document of the record.
      const records = new IdentifierRecords(join(home, 'dids.json'));
      records.record(did, { sidecar: { genesisDocument: otherGenesis } });
      out.length = 0;
      await run([ '-q', 'message', 'verify', '--offline', '--sidecar', sidecar, '-i', did, path ], offline);
      expect(out).to.deep.equal([ 'OK' ]);

      // With no --sidecar, the record gives the genesis document.
      records.remove(did);
      records.record(did, { sidecar: { genesisDocument } });
      out.length = 0;
      await run([ '-q', 'message', 'verify', '--offline', '-i', did, path ], offline);
      expect(out).to.deep.equal([ 'OK' ]);
    });
  });
});

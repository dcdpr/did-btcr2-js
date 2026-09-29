import type { DidBtcr2Api } from '@did-btcr2/api';
import { createApi } from '@did-btcr2/api';
import { bytesToHex } from '@noble/hashes/utils.js';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DidBtcr2Cli } from '../src/cli.js';
import type { ApiFactory } from '../src/config.js';
import { IdentifierRecords } from '../src/identifier-records.js';
import {
  createKeystoreTestApiFactory,
  createTestApiFactory,
  expect,
  originalConsoleError,
  originalConsoleLog,
} from './helpers.js';

/** The api of the fixtures: offline, with no connection and no key. */
const sdk = createApi();

/** A genesis document on regtest and the EXTERNAL identifier that encodes its hash. */
function externalFixture(): { did: string; document: object } {
  const keyPair = sdk.crypto.keypair.generate();
  const document = JSON.parse(JSON.stringify(sdk.btcr2.buildGenesisDocument({
    network             : 'regtest',
    verificationMethods : [{ publicKey: keyPair.publicKey.compressed }],
    beacons             : [{ type: 'SingletonBeacon', publicKey: keyPair.publicKey.compressed, addressType: 'p2pkh' }],
  })));
  const { did } = sdk.btcr2.createExternalFromDocument(document, { network: 'regtest' });
  return { did, document };
}

describe('identifier record commands (ADR 133)', () => {
  let dir: string;
  let home: string;
  let keystore: string;
  let out: string[];
  let err: string[];
  let originalStderrWrite: typeof process.stderr.write;
  /** The arguments of the stubbed write and resolve calls of the last command. */
  let captured: { source?: unknown; signer?: { publicKey: Uint8Array }; options?: any; resolveOptions?: any };

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'btcr2-record-commands-'));
    home = join(dir, 'home');
    keystore = join(dir, 'keystore.json');
    out = [];
    err = [];
    captured = {};
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
  const keystoreFactory = (): ApiFactory => createKeystoreTestApiFactory(keystore, 'pw');

  /**
   * A keystore-backed api whose updateDid and deactivateDid capture their
   * arguments and return a fixed result, so no Bitcoin I/O happens.
   */
  function writeStub(): ApiFactory {
    return () => {
      const realApi = keystoreFactory()();
      const write = async (source: unknown, ...rest: unknown[]) => {
        captured.source = source;
        const [ signer, options ] = rest.length === 3 ? rest.slice(1) : rest;
        captured.signer = signer as { publicKey: Uint8Array };
        captured.options = options;
        return {
          signedUpdate   : { update: out.length },
          txid           : 'ab'.repeat(32),
          publishedToCas : { update: false, announcement: false },
        };
      };
      return { kms: realApi.kms, updateDid: write, deactivateDid: write } as unknown as DidBtcr2Api;
    };
  }

  /** An api whose resolveDid captures its options. */
  function resolveStub(): ApiFactory {
    return () => ({
      resolveDid : async (_did: string, options: unknown) => {
        captured.resolveOptions = options;
        return { didDocument: {} };
      },
    }) as unknown as DidBtcr2Api;
  }

  async function run(args: string[], factories: { factory?: ApiFactory; keystore?: ApiFactory } = {}): Promise<void> {
    const cli = new DidBtcr2Cli(factories.factory ?? createTestApiFactory(), factories.keystore ?? keystoreFactory());
    await cli.run([ 'node', 'btcr2', '--home', home, '-o', 'json', ...args ]);
  }

  /** The data of the last JSON envelope on stdout. */
  const lastData = (): any => JSON.parse(out[out.length - 1]).data;

  const records = (): IdentifierRecords => new IdentifierRecords(join(home, 'dids.json'));

  /** Generates a stored key, sets it active, and returns its URN. */
  function seedKey(): string {
    return keystoreFactory()().kms.generateKey({ setActive: true });
  }

  describe('create', () => {
    it('records a generated key as the signing key of the identifier', async () => {
      await run([ 'create', '-n', 'regtest' ]);
      const { data: did, keyId } = JSON.parse(out[0]);
      const record = records().get(did);
      expect(record?.keys).to.deep.equal([ keyId ]);
      expect(record?.signingKey).to.equal(keyId);
    });

    it('records the stored key of --key, and the name of --name', async () => {
      const keyId = seedKey();
      await run([ 'create', '-n', 'regtest', '--key', keyId, '--name', 'alice' ]);
      const did = JSON.parse(out[0]).data;
      expect(records().get(did)).to.include({ name: 'alice', signingKey: keyId });
    });

    it('records a raw-bytes identifier with no key', async () => {
      const publicKey = bytesToHex(sdk.crypto.keypair.generate().publicKey.compressed);
      await run([ 'create', '-n', 'regtest', '--bytes', publicKey ]);
      const record = records().get(JSON.parse(out[0]).data);
      expect(record?.keys).to.deep.equal([]);
      expect(record?.signingKey).to.equal(undefined);
    });

    it('records the genesis document of --document in the sidecar data', async () => {
      const { did, document } = externalFixture();
      const path = join(dir, 'genesis.json');
      writeFileSync(path, JSON.stringify(document));
      await run([ 'create', '-t', 'x', '-n', 'regtest', '--document', path ]);
      expect(JSON.parse(out[0]).data).to.equal(did);
      expect(records().get(did)?.sidecar).to.deep.equal({ genesisDocument: document });
    });

    it('refuses a name that another identifier has, before it generates a key', async () => {
      const publicKey = bytesToHex(sdk.crypto.keypair.generate().publicKey.compressed);
      await run([ 'create', '-n', 'regtest', '--bytes', publicKey, '--name', 'alice' ]);
      out.length = 0;
      // The keystore is empty, so this create generates a key if it does not refuse.
      await run([ 'create', '-n', 'regtest', '--name', 'alice' ]);
      expect(process.exitCode).to.equal(1);
      expect(err.join('\n')).to.include('The name "alice" belongs to the identifier');
      expect(out).to.deep.equal([]);
      expect(keystoreFactory()().kms.kms.listKeys()).to.deep.equal([]);
    });

    it('refuses a name that another identifier has, for a stored key', async () => {
      await run([ 'create', '-n', 'regtest', '--name', 'alice' ]);
      await run([ 'create', '-n', 'mutinynet', '--name', 'alice' ]);
      expect(process.exitCode).to.equal(1);
      expect(err.join('\n')).to.include('The name "alice" belongs to the identifier');
      expect(records().list()).to.have.length(1);
    });

    it('accepts the name again for the same identifier', async () => {
      const keyId = seedKey();
      await run([ 'create', '-n', 'regtest', '--key', keyId, '--name', 'alice' ]);
      await run([ 'create', '-n', 'regtest', '--key', keyId, '--name', 'alice' ]);
      expect(process.exitCode).to.equal(undefined);
      expect(records().list()).to.have.length(1);
    });
  });

  describe('identifier list, show, add, remove, sidecar', () => {
    it('list prints a summary of each record, and filters by network and key', async () => {
      const keyId = seedKey();
      await run([ 'create', '-n', 'regtest', '--key', keyId, '--name', 'alice' ]);
      const regtest = JSON.parse(out[0]).data;
      await run([ 'create', '-n', 'mutinynet', '--bytes', bytesToHex(sdk.crypto.keypair.generate().publicKey.compressed) ]);
      const mutinynet = JSON.parse(out[1]).data;

      await run([ 'identifier', 'list' ]);
      expect(lastData()).to.deep.equal([
        { identifier: regtest, name: 'alice', network: 'regtest', type: 'k', keys: [ keyId ], signingKey: keyId, updates: 0 },
        { identifier: mutinynet, network: 'mutinynet', type: 'k', keys: [], updates: 0 },
      ]);
      await run([ 'identifier', 'ls', '-n', 'mutinynet' ]);
      expect(lastData().map((e: { identifier: string }) => e.identifier)).to.deep.equal([ mutinynet ]);
      await run([ 'identifier', 'list', '--key', keyId.split(':').pop()!.slice(0, 8) ]);
      expect(lastData().map((e: { identifier: string }) => e.identifier)).to.deep.equal([ regtest ]);
    });

    it('list refuses an unknown network', async () => {
      await run([ 'identifier', 'list', '-n', 'nope' ]);
      expect(process.exitCode).to.equal(1);
      expect(err.join('\n')).to.include('Invalid network "nope".');
    });

    it('show prints the full record by identifier or by name', async () => {
      await run([ 'create', '-n', 'regtest', '--name', 'alice' ]);
      const did = JSON.parse(out[0]).data;
      await run([ 'identifier', 'show', 'alice' ]);
      expect(lastData()).to.include({ identifier: did, network: 'regtest', type: 'k', name: 'alice' });
      expect(lastData().sidecar).to.deep.equal({});
      await run([ 'identifier', 'show', did ]);
      expect(lastData().identifier).to.equal(did);
    });

    it('show refuses an identifier with no record', async () => {
      const did = sdk.createDid('deterministic', sdk.crypto.keypair.generate().publicKey.compressed, { network: 'regtest' });
      await run([ 'identifier', 'show', did ]);
      expect(process.exitCode).to.equal(1);
      expect(err.join('\n')).to.include(`No identifier record for ${did}.`);
    });

    it('add links the stored key of the genesis bytes of a KEY identifier', async () => {
      const keyId = seedKey();
      const publicKey = keystoreFactory()().kms.getPublicKey(keyId);
      const did = sdk.createDid('deterministic', publicKey, { network: 'regtest' });
      await run([ 'identifier', 'add', did, '--name', 'alice' ]);
      expect(lastData()).to.include({ identifier: did, name: 'alice', signingKey: keyId });
      expect(lastData().keys).to.deep.equal([ keyId ]);
    });

    it('add with --key sets the signing key, and a later add keeps it', async () => {
      const genesisKey = seedKey();
      const otherKey = seedKey();
      const did = sdk.createDid('deterministic', keystoreFactory()().kms.getPublicKey(genesisKey), { network: 'regtest' });
      await run([ 'identifier', 'add', did, '--key', otherKey ]);
      expect(lastData().signingKey).to.equal(otherKey);
      await run([ 'identifier', 'add', did ]);
      expect(lastData().signingKey).to.equal(otherKey);
      expect(lastData().keys).to.deep.equal([ otherKey ]);
    });

    it('add merges a sidecar data file, and sidecar prints it back', async () => {
      const { did, document } = externalFixture();
      const path = join(dir, 'sidecar.json');
      writeFileSync(path, JSON.stringify({ genesisDocument: document, updates: [ { u: 1 } ] }));
      await run([ 'identifier', 'add', did, '--sidecar', path ]);
      await run([ 'identifier', 'add', did, '--sidecar', path ]);
      await run([ 'identifier', 'sidecar', did ]);
      expect(lastData()).to.deep.equal({ genesisDocument: document, updates: [ { u: 1 } ] });
    });

    it('add accepts the name of a record, and show prints the fields in a fixed order', async () => {
      const publicKey = bytesToHex(sdk.crypto.keypair.generate().publicKey.compressed);
      await run([ 'create', '-n', 'regtest', '--bytes', publicKey, '--name', 'alice' ]);
      const keyId = seedKey();
      await run([ 'identifier', 'add', 'alice', '--key', keyId ]);
      await run([ 'identifier', 'show', 'alice' ]);
      expect(Object.keys(lastData())).to.deep.equal(
        [ 'identifier', 'name', 'network', 'type', 'added', 'keys', 'signingKey', 'txids', 'sidecar' ],
      );
      const file = JSON.parse(readFileSync(join(home, 'dids.json'), 'utf-8'));
      expect(Object.keys(Object.values(file.identifiers)[0] as object)).to.deep.equal(
        [ 'name', 'added', 'keys', 'signingKey', 'txids', 'sidecar' ],
      );
    });

    it('add refuses a resolution options file, and names the sidecar field', async () => {
      const path = join(dir, 'options.json');
      writeFileSync(path, JSON.stringify({ sidecar: { updates: [] } }));
      await run([ 'identifier', 'add', externalFixture().did, '--sidecar', path ]);
      expect(process.exitCode).to.equal(1);
      expect(err.join('\n')).to.include('has the unknown field "sidecar". The file holds resolution options');
    });

    it('add refuses a field with the wrong JSON type', async () => {
      const path = join(dir, 'bad.json');
      writeFileSync(path, JSON.stringify({ updates: {} }));
      await run([ 'identifier', 'add', externalFixture().did, '--sidecar', path ]);
      expect(process.exitCode).to.equal(1);
      expect(err.join('\n')).to.include('The field "updates" of the sidecar data file');
    });

    it('add refuses an invalid identifier', async () => {
      await run([ 'identifier', 'add', 'did:btcr2:nope' ]);
      expect(process.exitCode).to.equal(1);
      expect(err.join('\n')).to.include('Invalid identifier');
      expect(existsSync(join(home, 'dids.json'))).to.equal(false);
    });

    it('remove deletes the record by name and keeps the key', async () => {
      await run([ 'create', '-n', 'regtest', '--name', 'alice' ]);
      const { data: did, keyId } = JSON.parse(out[0]);
      await run([ 'identifier', 'rm', 'alice' ]);
      expect(lastData()).to.deep.equal({ identifier: did, removed: true });
      expect(records().get(did)).to.equal(undefined);
      expect(keystoreFactory()().kms.kms.listKeys()).to.include(keyId);
    });

    it('remove refuses an identifier with no record, and writes nothing', async () => {
      const did = sdk.createDid('deterministic', sdk.crypto.keypair.generate().publicKey.compressed, { network: 'regtest' });
      await run([ 'identifier', 'remove', did ]);
      expect(process.exitCode).to.equal(1);
      expect(err.join('\n')).to.include(`No identifier record for ${did}.`);
      expect(existsSync(join(home, 'dids.json'))).to.equal(false);
    });

    it('sidecar --out writes a new file and refuses an existing file', async () => {
      const { did, document } = externalFixture();
      const genesis = join(dir, 'genesis.json');
      writeFileSync(genesis, JSON.stringify(document));
      await run([ 'create', '-t', 'x', '-n', 'regtest', '--document', genesis ]);
      const path = join(dir, 'out.json');
      await run([ 'identifier', 'sidecar', did, '--out', path ]);
      expect(lastData()).to.deep.equal({ identifier: did, path });
      expect(JSON.parse(readFileSync(path, 'utf-8'))).to.deep.equal({ genesisDocument: document });
      await run([ 'identifier', 'sidecar', did, '--out', path ]);
      expect(process.exitCode).to.equal(1);
      expect(err.join('\n')).to.include(`The file ${path} exists.`);
    });
  });

  describe('update, deactivate, and resolve', () => {
    it('update signs with the signing key of the record, not the active key', async () => {
      const recordKey = seedKey();
      await run([ 'create', '-n', 'regtest', '--key', recordKey, '--name', 'alice' ]);
      const activeKey = seedKey();
      await run([ 'update', '-i', 'alice', '-p', '[]' ], { keystore: writeStub() });
      const kms = keystoreFactory()().kms;
      expect(captured.signer?.publicKey).to.deep.equal(kms.getPublicKey(recordKey));
      expect(captured.signer?.publicKey).to.not.deep.equal(kms.getPublicKey(activeKey));
    });

    it('--signing-key wins over the signing key of the record, and becomes the new one', async () => {
      const recordKey = seedKey();
      await run([ 'create', '-n', 'regtest', '--key', recordKey ]);
      const did = JSON.parse(out[0]).data;
      const otherKey = seedKey();
      await run([ 'update', '-i', did, '-p', '[]', '--signing-key', otherKey ], { keystore: writeStub() });
      const kms = keystoreFactory()().kms;
      expect(captured.signer?.publicKey).to.deep.equal(kms.getPublicKey(otherKey));
      expect(records().get(did)).to.include({ signingKey: otherKey });
      expect(records().get(did)?.keys).to.deep.equal([ recordKey, otherKey ]);
    });

    it('update refuses a record signing key that the keystore does not hold', async () => {
      const did = sdk.createDid('deterministic', sdk.crypto.keypair.generate().publicKey.compressed, { network: 'regtest' });
      records().record(did, { signingKey: 'urn:kms:secp256k1:00000000000000000000000000000000' });
      seedKey();
      await run([ 'update', '-i', did, '-p', '[]' ], { keystore: writeStub() });
      expect(process.exitCode).to.equal(1);
      expect(err.join('\n')).to.include('but the keystore does not hold it. Use --signing-key <ref> to select a key. '
        + `Use "btcr2 identifier add ${did} -k <ref>" to change the key of the record.`);
      expect(captured.source).to.equal(undefined);
    });

    it('update records the transaction and the signed update, and the next update resolves with them', async () => {
      await run([ 'create', '-n', 'regtest', '--name', 'alice' ]);
      const did = JSON.parse(out[0]).data;
      await run([ 'update', '-i', 'alice', '-p', '[]' ], { keystore: writeStub() });
      expect(captured.source).to.equal(did);
      expect(captured.options.resolutionOptions).to.equal(undefined);
      const record = records().get(did);
      expect(record?.txids).to.deep.equal([ 'ab'.repeat(32) ]);
      expect(record?.sidecar.updates).to.have.length(1);

      await run([ 'update', '-i', 'alice', '-p', '[]', '--min-conf', '2' ], { keystore: writeStub() });
      expect(captured.options.resolutionOptions).to.deep.equal({ minConf: 2, sidecar: { updates: record?.sidecar.updates } });
      expect(records().get(did)?.sidecar.updates).to.have.length(2);
    });

    it('update keeps the sidecar data of the flags in the record', async () => {
      await run([ 'create', '-n', 'regtest' ]);
      const did = JSON.parse(out[0]).data;
      const options = JSON.stringify({ sidecar: { updates: [ { prior: 1 } ] } });
      await run([ 'update', '-i', did, '-p', '[]', '-r', options ], { keystore: writeStub() });
      const updates = records().get(did)?.sidecar.updates;
      expect(updates).to.have.length(2);
      expect(updates).to.deep.include({ prior: 1 });
    });

    it('a supplied source pair skips the record sidecar', async () => {
      await run([ 'create', '-n', 'regtest', '--name', 'alice' ]);
      const did = JSON.parse(out[0]).data;
      records().record(did, { sidecar: { updates: [ { prior: 1 } as never ] } });
      await run(
        [ 'update', '-i', 'alice', '-p', '[]', '-s', JSON.stringify({ id: did }), '--source-version-id', '1' ],
        { keystore: writeStub() },
      );
      expect(captured.options.resolutionOptions).to.equal(undefined);
    });

    it('deactivate marks the record as deactivated', async () => {
      await run([ 'create', '-n', 'regtest', '--name', 'alice' ]);
      const did = JSON.parse(out[0]).data;
      await run([ 'deactivate', '-i', 'alice' ], { keystore: writeStub() });
      expect(records().get(did)).to.include({ deactivated: true });
      await run([ 'identifier', 'list' ]);
      expect(lastData()[0]).to.include({ deactivated: true, updates: 1 });
    });

    it('update refuses a name that no record has', async () => {
      await run([ 'update', '-i', 'nobody', '-p', '[]' ], { keystore: writeStub() });
      expect(process.exitCode).to.equal(1);
      expect(err.join('\n')).to.include('No identifier record has the name "nobody".');
    });

    it('resolve accepts a name and adds the record sidecar to the options', async () => {
      const { did, document } = externalFixture();
      const path = join(dir, 'genesis.json');
      writeFileSync(path, JSON.stringify(document));
      await run([ 'create', '-t', 'x', '-n', 'regtest', '--document', path, '--name', 'ext' ]);
      await run([ 'resolve', '-i', 'ext' ], { factory: resolveStub() });
      expect(captured.resolveOptions).to.deep.equal({ sidecar: { genesisDocument: document } });
      expect(records().get(did)).to.not.equal(undefined);
    });

    it('resolve of an identifier with no record passes the flag options only', async () => {
      const did = sdk.createDid('deterministic', sdk.crypto.keypair.generate().publicKey.compressed, { network: 'regtest' });
      await run([ 'resolve', '-i', did, '--min-conf', '3' ], { factory: resolveStub() });
      expect(captured.resolveOptions).to.deep.equal({ minConf: 3 });
      expect(existsSync(join(home, 'dids.json'))).to.equal(false);
    });
  });

  it('config path prints the identifier records path', async () => {
    await run([ 'config', 'path' ]);
    expect(lastData().dids).to.equal(join(home, 'dids.json'));
  });
});

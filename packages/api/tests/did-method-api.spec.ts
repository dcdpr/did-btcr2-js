import { expect, use } from 'chai';
import chaiAsPromised from 'chai-as-promised';
import type { BitcoinConnection, HttpExecutor } from '@did-btcr2/bitcoin';
import { canonicalHashBytes, INVALID_DID_UPDATE, ResolveError, UpdateError } from '@did-btcr2/common';
import { CompressedSecp256k1PublicKey, LocalSigner, SchnorrKeyPair } from '@did-btcr2/keypair';
import {
  BitcoinApi,
  DidApi,
  DidMethodApi,
  MultikeyApi,
  UpdateBuilder,
} from '../src/index.js';

use(chaiAsPromised);

/**
 * A genesis document for an EXTERNAL (`x`) DID: placeholder ids, one Multikey
 * verification method, one Singleton beacon. Its canonical hash is the DID's
 * genesis bytes, so it is the only document the resolver accepts for that DID.
 */
const EXTERNAL_GENESIS_DOCUMENT = {
  'id'       : 'did:btcr2:_',
  '@context' : [
    'https://www.w3.org/ns/did/v1.1',
    'https://btcr2.dev/context/v1'
  ],
  'verificationMethod' : [
    {
      'id'                 : 'did:btcr2:_#key-0',
      'type'               : 'Multikey',
      'controller'         : 'did:btcr2:_',
      'publicKeyMultibase' : 'zQ3shiAVyapkPizvsLJZ8mYqPZetmbNNjgLVWTe5CLKZjvs34'
    }
  ],
  'authentication'       : ['did:btcr2:_#key-0'],
  'assertionMethod'      : ['did:btcr2:_#key-0'],
  'capabilityInvocation' : ['did:btcr2:_#key-0'],
  'capabilityDelegation' : ['did:btcr2:_#key-0'],
  'service'              : [
    {
      'id'              : 'did:btcr2:_#service-0',
      'serviceEndpoint' : 'bitcoin:12QG2GG9TWPD16SWyfWCsW4W3NhMFnnSFK',
      'type'            : 'SingletonBeacon'
    }
  ]
};

/**
 * An {@link HttpExecutor} standing in for an Esplora backend whose chain holds
 * no beacon signals: the tip is at height 100 and no address has transactions.
 * Every request URL is recorded so a test can prove which connection
 * resolution actually read from.
 */
function emptyChainExecutor(): { executor: HttpExecutor; urls: string[] } {
  const urls: string[] = [];
  const executor: HttpExecutor = async (req) => {
    urls.push(req.url);
    const body = req.url.endsWith('/blocks/tip/height') ? '100' : '[]';
    return new Response(body, { status: 200, headers: { 'Content-Type': 'application/json' } });
  };
  return { executor, urls };
}

/**
 * DidMethodApi Test
 */
describe('DidMethodApi', () => {
  describe('createDeterministic()', () => {
    it('creates a KEY-type DID', () => {
      const methodApi = new DidMethodApi();
      const kp = SchnorrKeyPair.generate();
      const did = methodApi.createDeterministic(kp.publicKey.compressed);
      expect(did).to.match(/^did:btcr2:/);
      const didApi = new DidApi();
      const components = didApi.decode(did);
      expect(components.idType).to.equal('KEY');
    });

    it('passes options through (e.g., network)', () => {
      const methodApi = new DidMethodApi();
      const kp = SchnorrKeyPair.generate();
      const did = methodApi.createDeterministic(kp.publicKey.compressed, { network: 'testnet4' });
      const didApi = new DidApi();
      const components = didApi.decode(did);
      expect(components.network).to.equal('testnet4');
    });

    it('rejects empty genesisBytes', () => {
      const methodApi = new DidMethodApi();
      expect(() => methodApi.createDeterministic(new Uint8Array(0))).to.throw(
        'genesisBytes must be a non-empty Uint8Array'
      );
    });

    it('rejects non-33-byte genesisBytes', () => {
      const methodApi = new DidMethodApi();
      expect(() => methodApi.createDeterministic(new Uint8Array(32))).to.throw(
        '33-byte compressed public key'
      );
    });
  });

  describe('defaultNetwork', () => {
    it('falls back to regtest without a Bitcoin connection', () => {
      expect(DidMethodApi.FALLBACK_NETWORK).to.equal('regtest');
      expect(new DidMethodApi().defaultNetwork).to.equal('regtest');
    });

    it('reports the configured connection network', () => {
      expect(new DidMethodApi(new BitcoinApi({ network: 'mutinynet' })).defaultNetwork)
        .to.equal('mutinynet');
    });

    it('mints deterministic DIDs on the configured network when none is named', () => {
      const methodApi = new DidMethodApi(new BitcoinApi({ network: 'mutinynet' }));
      const kp = SchnorrKeyPair.generate();
      const did = methodApi.createDeterministic(kp.publicKey.compressed);
      expect(new DidApi().decode(did).network).to.equal('mutinynet');
    });

    it('mints external DIDs on the configured network when none is named', () => {
      const methodApi = new DidMethodApi(new BitcoinApi({ network: 'signet' }));
      const did = methodApi.createExternal(new Uint8Array(32).fill(0xAB));
      expect(new DidApi().decode(did).network).to.equal('signet');
    });

    it('lets an explicit network win over the configured one', () => {
      const methodApi = new DidMethodApi(new BitcoinApi({ network: 'mutinynet' }));
      const kp = SchnorrKeyPair.generate();
      const did = methodApi.createDeterministic(kp.publicKey.compressed, { network: 'testnet4' });
      expect(new DidApi().decode(did).network).to.equal('testnet4');
    });

    it('treats an explicit undefined network as "not named"', () => {
      // `{ network: undefined }` must fall through to the configured network,
      // not spread over it and re-trigger the upstream mainnet default.
      const methodApi = new DidMethodApi(new BitcoinApi({ network: 'mutinynet' }));
      const kp = SchnorrKeyPair.generate();
      const did = methodApi.createDeterministic(kp.publicKey.compressed, { network: undefined });
      expect(new DidApi().decode(did).network).to.equal('mutinynet');
    });

    it('mints deterministic DIDs on regtest with no Bitcoin connection', () => {
      // An offline facade has no chain to inherit from; it must not fall
      // through to the upstream mainnet default.
      const methodApi = new DidMethodApi();
      const kp = SchnorrKeyPair.generate();
      const did = methodApi.createDeterministic(kp.publicKey.compressed);
      expect(new DidApi().decode(did).network).to.equal('regtest');
    });

    it('mints external DIDs on regtest with no Bitcoin connection', () => {
      const methodApi = new DidMethodApi();
      const did = methodApi.createExternal(new Uint8Array(32).fill(0xAB));
      expect(new DidApi().decode(did).network).to.equal('regtest');
    });

    it('treats an explicit undefined network as "not named" with no Bitcoin connection', () => {
      // `{ network: undefined }` would win a spread and reach the upstream
      // mainnet default; the fallback must override it here too.
      const methodApi = new DidMethodApi();
      const kp = SchnorrKeyPair.generate();
      const did = methodApi.createDeterministic(kp.publicKey.compressed, { network: undefined });
      expect(new DidApi().decode(did).network).to.equal('regtest');
    });
  });

  describe('createExternal()', () => {
    it('creates an EXTERNAL-type DID', () => {
      const methodApi = new DidMethodApi();
      const docBytes = new Uint8Array(32).fill(0xAB);
      const did = methodApi.createExternal(docBytes, { network: 'regtest' });
      expect(did).to.match(/^did:btcr2:/);
      const didApi = new DidApi();
      const components = didApi.decode(did);
      expect(components.idType).to.equal('EXTERNAL');
    });

    it('rejects empty genesisBytes', () => {
      const methodApi = new DidMethodApi();
      expect(() => methodApi.createExternal(new Uint8Array(0))).to.throw(
        'genesisBytes must be a non-empty Uint8Array'
      );
    });
  });

  describe('getInitialDocument() / getBeacons()', () => {
    it('derives a KEY DID initial document with zero I/O (no Bitcoin, no CAS)', () => {
      // No connections configured at all: derivation must not touch the network.
      const methodApi = new DidMethodApi();
      const kp = SchnorrKeyPair.generate();
      const did = methodApi.createDeterministic(kp.publicKey.compressed, { network: 'mutinynet' });
      const doc = methodApi.getInitialDocument(did);
      expect(doc.id).to.equal(did);
      expect(doc.verificationMethod).to.have.lengthOf(1);
      expect(doc.service).to.have.lengthOf(3);
    });

    it('pairs each beacon service with a fundable Bitcoin address', () => {
      const methodApi = new DidMethodApi();
      const kp = SchnorrKeyPair.generate();
      const did = methodApi.createDeterministic(kp.publicKey.compressed, { network: 'regtest' });
      const beacons = methodApi.getBeacons(methodApi.getInitialDocument(did));
      expect(beacons.map((b) => b.id)).to.deep.equal([
        `${did}#initialP2PKH`,
        `${did}#initialP2WPKH`,
        `${did}#initialP2TR`,
      ]);
      for(const beacon of beacons) {
        expect(beacon.type).to.equal('SingletonBeacon');
        expect(beacon.address).to.have.length.greaterThan(0);
        expect(beacon.address).to.not.include('bitcoin:');
      }
    });

    it('ignores a genesis document supplied for a KEY DID', () => {
      // A k document is deterministic regardless of what the caller supplies;
      // the second argument must never change (or reject) the derivation.
      const methodApi = new DidMethodApi();
      const kp = SchnorrKeyPair.generate();
      const did = methodApi.createDeterministic(kp.publicKey.compressed, { network: 'regtest' });
      const withDoc = methodApi.getInitialDocument(did, { id: 'did:btcr2:_' });
      expect(JSON.parse(JSON.stringify(withDoc)))
        .to.deep.equal(JSON.parse(JSON.stringify(methodApi.getInitialDocument(did))));
    });

    it('refuses an EXTERNAL DID without its genesis document', () => {
      const methodApi = new DidMethodApi();
      const did = methodApi.createExternal(new Uint8Array(32).fill(0xAB), { network: 'regtest' });
      expect(() => methodApi.getInitialDocument(did)).to.throw(
        'without its genesis document'
      );
    });

    it('derives an EXTERNAL DID initial document from its genesis document', () => {
      const methodApi = new DidMethodApi();
      const did = methodApi.createExternal(canonicalHashBytes(EXTERNAL_GENESIS_DOCUMENT), { network: 'regtest' });
      const doc = methodApi.getInitialDocument(did, EXTERNAL_GENESIS_DOCUMENT);
      expect(doc.id).to.equal(did);
      expect(doc.verificationMethod[0].id).to.equal(`${did}#key-0`);
      expect(methodApi.getBeacons(doc)).to.deep.equal([{
        id      : `${did}#service-0`,
        type    : 'SingletonBeacon',
        address : '12QG2GG9TWPD16SWyfWCsW4W3NhMFnnSFK',
      }]);
    });

    it('rejects a genesis document that does not hash to the DID', () => {
      const methodApi = new DidMethodApi();
      const did = methodApi.createExternal(new Uint8Array(32).fill(0xAB), { network: 'regtest' });
      expect(() => methodApi.getInitialDocument(did, { id: 'did:btcr2:_' })).to.throw(
        'Initial document mismatch'
      );
    });

    it('rejects an empty DID string', () => {
      expect(() => new DidMethodApi().getInitialDocument('')).to.throw(
        'did must be a non-empty string'
      );
    });
  });

  describe('resolve()', () => {
    it('reads beacon signals through the configured Bitcoin connection', async () => {
      const { executor, urls } = emptyChainExecutor();
      const methodApi = new DidMethodApi(new BitcoinApi({ network: 'regtest', executor }));
      const kp = SchnorrKeyPair.generate();
      const did = methodApi.createDeterministic(kp.publicKey.compressed, { network: 'regtest' });
      const beacons = methodApi.getBeacons(methodApi.getInitialDocument(did));

      const result = await methodApi.resolve(did);

      expect(result.didDocument?.id).to.equal(did);
      expect(result.didDocumentMetadata).to.include({ versionId: '1', deactivated: false });
      expect(result.didResolutionMetadata).to.deep.equal({});
      // The injected connection is the one that was read: one tip-height lookup,
      // then one transaction listing per beacon of the initial document.
      expect(urls[0]).to.match(/\/blocks\/tip\/height$/);
      const listed = urls.slice(1);
      expect(listed).to.have.length(beacons.length);
      for (const beacon of beacons) {
        expect(listed.some(url => url.endsWith(`/address/${beacon.address}/txs`))).to.equal(true);
      }
    });

    it('passes resolution options through to the resolver', async () => {
      // An EXTERNAL DID cannot be resolved without its genesis document, and with
      // no CAS driver the only channel is options.sidecar.genesisDocument. Without
      // it resolution fails before touching the chain; with it the DID resolves,
      // so the options demonstrably reached the resolver.
      const { executor, urls } = emptyChainExecutor();
      const methodApi = new DidMethodApi(new BitcoinApi({ network: 'regtest', executor }));
      const did = methodApi.createExternal(canonicalHashBytes(EXTERNAL_GENESIS_DOCUMENT), { network: 'regtest' });

      await expect(methodApi.resolve(did)).to.be.rejectedWith('no CAS driver configured');
      expect(urls).to.have.length(0);

      const result = await methodApi.resolve(did, { sidecar: { genesisDocument: EXTERNAL_GENESIS_DOCUMENT } });
      expect(result.didDocument?.id).to.equal(did);
      expect(result.didDocumentMetadata).to.include({ versionId: '1', deactivated: false });
      expect(urls.some(url => url.endsWith('/address/12QG2GG9TWPD16SWyfWCsW4W3NhMFnnSFK/txs'))).to.equal(true);
    });

    it('rejects empty DID string', async () => {
      const methodApi = new DidMethodApi();
      await expect(methodApi.resolve('')).to.be.rejectedWith(
        'did must be a non-empty string'
      );
    });

    it('wraps upstream errors with cause', async () => {
      const btc = new BitcoinApi({ network: 'regtest' });
      const methodApi = new DidMethodApi(btc);
      const kp = SchnorrKeyPair.generate();
      const did = methodApi.createDeterministic(kp.publicKey.compressed, { network: 'regtest' });
      try {
        await methodApi.resolve(did);
        expect.fail('should have thrown');
      } catch (e: any) {
        expect(e.message).to.include('Failed to resolve DID');
        expect(e.cause).to.exist;
      }
    });

    it('inlines the root cause message in the failure message', async () => {
      // No Bitcoin connection: a KEY DID reaches NeedBeaconSignals offline and
      // the guard throws. The wrapper must carry that reason in its own
      // message, not only two cause hops down.
      const methodApi = new DidMethodApi();
      const kp = SchnorrKeyPair.generate();
      const did = methodApi.createDeterministic(kp.publicKey.compressed, { network: 'regtest' });
      try {
        await methodApi.resolve(did);
        expect.fail('should have thrown');
      } catch (e: any) {
        expect(e.message).to.include(`Failed to resolve DID ${did}: `);
        expect(e.message).to.include('Bitcoin connection required to fetch beacon signals');
        expect(e.cause).to.exist;
      }
    });

    it('refuses a DID whose network differs from the connection before any chain read', async () => {
      // testnet4 and mutinynet share one address encoding, so without the check
      // the resolver reads empty listings on the wrong chain and returns
      // version 1 as if no update ever happened.
      const { executor, urls } = emptyChainExecutor();
      const methodApi = new DidMethodApi(new BitcoinApi({ network: 'mutinynet', executor }));
      const kp = SchnorrKeyPair.generate();
      const did = methodApi.createDeterministic(kp.publicKey.compressed, { network: 'testnet4' });

      try {
        await methodApi.resolve(did);
        expect.fail('should have thrown');
      } catch (e: any) {
        expect(e.message).to.include(`Failed to resolve DID ${did}: `);
        expect(e.message).to.include('names the network "testnet4", but the Bitcoin connection targets "mutinynet"');
        expect(e.cause).to.be.instanceOf(ResolveError);
        expect(e.cause.data).to.deep.equal({ did, didNetwork: 'testnet4', connectionNetwork: 'mutinynet' });
      }
      expect(urls).to.have.length(0);
    });

    it('does not apply the network check without a Bitcoin connection', async () => {
      // No connection means nothing to compare: the DID still fails, but on the
      // missing connection, not on its network.
      const methodApi = new DidMethodApi();
      const kp = SchnorrKeyPair.generate();
      const did = methodApi.createDeterministic(kp.publicKey.compressed, { network: 'testnet4' });

      try {
        await methodApi.resolve(did);
        expect.fail('should have thrown');
      } catch (e: any) {
        expect(e.message).to.include('Bitcoin connection required to fetch beacon signals');
        expect(e.message).to.not.include('names the network');
      }
    });
  });

  describe('update()', () => {
    const stubSigner = new LocalSigner(SchnorrKeyPair.generate().secretKey.bytes);

    it('injects bitcoin connection from constructor', async () => {
      const btc = new BitcoinApi({ network: 'regtest' });
      const methodApi = new DidMethodApi(btc);
      await expect(
        methodApi.update({
          sourceDocument       : { id: 'did:btcr2:test', verificationMethod: [], service: [] } as any,
          patches              : [],
          sourceVersionId      : 1,
          verificationMethodId : '#initialKey',
          beaconId             : '#beacon-0',
          signer               : stubSigner,
        })
      ).to.be.rejected;
    });

    it('uses explicit bitcoin param over constructor', async () => {
      const btc = new BitcoinApi({ network: 'regtest' });
      const methodApi = new DidMethodApi();
      await expect(
        methodApi.update({
          sourceDocument       : { id: 'did:btcr2:test', verificationMethod: [], service: [] } as any,
          patches              : [],
          sourceVersionId      : 1,
          verificationMethodId : '#initialKey',
          beaconId             : '#beacon-0',
          signer               : stubSigner,
          bitcoin              : btc.connection,
        })
      ).to.be.rejected;
    });

    it('refuses a deactivated document before touching any connection', async () => {
      // No connection anywhere: a "Bitcoin connection required" rejection
      // would mean the deactivated document got past the guard.
      const methodApi = new DidMethodApi();
      await expect(
        methodApi.update({
          patches              : [{ op: 'add', path: '/test', value: 'x' }],
          sourceVersionId      : 2,
          verificationMethodId : '#initialKey',
          beaconId             : '#beacon-0',
          signer               : stubSigner,
          sourceDocument       : {
            id                 : 'did:btcr2:test',
            deactivated        : true,
            verificationMethod : [],
            service            : [],
          } as any,
        })
      ).to.be.rejectedWith(UpdateError, 'is deactivated and cannot be updated');
    });

    it('refuses a DID whose network differs from the connection before it reads the beacon address', async () => {
      // A regression would reach the funding lookup and fail as "unfunded",
      // which is exactly the misleading outcome the refusal prevents.
      const events: string[] = [];
      const connection = {
        name : 'mutinynet',
        rest : { address: { getUtxos: async () => { events.push('utxos'); return []; } } },
      } as unknown as BitcoinConnection;
      const methodApi = new DidMethodApi();
      const kp = SchnorrKeyPair.generate();
      const did = methodApi.createDeterministic(kp.publicKey.compressed, { network: 'testnet4' });

      try {
        await methodApi.update({
          sourceDocument       : methodApi.getInitialDocument(did),
          patches              : [],
          sourceVersionId      : 1,
          verificationMethodId : `${did}#initialKey`,
          beaconId             : `${did}#initialP2WPKH`,
          signer               : new LocalSigner(kp.secretKey.bytes),
          bitcoin              : connection,
        });
        expect.fail('should have thrown');
      } catch (e: any) {
        expect(e).to.be.instanceOf(UpdateError);
        expect(e.type).to.equal(INVALID_DID_UPDATE);
        expect(e.message).to.include(`DID ${did} names the network "testnet4", but the Bitcoin connection targets "mutinynet"`);
        expect(e.data).to.deep.equal({ did, didNetwork: 'testnet4', connectionNetwork: 'mutinynet' });
      }
      expect(events).to.deep.equal([]);
    });

    it('leaves a source document id that does not decode to the update path', async () => {
      // A malformed id is reported by the update path itself. The network check
      // stays silent instead of adding a second, misleading refusal.
      const methodApi = new DidMethodApi(new BitcoinApi({ network: 'regtest' }));

      try {
        await methodApi.update({
          sourceDocument       : { id: 'did:btcr2:test', verificationMethod: [], service: [] } as any,
          patches              : [],
          sourceVersionId      : 1,
          verificationMethodId : '#initialKey',
          beaconId             : '#beacon-0',
          signer               : stubSigner,
        });
        expect.fail('should have thrown');
      } catch (e: any) {
        expect(e.message).to.not.include('names the network');
      }
    });

    it('refuses to derive a verification method for a key the document does not list', async () => {
      // The Updater accepts only the method that publishes the signer's key.
      // With a foreign signer, no method matches. The api refuses at once and
      // names the cause. It does not let the Updater report a key mismatch later.
      const events: string[] = [];
      const connection = {
        name : 'regtest',
        rest : { address: { getUtxos: async (address: string) => { events.push(address); return []; } } },
      } as unknown as BitcoinConnection;
      const methodApi = new DidMethodApi();
      const kp = SchnorrKeyPair.generate();
      const did = methodApi.createDeterministic(kp.publicKey.compressed, { network: 'regtest' });
      const foreign = new LocalSigner(SchnorrKeyPair.generate().secretKey.bytes);

      const err: unknown = await methodApi.update({
        sourceDocument  : methodApi.getInitialDocument(did),
        patches         : [],
        sourceVersionId : 1,
        beaconId        : `${did}#initialP2WPKH`,
        signer          : foreign,
        bitcoin         : connection,
      }).catch((e: unknown) => e);

      expect(err).to.be.instanceOf(UpdateError);
      expect((err as UpdateError).message).to.include('cannot derive verificationMethodId');
      expect((err as UpdateError).type).to.equal(INVALID_DID_UPDATE);
      expect((err as UpdateError).data).to.deep.equal({
        did,
        signerKey : new CompressedSecp256k1PublicKey(foreign.publicKey).multibase.encoded,
      });
      expect(events, 'no chain read before the refusal').to.deep.equal([]);
    });

    it('refuses to derive if several verification methods publish the signer\'s key', async () => {
      const events: string[] = [];
      const connection = {
        name : 'regtest',
        rest : { address: { getUtxos: async (address: string) => { events.push(address); return []; } } },
      } as unknown as BitcoinConnection;
      const methodApi = new DidMethodApi();
      const kp = SchnorrKeyPair.generate();
      const did = methodApi.createDeterministic(kp.publicKey.compressed, { network: 'regtest' });
      const document = methodApi.getInitialDocument(did);
      const initialKey = document.verificationMethod[0]!;
      document.verificationMethod = [initialKey, { ...initialKey, id: `${did}#second` }];

      const err: unknown = await methodApi.update({
        sourceDocument  : document,
        patches         : [],
        sourceVersionId : 1,
        beaconId        : `${did}#initialP2WPKH`,
        signer          : new LocalSigner(kp.secretKey.bytes),
        bitcoin         : connection,
      }).catch((e: unknown) => e);

      expect(err).to.be.instanceOf(UpdateError);
      expect((err as UpdateError).message).to.include('Pass verificationMethodId to choose one');
      expect((err as UpdateError).data).to.deep.equal({
        did,
        signerKey             : new CompressedSecp256k1PublicKey(kp.publicKey.compressed).multibase.encoded,
        verificationMethodIds : [`${did}#initialKey`, `${did}#second`],
      });
      expect(events).to.deep.equal([]);
    });

    it('runs the network check before it derives an omitted beaconId', async () => {
      // The beacon derivation reads every beacon address. Through a connection
      // on another chain, those reads return nothing. The derivation then
      // refuses with "no beacon funded". That is the misleading outcome that
      // the network refusal prevents. So the network refusal must come first.
      const events: string[] = [];
      const connection = {
        name : 'mutinynet',
        rest : { address: { getUtxos: async (address: string) => { events.push(address); return []; } } },
      } as unknown as BitcoinConnection;
      const methodApi = new DidMethodApi();
      const kp = SchnorrKeyPair.generate();
      const did = methodApi.createDeterministic(kp.publicKey.compressed, { network: 'testnet4' });

      await expect(methodApi.update({
        sourceDocument  : methodApi.getInitialDocument(did),
        patches         : [],
        sourceVersionId : 1,
        signer          : new LocalSigner(kp.secretKey.bytes),
        bitcoin         : connection,
      })).to.be.rejectedWith(UpdateError, 'names the network "testnet4"');
      expect(events).to.deep.equal([]);
    });
  });

  describe('getSigningMethod()', () => {
    it('returns verification method from a DID document', () => {
      const kp = SchnorrKeyPair.generate();
      const mkApi = new MultikeyApi();
      const mk = mkApi.create('#initialKey', 'did:btcr2:test', kp);
      const vm = mkApi.toVerificationMethod(mk);
      const doc = {
        id                     : 'did:btcr2:test',
        verificationMethod     : [vm],
        assertionMethod        : ['#initialKey'],
        capabilityInvocation   : ['#initialKey'],
        service                : [],
      } as any;
      const methodApi = new DidMethodApi();
      const result = methodApi.getSigningMethod(doc, '#initialKey');
      expect(result).to.exist;
      expect(result.id).to.include('initialKey');
    });
  });

  describe('buildUpdate()', () => {
    it('returns an UpdateBuilder', () => {
      const methodApi = new DidMethodApi();
      const doc = { id: 'did:btcr2:test', verificationMethod: [], service: [] } as any;
      const builder = methodApi.buildUpdate(doc);
      expect(builder).to.be.instanceOf(UpdateBuilder);
    });

    it('builder validates required fields before execute', async () => {
      const methodApi = new DidMethodApi();
      const doc = { id: 'did:btcr2:test', verificationMethod: [], service: [] } as any;

      // Missing version
      await expect(
        methodApi.buildUpdate(doc)
          .verificationMethodId('#key')
          .beacon('#beacon')
          .execute()
      ).to.be.rejectedWith('sourceVersionId is required');

      // Missing verificationMethodId
      await expect(
        methodApi.buildUpdate(doc)
          .version(1)
          .beacon('#beacon')
          .execute()
      ).to.be.rejectedWith('verificationMethodId is required');

      // Missing beacon
      await expect(
        methodApi.buildUpdate(doc)
          .version(1)
          .verificationMethodId('#key')
          .execute()
      ).to.be.rejectedWith('beaconId is required');

      // Missing signer
      await expect(
        methodApi.buildUpdate(doc)
          .version(1)
          .verificationMethodId('#key')
          .beacon('#beacon')
          .execute()
      ).to.be.rejectedWith('signer is required');
    });

    it('builder chains fluently and calls update', async () => {
      const btc = new BitcoinApi({ network: 'regtest' });
      const methodApi = new DidMethodApi(btc);
      const doc = { id: 'did:btcr2:test', verificationMethod: [], service: [] } as any;

      // Will fail at the method layer (no real keys) but proves wiring works
      await expect(
        methodApi.buildUpdate(doc)
          .patch({ op: 'add', path: '/test', value: 'x' })
          .version(1)
          .verificationMethodId('#initialKey')
          .beacon('#beacon-0')
          .signer(new LocalSigner(new Uint8Array(32).fill(0x01)))
          .execute()
      ).to.be.rejected;
    });

    it('builder patches() replaces previously added patches', async () => {
      const btc = new BitcoinApi({ network: 'regtest' });
      const methodApi = new DidMethodApi(btc);
      const doc = { id: 'did:btcr2:test', verificationMethod: [], service: [] } as any;

      await expect(
        methodApi.buildUpdate(doc)
          .patch({ op: 'add', path: '/a', value: 1 })
          .patches([{ op: 'add', path: '/b', value: 2 }])
          .version(1)
          .verificationMethodId('#key')
          .beacon('#beacon')
          .signer(new LocalSigner(new Uint8Array(32).fill(0x01)))
          .execute()
      ).to.be.rejected;
    });

    it('builder supports signer and bitcoin', async () => {
      const btc = new BitcoinApi({ network: 'regtest' });
      const methodApi = new DidMethodApi();
      const doc = { id: 'did:btcr2:test', verificationMethod: [], service: [] } as any;

      await expect(
        methodApi.buildUpdate(doc)
          .patch({ op: 'add', path: '/a', value: 1 })
          .version(1)
          .verificationMethodId('#key')
          .beacon('#beacon')
          .signer(new LocalSigner(new Uint8Array(32).fill(0x01)))
          .bitcoin(btc.connection)
          .execute()
      ).to.be.rejected;
    });

    it('builder refuses a deactivated document', async () => {
      const methodApi = new DidMethodApi();
      const doc = {
        id                 : 'did:btcr2:test',
        deactivated        : true,
        verificationMethod : [],
        service            : [],
      } as any;

      await expect(
        methodApi.buildUpdate(doc)
          .patch({ op: 'add', path: '/test', value: 'x' })
          .version(2)
          .verificationMethodId('#initialKey')
          .beacon('#beacon-0')
          .signer(new LocalSigner(new Uint8Array(32).fill(0x01)))
          .execute()
      ).to.be.rejectedWith(UpdateError, 'is deactivated and cannot be updated');
    });
  });

  describe('deactivate()', () => {
    const stubSigner = new LocalSigner(SchnorrKeyPair.generate().secretKey.bytes);

    it('exposes the deactivation patch as a frozen static', () => {
      expect(DidMethodApi.DEACTIVATION_PATCH).to.deep.equal({
        op    : 'add',
        path  : '/deactivated',
        value : true,
      });
      expect(Object.isFrozen(DidMethodApi.DEACTIVATION_PATCH)).to.equal(true);
    });

    it('refuses an already-deactivated document', async () => {
      const methodApi = new DidMethodApi();
      const doc = {
        id                 : 'did:btcr2:test',
        deactivated        : true,
        verificationMethod : [],
        service            : [],
      } as any;
      await expect(
        methodApi.deactivate({
          sourceDocument       : doc,
          sourceVersionId      : 2,
          verificationMethodId : '#initialKey',
          beaconId             : '#beacon-0',
          signer               : stubSigner,
        })
      ).to.be.rejectedWith('already deactivated');
    });

    it('delegates to update() with the deactivation patch', async () => {
      const methodApi = new DidMethodApi();
      let captured: any;
      (methodApi as any).update = async (params: any) => {
        captured = params;
        throw new Error('stop-after-capture');
      };
      const doc = { id: 'did:btcr2:test', verificationMethod: [], service: [] } as any;
      await expect(
        methodApi.deactivate({
          sourceDocument       : doc,
          sourceVersionId      : 1,
          verificationMethodId : '#initialKey',
          beaconId             : '#beacon-0',
          signer               : stubSigner,
        })
      ).to.be.rejectedWith('stop-after-capture');
      expect(captured.patches).to.deep.equal([DidMethodApi.DEACTIVATION_PATCH]);
      expect(captured.sourceDocument).to.equal(doc);
      expect(captured.sourceVersionId).to.equal(1);
    });

    it('passes omitted ids through to update() for derivation', async () => {
      const methodApi = new DidMethodApi();
      let captured: any;
      (methodApi as any).update = async (params: any) => {
        captured = params;
        throw new Error('stop-after-capture');
      };
      const doc = { id: 'did:btcr2:test', verificationMethod: [], service: [] } as any;
      await expect(
        methodApi.deactivate({ sourceDocument: doc, sourceVersionId: 1, signer: stubSigner })
      ).to.be.rejectedWith('stop-after-capture');
      expect(captured.verificationMethodId).to.equal(undefined);
      expect(captured.beaconId).to.equal(undefined);
    });
  });
});

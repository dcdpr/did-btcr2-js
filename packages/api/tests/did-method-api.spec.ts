import { expect, use } from 'chai';
import chaiAsPromised from 'chai-as-promised';
import type { BitcoinConnection, HttpExecutor } from '@did-btcr2/bitcoin';
import { getNetwork } from '@did-btcr2/bitcoin';
import {
  canonicalHash,
  canonicalHashBytes,
  canonicalize,
  DidDocumentError,
  IdentifierError,
  INVALID_DID,
  INVALID_DID_DOCUMENT,
  INVALID_DID_UPDATE,
  METHOD_NOT_SUPPORTED,
  MISSING_UPDATE_DATA,
  NOT_FOUND,
  ResolveError,
  UpdateError,
} from '@did-btcr2/std';
import { SchnorrMultikey } from '@did-btcr2/integrity';
import { CompressedSecp256k1PublicKey, LocalSigner, SchnorrKeyPair } from '@did-btcr2/keys';
import { BTCR2_UPDATE_CONTEXT, DEACTIVATION_PATCH, deriveSingletonAddress } from '@did-btcr2/method';
import {
  BitcoinApi,
  CasApi,
  DidApi,
  DidMethodApi,
  MultikeyApi,
} from '../src/index.js';
import type { CasExecutor, PatchOperation } from '../src/index.js';
import { resolutionErrorCode } from '../src/helpers.js';

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

/** The refusal of the derivation if no method that can sign publishes the signer's key. */
function noSigningMethodMessage(did: string): string {
  return `No capabilityInvocation method that can sign an update of DID ${did} publishes the signer's key. `
    + 'The api cannot derive verificationMethodId. Sign with the key of such a method. '
    + 'As an alternative, pass verificationMethodId.';
}

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
 * An {@link HttpExecutor} that records each request as `<method> <url>`. A request for the
 * UTXO list of an address gets `utxos`. Each other request gets an empty list.
 */
function recordingExecutor(utxos: object[] = []): { executor: HttpExecutor; requests: string[] } {
  const requests: string[] = [];
  const executor: HttpExecutor = async (req) => {
    requests.push(`${req.method} ${req.url}`);
    const body = JSON.stringify(req.url.endsWith('/utxo') ? utxos : []);
    return new Response(body, { status: 200, headers: { 'Content-Type': 'application/json' } });
  };
  return { executor, requests };
}

/** The regtest address of a compressed public key for a script kind. The default kind is P2WPKH. */
function regtestAddress(publicKey: Uint8Array, kind: 'p2pkh' | 'p2wpkh' | 'p2tr' = 'p2wpkh'): string {
  return deriveSingletonAddress(kind, publicKey, getNetwork('regtest'));
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

    it('gives INVALID_DID for genesisBytes of a length other than 33', () => {
      const methodApi = new DidMethodApi();
      for (const length of [0, 32, 65]) {
        expect(() => methodApi.createDeterministic(new Uint8Array(length)), String(length))
          .to.throw(IdentifierError, `33-byte compressed secp256k1 public key, got ${length} bytes`)
          .with.property('type', INVALID_DID);
      }
    });

    it('gives INVALID_DID for genesisBytes that are a hex string', () => {
      const methodApi = new DidMethodApi();
      const key = SchnorrKeyPair.generate().publicKey.hex;
      expect(() => methodApi.createDeterministic(key as never))
        .to.throw(IdentifierError, 'Expected "genesisBytes" to be a Uint8Array')
        .with.property('type', INVALID_DID);
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

    it('gives INVALID_DID for empty genesisBytes', () => {
      const methodApi = new DidMethodApi();
      expect(() => methodApi.createExternal(new Uint8Array(0)))
        .to.throw(IdentifierError, '32-byte hash for EXTERNAL identifiers, got 0 bytes')
        .with.property('type', INVALID_DID);
    });

    it('gives INVALID_DID for genesisBytes that are a string', () => {
      const methodApi = new DidMethodApi();
      expect(() => methodApi.createExternal('a'.repeat(32) as never))
        .to.throw(IdentifierError, 'Expected "genesisBytes" to be a Uint8Array')
        .with.property('type', INVALID_DID);
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
      expect(doc.verificationMethod![0].id).to.equal(`${did}#key-0`);
      expect(methodApi.getBeacons(doc)).to.deep.equal([{
        id      : `${did}#service-0`,
        type    : 'SingletonBeacon',
        address : '12QG2GG9TWPD16SWyfWCsW4W3NhMFnnSFK',
      }]);
    });

    it('gives the address part of a BIP321 URI in any scheme case, with a bech32 address in lower case', () => {
      const methodApi = new DidMethodApi();
      const kp = SchnorrKeyPair.generate();
      const did = methodApi.createDeterministic(kp.publicKey.compressed, { network: 'regtest' });
      const legacy = regtestAddress(SchnorrKeyPair.generate().publicKey.compressed, 'p2pkh');
      const segwit = regtestAddress(SchnorrKeyPair.generate().publicKey.compressed, 'p2wpkh');
      const taproot = regtestAddress(SchnorrKeyPair.generate().publicKey.compressed, 'p2tr');
      const document = methodApi.getInitialDocument(did);
      document.service = [
        { id: `${did}#upper-scheme`, type: 'SingletonBeacon', serviceEndpoint: `BITCOIN:${segwit}` },
        { id: `${did}#base58`, type: 'SingletonBeacon', serviceEndpoint: `BITCOIN:${legacy}?label=x` },
        { id: `${did}#label`, type: 'CASBeacon', serviceEndpoint: `bitcoin:${taproot}?label=x` },
        { id: `${did}#upper-address`, type: 'SMTBeacon', serviceEndpoint: `bitcoin:${taproot.toUpperCase()}` },
      ];
      expect(methodApi.getBeacons(document)).to.deep.equal([
        { id: `${did}#upper-scheme`, type: 'SingletonBeacon', address: segwit },
        // A base58 address keeps its case.
        { id: `${did}#base58`, type: 'SingletonBeacon', address: legacy },
        { id: `${did}#label`, type: 'CASBeacon', address: taproot },
        { id: `${did}#upper-address`, type: 'SMTBeacon', address: taproot },
      ]);
    });

    it('gives no entry for a beacon whose URI has no address part', () => {
      const methodApi = new DidMethodApi();
      const kp = SchnorrKeyPair.generate();
      const did = methodApi.createDeterministic(kp.publicKey.compressed, { network: 'regtest' });
      const address = regtestAddress(kp.publicKey.compressed);
      const document = methodApi.getInitialDocument(did);
      document.service = [
        { id: `${did}#lightning`, type: 'SingletonBeacon', serviceEndpoint: 'bitcoin:?lightning=x' },
        { id: `${did}#funded`, type: 'SingletonBeacon', serviceEndpoint: `bitcoin:${address}` },
      ];
      expect(methodApi.getBeacons(document)).to.deep.equal([
        { id: `${did}#funded`, type: 'SingletonBeacon', address },
      ]);
    });

    it('rejects a genesis document that does not hash to the DID', () => {
      const methodApi = new DidMethodApi();
      const did = methodApi.createExternal(new Uint8Array(32).fill(0xAB), { network: 'regtest' });
      expect(() => methodApi.getInitialDocument(did, { id: 'did:btcr2:_' })).to.throw(
        'Initial document mismatch'
      );
    });

    it('refuses an EXTERNAL DID whose genesis document has no "@context" (ADR 148)', () => {
      // The DID encodes the hash of the document, so the hash check passes. The resolver
      // adds no "@context", so the result is not a conformant DID document.
      const genesis: Record<string, unknown> = JSON.parse(JSON.stringify(EXTERNAL_GENESIS_DOCUMENT));
      delete genesis['@context'];
      const methodApi = new DidMethodApi();
      const did = methodApi.createExternal(canonicalHashBytes(genesis), { network: 'regtest' });
      expect(() => methodApi.getInitialDocument(did, genesis))
        .to.throw(DidDocumentError, 'Invalid "@context"')
        .with.property('type', INVALID_DID_DOCUMENT);
    });

    it('gives INVALID_DID for an empty DID string and a value that is not a string', () => {
      expect(() => new DidMethodApi().getInitialDocument(''))
        .to.throw(IdentifierError, 'Invalid did: ').with.property('type', INVALID_DID);
      expect(() => new DidMethodApi().getInitialDocument(42 as unknown as string))
        .to.throw(IdentifierError, 'Invalid did: expected a string.').with.property('type', INVALID_DID);
    });

    it('gives METHOD_NOT_SUPPORTED for a DID of another method', () => {
      expect(() => new DidMethodApi().getInitialDocument('did:example:a:b'))
        .to.throw(IdentifierError).with.property('type', METHOD_NOT_SUPPORTED);
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
      // The specification requires confirmations and deactivated; a never-updated DID
      // reports confirmations 0. A bare DID document has the media type application/did.
      expect(result.didDocumentMetadata).to.deep.equal({ versionId: '1', confirmations: 0, deactivated: false });
      expect(result.didResolutionMetadata).to.deep.equal({ contentType: 'application/did' });
      // The injected connection is the one that was read: one tip-height lookup,
      // then one confirmed history listing per beacon of the initial document. The
      // first page is empty, so each walk ends there.
      expect(urls[0]).to.match(/\/blocks\/tip\/height$/);
      const listed = urls.slice(1);
      expect(listed).to.have.length(beacons.length);
      for (const beacon of beacons) {
        expect(listed.some(url => url.endsWith(`/address/${beacon.address}/txs/chain?max_txs=25`))).to.equal(true);
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
      expect(urls.some(url => url.endsWith('/address/12QG2GG9TWPD16SWyfWCsW4W3NhMFnnSFK/txs/chain?max_txs=25'))).to.equal(true);
    });

    it('rejects the empty DID string with an INVALID_DID cause', async () => {
      const methodApi = new DidMethodApi();
      const error = await methodApi.resolve('').then(() => undefined, (e: unknown) => e);
      expect(error).to.be.instanceOf(Error);
      expect((error as Error).message).to.equal('Failed to resolve DID : Invalid did: ');
      expect(resolutionErrorCode(error)).to.equal(INVALID_DID);
    });

    it('rejects a DID that is not a string with an INVALID_DID cause', async () => {
      const methodApi = new DidMethodApi();
      const error = await methodApi.resolve(Object.create(null)).then(() => undefined, (e: unknown) => e);
      expect((error as Error).message).to.equal('Failed to resolve DID: Invalid did: expected a string.');
      expect(resolutionErrorCode(error)).to.equal(INVALID_DID);
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

    /** A CAS executor whose retrieve returns the given bytes for every hash. */
    function casReturning(bytes: Uint8Array | null): CasApi {
      const executor: CasExecutor = {
        retrieve : async () => bytes,
        publish  : async () => '',
      };
      return new CasApi({ executor });
    }

    /** The typed failure inside the plain wrapper that resolve() rejects with. */
    async function typedCause(promise: Promise<unknown>): Promise<ResolveError> {
      try {
        await promise;
      } catch (e: any) {
        expect(e.message).to.include('Failed to resolve DID');
        expect(e.cause).to.be.instanceOf(ResolveError);
        return e.cause as ResolveError;
      }
      throw new Error('resolution should have failed');
    }

    /**
     * A Bitcoin facade whose chain holds one confirmed signal from `address`, by
     * default the beacon of EXTERNAL_GENESIS_DOCUMENT: an OP_RETURN with
     * `updateHashHex` at height 100, six blocks below the tip.
     */
    function chainWithSignal(updateHashHex: string, address = '12QG2GG9TWPD16SWyfWCsW4W3NhMFnnSFK'): BitcoinApi {
      const signalTx = {
        vin : [{
          txid        : 'f'.repeat(64),
          vout        : 0,
          prevout     : { scriptpubkey_address: address },
          is_coinbase : false,
        }],
        vout : [{
          scriptpubkey     : `6a20${updateHashHex}`,
          scriptpubkey_asm : `OP_RETURN OP_PUSHBYTES_32 ${updateHashHex}`,
        }],
        status : { confirmed: true, block_height: 100, block_hash: 'b'.repeat(64), block_time: 1700000000 },
      };
      return {
        connection : {
          data : getNetwork('regtest'),
          rest : {
            block   : { count: async () => 105, get: async () => ({ mediantime: 1700000000 }) },
            address : { getConfirmedTxs: async (queried: string) => (queried === address ? [signalTx] : []) },
          },
        } as unknown as BitcoinConnection,
      } as unknown as BitcoinApi;
    }

    it('raises NOT_FOUND when no CAS driver can return the genesis document', async () => {
      const methodApi = new DidMethodApi();
      const did = methodApi.createExternal(canonicalHashBytes(EXTERNAL_GENESIS_DOCUMENT), { network: 'regtest' });
      const cause = await typedCause(methodApi.resolve(did));
      expect(cause.type).to.equal(NOT_FOUND);
      expect(cause.message).to.include('no CAS driver configured');
    });

    it('raises NOT_FOUND when the CAS does not return the genesis document', async () => {
      const methodApi = new DidMethodApi(undefined, casReturning(null));
      const did = methodApi.createExternal(canonicalHashBytes(EXTERNAL_GENESIS_DOCUMENT), { network: 'regtest' });
      const cause = await typedCause(methodApi.resolve(did));
      expect(cause.type).to.equal(NOT_FOUND);
      expect(cause.message).to.include('not found in CAS');
    });

    it('raises NOT_FOUND when the CAS content does not hash to the genesis bytes', async () => {
      const wrongBytes = new TextEncoder().encode('{"id":"did:btcr2:_"}');
      const methodApi = new DidMethodApi(undefined, casReturning(wrongBytes));
      const did = methodApi.createExternal(canonicalHashBytes(EXTERNAL_GENESIS_DOCUMENT), { network: 'regtest' });
      const cause = await typedCause(methodApi.resolve(did));
      expect(cause.type).to.equal(NOT_FOUND);
      expect(cause.message).to.include('unusable from CAS');
      // The CAS integrity failure rides along as the cause of the NOT_FOUND.
      expect(cause.data?.cause).to.be.instanceOf(ResolveError);
      expect(cause.data?.cause?.type).to.equal(MISSING_UPDATE_DATA);
    });

    describe('a genesis document from the CAS (ADR 148)', () => {
      it('replaces the placeholder in member names and values, as the JCS steps of the specification do', async () => {
        // The specification serializes the genesis document with JCS, replaces each
        // placeholder with the DID, and parses the result. The endpoint of the second
        // service is a map, and the name of its member holds the placeholder.
        const genesis = {
          ...EXTERNAL_GENESIS_DOCUMENT,
          service : [
            ...EXTERNAL_GENESIS_DOCUMENT.service,
            {
              id              : 'did:btcr2:_#keys',
              type            : 'KeyDirectory',
              serviceEndpoint : { 'did:btcr2:_#key-0': 'https://example.com/keys/0' },
            },
          ],
        };
        const { executor, urls } = emptyChainExecutor();
        const methodApi = new DidMethodApi(
          new BitcoinApi({ network: 'regtest', executor }),
          casReturning(new TextEncoder().encode(canonicalize(genesis))),
        );
        const did = methodApi.createExternal(canonicalHashBytes(genesis), { network: 'regtest' });

        const result = await methodApi.resolve(did);

        const expected = JSON.parse(canonicalize(genesis).replaceAll('did:btcr2:_', did));
        expect(canonicalize(result.didDocument as object)).to.equal(canonicalize(expected));
        expect(result.didDocument?.service?.[1]?.serviceEndpoint).to.deep.equal({ [`${did}#key-0`]: 'https://example.com/keys/0' });
        expect(result.didDocumentMetadata).to.deep.equal({ versionId: '1', confirmations: 0, deactivated: false });
        // The resolver reads the chain for the beacon of the genesis document. The chain has no signal.
        expect(urls.some(url => url.endsWith('/address/12QG2GG9TWPD16SWyfWCsW4W3NhMFnnSFK/txs/chain?max_txs=25'))).to.equal(true);
      });

      it('raises INVALID_DID_DOCUMENT if the genesis document has no "@context"', async () => {
        const genesis: Record<string, unknown> = JSON.parse(JSON.stringify(EXTERNAL_GENESIS_DOCUMENT));
        delete genesis['@context'];
        const methodApi = new DidMethodApi(undefined, casReturning(new TextEncoder().encode(canonicalize(genesis))));
        const did = methodApi.createExternal(canonicalHashBytes(genesis), { network: 'regtest' });
        const message = `Failed to resolve DID ${did}: Invalid "@context"`;
        // rejectedWith checks only that the message includes the text. The next line checks equality.
        const error = await expect(methodApi.resolve(did)).to.be.rejectedWith(Error, message);
        expect(error.message).to.equal(message);
        expect(error.cause).to.be.instanceOf(DidDocumentError);
        expect(error.cause.type).to.equal(INVALID_DID_DOCUMENT);
      });
    });

    it('raises MISSING_UPDATE_DATA when no CAS driver can return a signed update', async () => {
      const methodApi = new DidMethodApi(chainWithSignal('ab'.repeat(32)));
      const did = methodApi.createExternal(canonicalHashBytes(EXTERNAL_GENESIS_DOCUMENT), { network: 'regtest' });
      const cause = await typedCause(methodApi.resolve(did, { sidecar: { genesisDocument: EXTERNAL_GENESIS_DOCUMENT } }));
      expect(cause.type).to.equal(MISSING_UPDATE_DATA);
      expect(cause.message).to.include('no CAS driver configured');
    });

    it('raises MISSING_UPDATE_DATA when the CAS does not return a signed update', async () => {
      const methodApi = new DidMethodApi(chainWithSignal('ab'.repeat(32)), casReturning(null));
      const did = methodApi.createExternal(canonicalHashBytes(EXTERNAL_GENESIS_DOCUMENT), { network: 'regtest' });
      const cause = await typedCause(methodApi.resolve(did, { sidecar: { genesisDocument: EXTERNAL_GENESIS_DOCUMENT } }));
      expect(cause.type).to.equal(MISSING_UPDATE_DATA);
      expect(cause.message).to.include('Signed update not found in CAS');
    });

    it('refuses CAS content that does not hash to the announced update hash', async () => {
      const wrongBytes = new TextEncoder().encode('{"patch":[]}');
      const methodApi = new DidMethodApi(chainWithSignal('ab'.repeat(32)), casReturning(wrongBytes));
      const did = methodApi.createExternal(canonicalHashBytes(EXTERNAL_GENESIS_DOCUMENT), { network: 'regtest' });
      const cause = await typedCause(methodApi.resolve(did, { sidecar: { genesisDocument: EXTERNAL_GENESIS_DOCUMENT } }));
      expect(cause.type).to.equal(MISSING_UPDATE_DATA);
      expect(cause.message).to.match(/hashes to .*; the resolver must not use it/);
    });

    it('raises INVALID_DID_UPDATE for a signed update that sets the id to an object with no text form (ADR 156)', async () => {
      // Spec "Apply update": the patched document keeps the DID as its id. String() throws for
      // this JSON value. The message names no id, and the DID Resolution error code is
      // INVALID_DID_UPDATE, not INTERNAL_ERROR.
      const offline = new DidMethodApi();
      const kp = SchnorrKeyPair.generate();
      const did = offline.createDeterministic(kp.publicKey.compressed, { network: 'regtest' });
      const source = offline.getInitialDocument(did);
      const patch: PatchOperation[] = [{ op: 'replace', path: '/id', value: JSON.parse('{"toString":1,"valueOf":1}') }];
      const unsigned = {
        '@context'      : [ ...BTCR2_UPDATE_CONTEXT ],
        patch,
        sourceHash      : offline.hashDocument(source),
        targetHash      : offline.hashDocument(offline.applyPatch(source, patch)),
        targetVersionId : 2,
      };
      // Updater.sign refuses the patch, so the cryptosuite signs the update directly.
      const methodId = `${did}#initialKey`;
      const signed = SchnorrMultikey.fromSecretKey(methodId, did, kp.secretKey.bytes)
        .toCryptosuite().toDataIntegrityProof().addProof(unsigned, {
          '@context'         : [ ...BTCR2_UPDATE_CONTEXT ],
          type               : 'DataIntegrityProof',
          cryptosuite        : 'bip340-jcs-2025',
          verificationMethod : methodId,
          proofPurpose       : 'capabilityInvocation',
          capability         : `urn:zcap:root:${encodeURIComponent(did)}`,
          capabilityAction   : 'Write',
          invocationTarget   : did,
        } as never);
      const address = offline.getBeacons(source)[0]!.address;
      const methodApi = new DidMethodApi(chainWithSignal(canonicalHash(signed, { encoding: 'hex' }), address));

      const error: any = await methodApi.resolve(did, { sidecar: { updates: [ signed as never ] } })
        .then(() => expect.fail('resolution should have failed'), (e: unknown) => e);
      expect(error.cause).to.be.instanceOf(ResolveError);
      expect(error.cause.type).to.equal(INVALID_DID_UPDATE);
      expect(error.cause.message).to.equal(`Invalid update: the patched document id is not the DID (expected "${did}")`);
      expect(resolutionErrorCode(error)).to.equal(INVALID_DID_UPDATE);
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
        methodApi.update(
          { document: { id: 'did:btcr2:test', verificationMethod: [], service: [] } as any, versionId: 1 },
          [],
          stubSigner,
          { verificationMethodId: '#initialKey', announce: { beaconId: '#beacon-0' } },
        )
      ).to.be.rejected;
    });

    it('uses announce.bitcoin over the constructor connection', async () => {
      const btc = new BitcoinApi({ network: 'regtest' });
      const methodApi = new DidMethodApi();
      await expect(
        methodApi.update(
          { document: { id: 'did:btcr2:test', verificationMethod: [], service: [] } as any, versionId: 1 },
          [],
          stubSigner,
          {
            verificationMethodId : '#initialKey',
            announce             : { beaconId: '#beacon-0', bitcoin: btc.connection },
          },
        )
      ).to.be.rejected;
    });

    it('refuses a deactivated document before touching any connection', async () => {
      // No connection anywhere: a "Bitcoin connection required" rejection
      // would mean the deactivated document got past the guard.
      const methodApi = new DidMethodApi();
      await expect(
        methodApi.update(
          {
            document : {
              id                 : 'did:btcr2:test',
              deactivated        : true,
              verificationMethod : [],
              service            : [],
            } as any,
            versionId : 2,
          },
          [{ op: 'add', path: '/test', value: 'x' }],
          stubSigner,
          { verificationMethodId: '#initialKey', announce: { beaconId: '#beacon-0' } },
        )
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
        await methodApi.update(
          { document: methodApi.getInitialDocument(did), versionId: 1 },
          [],
          new LocalSigner(kp.secretKey.bytes),
          {
            verificationMethodId : `${did}#initialKey`,
            announce             : { beaconId: `${did}#initialP2WPKH`, bitcoin: connection },
          },
        );
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
        await methodApi.update(
          { document: { id: 'did:btcr2:test', verificationMethod: [], service: [] } as any, versionId: 1 },
          [],
          stubSigner,
          { verificationMethodId: '#initialKey', announce: { beaconId: '#beacon-0' } },
        );
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

      const err: unknown = await methodApi.update(
        { document: methodApi.getInitialDocument(did), versionId: 1 },
        [],
        foreign,
        { announce: { beaconId: `${did}#initialP2WPKH`, bitcoin: connection } },
      ).catch((e: unknown) => e);

      expect(err).to.be.instanceOf(UpdateError);
      expect((err as UpdateError).message).to.equal(noSigningMethodMessage(did));
      expect((err as UpdateError).type).to.equal(INVALID_DID_UPDATE);
      expect((err as UpdateError).data).to.deep.equal({
        did,
        signerKey : new CompressedSecp256k1PublicKey(foreign.publicKey).multibase.encoded,
      });
      expect(events, 'no chain read before the refusal').to.deep.equal([]);
    });

    it('does not derive a method that capabilityInvocation does not name, also if it has the signer\'s key', async () => {
      // Only authentication names #key-1. The Updater refuses it, so the derivation does not
      // choose it, and the error names the cause before any chain read.
      const events: string[] = [];
      const connection = {
        name : 'regtest',
        rest : { address: { getUtxos: async (address: string) => { events.push(address); return []; } } },
      } as unknown as BitcoinConnection;
      const methodApi = new DidMethodApi();
      const kp = SchnorrKeyPair.generate();
      const did = methodApi.createDeterministic(kp.publicKey.compressed, { network: 'regtest' });
      const document = methodApi.getInitialDocument(did);
      const authKey = SchnorrKeyPair.generate();
      const signerKey = new CompressedSecp256k1PublicKey(authKey.publicKey.compressed).multibase.encoded;
      document.verificationMethod!.push({ ...document.verificationMethod![0]!, id: `${did}#key-1`, publicKeyMultibase: signerKey });
      document.authentication!.push(`${did}#key-1`);

      const err: unknown = await methodApi.update(
        { document, versionId: 1 },
        [],
        new LocalSigner(authKey.secretKey.bytes),
        { announce: { beaconId: `${did}#initialP2WPKH`, bitcoin: connection } },
      ).catch((e: unknown) => e);

      expect(err).to.be.instanceOf(UpdateError);
      expect((err as UpdateError).message).to.equal(noSigningMethodMessage(did));
      expect((err as UpdateError).data).to.deep.equal({ did, signerKey });
      expect(events).to.deep.equal([]);
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
      const initialKey = document.verificationMethod![0]!;
      document.verificationMethod = [initialKey, { ...initialKey, id: `${did}#second` }];
      // A relative reference and a second entry for the same method count as one method.
      document.capabilityInvocation = [`${did}#initialKey`, '#second', '#initialKey'];

      const err: unknown = await methodApi.update(
        { document, versionId: 1 },
        [],
        new LocalSigner(kp.secretKey.bytes),
        { announce: { beaconId: `${did}#initialP2WPKH`, bitcoin: connection } },
      ).catch((e: unknown) => e);

      expect(err).to.be.instanceOf(UpdateError);
      expect((err as UpdateError).message).to.equal(
        `2 capabilityInvocation methods that can sign an update of DID ${did} publish the signer's key: `
        + `${did}#initialKey, ${did}#second. Pass verificationMethodId to choose one.`
      );
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

      await expect(methodApi.update(
        { document: methodApi.getInitialDocument(did), versionId: 1 },
        [],
        new LocalSigner(kp.secretKey.bytes),
        { announce: { bitcoin: connection } },
      )).to.be.rejectedWith(UpdateError, 'names the network "testnet4"');
      expect(events).to.deep.equal([]);
    });

    it('reads the address part of a beacon URI with a query, and asks the chain for that address only', async () => {
      const { executor, requests } = recordingExecutor();
      const methodApi = new DidMethodApi(new BitcoinApi({ network: 'regtest', executor }));
      const kp = SchnorrKeyPair.generate();
      const did = methodApi.createDeterministic(kp.publicKey.compressed, { network: 'regtest' });
      const address = regtestAddress(kp.publicKey.compressed);
      const document = methodApi.getInitialDocument(did);
      const beaconId = `${did}#labeled`;
      document.service = [{ id: beaconId, type: 'SingletonBeacon', serviceEndpoint: `bitcoin:${address}?label=x` }];

      await expect(methodApi.update(
        { document, versionId: 1 },
        [],
        new LocalSigner(kp.secretKey.bytes),
        { announce: { beaconId } },
      )).to.be.rejectedWith(UpdateError, `Beacon address ${address} is unfunded.`);
      // The request has the address without the query of the URI.
      expect(requests).to.have.lengthOf(1);
      expect(requests[0]).to.match(new RegExp(`^GET \\S+/address/${address}/utxo$`));
    });

    describe('a beaconId that names a service that is not a beacon service', () => {
      const cases: Array<[string, (address: string) => { type: string; serviceEndpoint: string }]> = [
        ['a LinkedDomains service with a bitcoin: endpoint', (address) => ({ type: 'LinkedDomains', serviceEndpoint: `bitcoin:${address}` })],
        ['a SingletonBeacon whose URI has a req- query key', (address) => ({ type: 'SingletonBeacon', serviceEndpoint: `bitcoin:${address}?req-pay=1` })],
      ];

      for (const [name, service] of cases) {
        it(`refuses ${name} before it reads the chain or publishes to the CAS`, async () => {
          // The address holds a confirmed UTXO. Thus a refusal after the funding check comes
          // after the publication of the signed update to the CAS.
          const funded = [{ txid: 'a'.repeat(64), vout: 0, value: 100_000, status: { confirmed: true, block_height: 100 } }];
          const { executor, requests } = recordingExecutor(funded);
          const puts: Uint8Array[] = [];
          const casExecutor: CasExecutor = {
            retrieve : async () => null,
            publish  : async (data) => { puts.push(data); return ''; },
          };
          const methodApi = new DidMethodApi(new BitcoinApi({ network: 'regtest', executor }), new CasApi({ executor: casExecutor }));
          const kp = SchnorrKeyPair.generate();
          const did = methodApi.createDeterministic(kp.publicKey.compressed, { network: 'regtest' });
          const document = methodApi.getInitialDocument(did);
          const beaconId = `${did}#not-a-beacon`;
          document.service = [{ id: beaconId, ...service(regtestAddress(kp.publicKey.compressed)) }];

          const err: unknown = await methodApi.update(
            { document, versionId: 1 },
            [],
            new LocalSigner(kp.secretKey.bytes),
            { announce: { beaconId, publishToCas: 'always' } },
          ).catch((e: unknown) => e);

          expect(err).to.be.instanceOf(UpdateError);
          expect((err as UpdateError).type).to.equal(INVALID_DID_UPDATE);
          expect((err as UpdateError).message).to.equal(
            `The service ${beaconId} is not a beacon service: its type is not in Beacons Table 1, `
            + 'or its serviceEndpoint gives no Bitcoin address.'
          );
          expect(requests, 'no chain read before the refusal').to.deep.equal([]);
          expect(puts, 'no CAS publication before the refusal').to.deep.equal([]);
        });
      }
    });

    describe('an update that leaves no method that can sign', () => {
      /** A connection that records each UTXO read and funds no address. */
      function recordingConnection(events: string[]): BitcoinConnection {
        return {
          name : 'regtest',
          rest : { address: { getUtxos: async (address: string) => { events.push(address); return []; } } },
        } as unknown as BitcoinConnection;
      }

      it('is refused before the api reads the chain or signs', async () => {
        // The ids are omitted, and the document has three beacons, so the derivation of the
        // beacon would read three addresses. The signer records each call.
        const events: string[] = [];
        const methodApi = new DidMethodApi();
        const kp = SchnorrKeyPair.generate();
        const did = methodApi.createDeterministic(kp.publicKey.compressed, { network: 'regtest' });
        const inner = new LocalSigner(kp.secretKey.bytes);
        const signer = { publicKey: inner.publicKey, sign: (...args: Parameters<LocalSigner['sign']>) => { events.push('sign'); return inner.sign(...args); } };

        const err: unknown = await methodApi.update(
          { document: methodApi.getInitialDocument(did), versionId: 1 },
          [{ op: 'replace', path: '/verificationMethod/0/type', value: 'MultiKey' }],
          signer,
          { announce: { bitcoin: recordingConnection(events) } },
        ).catch((e: unknown) => e);

        expect(err).to.be.instanceOf(UpdateError);
        expect((err as UpdateError).message).to.equal(
          'Invalid update: after this update, the DID document has no capabilityInvocation method that can sign '
          + `an update. Nobody can update or deactivate ${did} again.`
        );
        expect((err as UpdateError).type).to.equal(INVALID_DID_UPDATE);
        expect((err as UpdateError).data).to.deep.equal({
          did,
          methods : [{
            verificationMethodId : `${did}#initialKey`,
            reason               : 'Invalid update: verificationMethod.type must equal "Multikey"',
          }],
        });
        expect(events).to.deep.equal([]);
      });

      it('goes on if the update also deactivates the DID', async () => {
        // The guard passes, so the update reaches the funding check of the beacon.
        const events: string[] = [];
        const methodApi = new DidMethodApi();
        const kp = SchnorrKeyPair.generate();
        const did = methodApi.createDeterministic(kp.publicKey.compressed, { network: 'regtest' });
        const document = methodApi.getInitialDocument(did);
        const address = methodApi.getBeacons(document).find(beacon => beacon.id === `${did}#initialP2WPKH`)!.address;

        await expect(methodApi.update(
          { document, versionId: 1 },
          [{ op: 'remove', path: '/capabilityInvocation' }, { ...DEACTIVATION_PATCH }],
          new LocalSigner(kp.secretKey.bytes),
          { announce: { beaconId: `${did}#initialP2WPKH`, bitcoin: recordingConnection(events) } },
        )).to.be.rejectedWith(UpdateError, `Beacon address ${address} is unfunded.`);
        expect(events).to.deep.equal([ address ]);
      });
    });
  });

  describe('DEACTIVATION_PATCH', () => {
    it('is the constant of the method package (ADR 112)', () => {
      expect(DidMethodApi.DEACTIVATION_PATCH).to.equal(DEACTIVATION_PATCH);
      expect(DidMethodApi.DEACTIVATION_PATCH).to.deep.equal({ op: 'add', path: '/deactivated', value: true });
    });
  });

  describe('getSigningMethod()', () => {
    /** A document with #initialKey in capabilityInvocation and #key-1 in authentication only. */
    function signingFixture() {
      const mkApi = new MultikeyApi();
      const vm = mkApi.toVerificationMethod(mkApi.create('#initialKey', 'did:btcr2:test', SchnorrKeyPair.generate()));
      const authOnly = mkApi.toVerificationMethod(mkApi.create('#key-1', 'did:btcr2:test', SchnorrKeyPair.generate()));
      const doc = {
        id                     : 'did:btcr2:test',
        verificationMethod     : [vm, authOnly],
        authentication         : ['#key-1'],
        assertionMethod        : ['#initialKey'],
        capabilityInvocation   : ['#initialKey'],
        service                : [],
      } as any;
      return { doc, vm };
    }

    it('returns the method that the id names', () => {
      const { doc, vm } = signingFixture();
      expect(new DidMethodApi().getSigningMethod(doc, 'did:btcr2:test#initialKey')).to.deep.equal(vm);
    });

    it('returns #initialKey if the caller gives no id', () => {
      const { doc, vm } = signingFixture();
      expect(new DidMethodApi().getSigningMethod(doc)).to.deep.equal(vm);
    });

    it('refuses a method that capabilityInvocation does not name', () => {
      const { doc } = signingFixture();
      expect(() => new DidMethodApi().getSigningMethod(doc, '#key-1'))
        .to.throw(UpdateError, 'Invalid verificationMethodId: not authorized for capabilityInvocation')
        .that.deep.includes({
          type : INVALID_DID_UPDATE,
          data : { verificationMethodId: 'did:btcr2:test#key-1', capabilityInvocation: ['#initialKey'] },
        });
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
        methodApi.deactivate(
          { document: doc, versionId: 2 },
          stubSigner,
          { verificationMethodId: '#initialKey', announce: { beaconId: '#beacon-0' } },
        )
      ).to.be.rejectedWith('already deactivated');
    });

    it('delegates to update() with the deactivation patch', async () => {
      const methodApi = new DidMethodApi();
      let captured: any[] = [];
      (methodApi as any).update = async (...args: any[]) => {
        captured = args;
        throw new Error('stop-after-capture');
      };
      const source = { document: { id: 'did:btcr2:test', verificationMethod: [], service: [] } as any, versionId: 1 };
      const options = { verificationMethodId: '#initialKey', announce: { beaconId: '#beacon-0' } };
      await expect(
        methodApi.deactivate(source, stubSigner, options)
      ).to.be.rejectedWith('stop-after-capture');
      expect(captured).to.deep.equal([source, [DidMethodApi.DEACTIVATION_PATCH], stubSigner, options]);
      expect(captured[0]).to.equal(source);
    });

    it('passes omitted ids through to update() for derivation', async () => {
      const methodApi = new DidMethodApi();
      let captured: any[] = [];
      (methodApi as any).update = async (...args: any[]) => {
        captured = args;
        throw new Error('stop-after-capture');
      };
      const doc = { id: 'did:btcr2:test', verificationMethod: [], service: [] } as any;
      await expect(
        methodApi.deactivate({ document: doc, versionId: 1 }, stubSigner)
      ).to.be.rejectedWith('stop-after-capture');
      expect(captured[3]).to.deep.equal({});
    });
  });
});

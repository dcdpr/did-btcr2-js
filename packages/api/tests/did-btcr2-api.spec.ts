import { expect, use } from 'chai';
import chaiAsPromised from 'chai-as-promised';
import type { HttpExecutor } from '@did-btcr2/bitcoin';
import { canonicalHashBytes, FEATURE_NOT_SUPPORTED, IdentifierError, INTERNAL_ERROR, INVALID_DID, INVALID_DID_DOCUMENT, INVALID_DID_UPDATE, INVALID_OPTIONS, MISSING_UPDATE_DATA, NOT_FOUND, ResolveError, UpdateError } from '@did-btcr2/std';
import { LocalSigner, SchnorrKeyPair } from '@did-btcr2/keys';
import {
  BitcoinApi,
  CryptoApi,
  createApi,
  DidApi,
  DidBtcr2Api,
  DidMethodApi,
  KeyManagerApi,
} from '../src/index.js';
import type { ResolutionOptions, UpdateSource } from '../src/index.js';

const stubSigner = new LocalSigner(SchnorrKeyPair.generate().secretKey.bytes);

/** A sidecar update of a DID: only the fields that the source check reads. */
function sidecarUpdate(did: string, targetVersionId: number): any {
  return { targetVersionId, proof: { invocationTarget: did } };
}

/** Replaces the resolution of the api with one that returns `versionId`. */
function stubResolution(api: DidBtcr2Api, did: string, versionId: number): void {
  (api.btcr2 as any).resolve = async () => ({
    didDocument           : { id: did, verificationMethod: [], service: [] },
    didDocumentMetadata   : { versionId: String(versionId) },
    didResolutionMetadata : {},
  });
}

use(chaiAsPromised);

/**
 * DidBtcr2Api (Main Facade) Test
 */
describe('DidBtcr2Api', () => {
  it('should expose crypto, did, and kms sub-facades', () => {
    const api = new DidBtcr2Api();
    expect(api.crypto).to.be.instanceOf(CryptoApi);
    expect(api.did).to.be.instanceOf(DidApi);
    expect(api.kms).to.be.instanceOf(KeyManagerApi);
  });

  describe('btc (lazy)', () => {
    it('should throw when no btc config provided', () => {
      const api = new DidBtcr2Api();
      expect(() => api.btc).to.throw(Error, 'Bitcoin not configured');
    });

    it('should return BitcoinApi when btc config provided', () => {
      const api = new DidBtcr2Api({ btc: { network: 'regtest' } });
      expect(api.btc).to.be.instanceOf(BitcoinApi);
    });

    it('should return the same BitcoinApi on repeated access', () => {
      const api = new DidBtcr2Api({ btc: { network: 'regtest' } });
      const btc1 = api.btc;
      const btc2 = api.btc;
      expect(btc1).to.equal(btc2);
    });
  });

  describe('btcr2 (lazy)', () => {
    it('should return DidMethodApi without btc config', () => {
      const api = new DidBtcr2Api();
      expect(api.btcr2).to.be.instanceOf(DidMethodApi);
    });

    it('should return DidMethodApi with btc config', () => {
      const api = new DidBtcr2Api({ btc: { network: 'regtest' } });
      expect(api.btcr2).to.be.instanceOf(DidMethodApi);
    });

    it('should return the same DidMethodApi on repeated access', () => {
      const api = new DidBtcr2Api({ btc: { network: 'regtest' } });
      const m1 = api.btcr2;
      const m2 = api.btcr2;
      expect(m1).to.equal(m2);
    });
  });

  describe('createDid()', () => {
    it('creates a deterministic DID', () => {
      const api = createApi();
      const { keyPair } = api.did.generate();
      const kp = api.crypto.keypair.fromJSON(keyPair);
      const did = api.createDid('deterministic', kp.publicKey.compressed);
      expect(did).to.match(/^did:btcr2:/);
      const components = api.did.decode(did);
      expect(components.idType).to.equal('KEY');
    });

    it('creates an external DID', () => {
      const api = createApi();
      const docBytes = new Uint8Array(32).fill(0xAB);
      const did = api.createDid('external', docBytes, { network: 'regtest' });
      expect(did).to.match(/^did:btcr2:/);
      const components = api.did.decode(did);
      expect(components.idType).to.equal('EXTERNAL');
    });

    it('gives INVALID_DID for deterministic genesis bytes of 32 bytes', () => {
      const api = createApi();
      expect(() => api.createDid('deterministic', new Uint8Array(32).fill(0xAB)))
        .to.throw(IdentifierError, 'got 32 bytes')
        .with.property('type', INVALID_DID);
    });
  });

  describe('generateDid()', () => {
    it('should generate a DID and import key into KMS', () => {
      const api = createApi();
      const result = api.generateDid();
      expect(result.did).to.be.a('string').and.match(/^did:btcr2:/);
      expect(result.keyId).to.be.a('string');
      expect(api.kms.listKeys()).to.include(result.keyId);
    });

    it('should set active key by default', () => {
      const api = createApi();
      const { keyId } = api.generateDid();
      expect(() => api.kms.getPublicKey()).to.not.throw();
      expect(api.kms.getPublicKey(keyId)).to.be.instanceOf(Uint8Array);
    });

    it('should respect setActive: false', () => {
      const api = createApi();
      api.generateDid({ setActive: false });
      const api2 = createApi();
      api2.generateDid({ setActive: false });
      expect(() => api2.kms.getPublicKey()).to.throw();
    });

    it('should accept a network option', () => {
      const api = createApi();
      const { did } = api.generateDid({ network: 'testnet4' });
      const components = api.did.decode(did);
      expect(components.network).to.equal('testnet4');
    });
  });

  describe('network inheritance', () => {
    it('generateDid mints on the configured network when none is named', () => {
      const api = createApi({ btc: { network: 'mutinynet' } });
      const { did } = api.generateDid();
      expect(api.did.decode(did).network).to.equal('mutinynet');
    });

    it('createDid mints on the configured network when none is named', () => {
      const api = createApi({ btc: { network: 'mutinynet' } });
      const pk = api.crypto.keypair.generate().publicKey.compressed;
      expect(api.did.decode(api.createDid('deterministic', pk)).network).to.equal('mutinynet');
      const docBytes = new Uint8Array(32).fill(0xAB);
      expect(api.did.decode(api.createDid('external', docBytes)).network).to.equal('mutinynet');
    });

    it('lets an explicit network win over the configured one', () => {
      const api = createApi({ btc: { network: 'mutinynet' } });
      expect(api.did.decode(api.generateDid({ network: 'signet' }).did).network)
        .to.equal('signet');
      const pk = api.crypto.keypair.generate().publicKey.compressed;
      expect(api.did.decode(api.createDid('deterministic', pk, { network: 'testnet4' })).network)
        .to.equal('testnet4');
    });

    it('does not force the lazy BitcoinApi into existence', () => {
      // generateDid reads the config, not the `btc` getter: an api with no
      // Bitcoin config must still generate rather than throw "not configured".
      const api = createApi();
      expect(() => api.generateDid()).to.not.throw();
      expect(api.did.decode(api.generateDid().did).network).to.equal('regtest');
    });

    it('mints every creation path on regtest with no Bitcoin connection', () => {
      // The one-table check: generateDid, deterministic createDid, and external
      // createDid agree on the offline fallback; none reaches mainnet.
      const api = createApi();
      const pk = api.crypto.keypair.fromJSON(api.did.generate().keyPair).publicKey.compressed;
      const docBytes = new Uint8Array(32).fill(0xAB);
      expect(api.did.decode(api.generateDid({ setActive: false }).did).network).to.equal('regtest');
      expect(api.did.decode(api.createDid('deterministic', pk)).network).to.equal('regtest');
      expect(api.did.decode(api.createDid('external', docBytes)).network).to.equal('regtest');
    });
  });

  describe('resolveDid()', () => {
    it('delegates to btcr2.resolve with the same arguments', async () => {
      const api = createApi({ btc: { network: 'regtest' } });
      const { did } = api.did.generate();
      const options: ResolutionOptions = { versionId: '1', minConf: 1 };
      const resolved = {
        didDocument           : { id: did },
        didDocumentMetadata   : { versionId: '1' },
        didResolutionMetadata : {},
      };
      let seen: unknown[] | undefined;
      (api.btcr2 as any).resolve = async (...args: unknown[]) => {
        seen = args;
        return resolved;
      };

      const result = await api.resolveDid(did, options);

      // Both arguments reach the sub-facade untouched and its result comes
      // back as-is: the facade adds nothing on the read path.
      expect(seen).to.deep.equal([did, options]);
      expect(seen?.[1]).to.equal(options);
      expect(result).to.equal(resolved);
    });

    it('rejects an invalid minConf with the root cause in the message, before any chain read', async () => {
      const api = createApi({ btc: { network: 'regtest' } });
      const { did } = api.did.generate();
      await expect(api.resolveDid(did, { minConf: 0 }))
        .to.be.rejectedWith(/Failed to resolve DID .*minConf.*positive integer/);
    });

    it('expands the relative ids of the document only for expandRelativeUrls true', async () => {
      // An EXTERNAL DID whose genesis document has relative ids. The sidecar gives the genesis
      // document. The chain has no beacon signal, so the result is the genesis document.
      const genesisDocument = {
        '@context'           : ['https://www.w3.org/ns/did/v1.1', 'https://btcr2.dev/context/v1'],
        'id'                 : 'did:btcr2:_',
        'verificationMethod' : [{
          id                 : '#key-0',
          type               : 'Multikey',
          controller         : 'did:btcr2:_',
          publicKeyMultibase : 'zQ3shiAVyapkPizvsLJZ8mYqPZetmbNNjgLVWTe5CLKZjvs34',
        }],
        'authentication'       : ['#key-0'],
        'assertionMethod'      : ['#key-0'],
        'capabilityInvocation' : ['#key-0'],
        'capabilityDelegation' : ['#key-0'],
        'service'              : [{
          id              : '#service-0',
          type            : 'SingletonBeacon',
          serviceEndpoint : 'bitcoin:12QG2GG9TWPD16SWyfWCsW4W3NhMFnnSFK',
        }],
      };
      const executor: HttpExecutor = async (req) => new Response(
        req.url.endsWith('/blocks/tip/height') ? '100' : '[]',
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      );
      const api = createApi({ btc: { network: 'regtest', executor } });
      const did = api.createDid('external', canonicalHashBytes(genesisDocument), { network: 'regtest' });
      const sidecar = { genesisDocument };
      const keyId = `${did}#key-0`;

      const expanded = (await api.resolveDid(did, { sidecar, expandRelativeUrls: true })).didDocument;
      expect(expanded?.verificationMethod?.[0]).to.include({ id: keyId, controller: did });
      expect(expanded?.service?.[0].id).to.equal(`${did}#service-0`);
      for (const relationship of ['authentication', 'assertionMethod', 'capabilityInvocation', 'capabilityDelegation'] as const) {
        expect(expanded?.[relationship]).to.deep.equal([keyId]);
      }

      // false and an absent option give the document with its relative ids.
      for (const options of [{ sidecar, expandRelativeUrls: false }, { sidecar }]) {
        const document = (await api.resolveDid(did, options)).didDocument;
        expect(document?.verificationMethod?.[0].id).to.equal('#key-0');
        expect(document?.authentication).to.deep.equal(['#key-0']);
        expect(document?.service?.[0].id).to.equal('#service-0');
      }
    });
  });

  describe('updateDid()', () => {
    const patch = [{ op: 'add' as const, path: '/test', value: 'x' }];
    const ids = { verificationMethodId: '#initialKey', announce: { beaconId: '#beacon-0' } };

    it('should throw when resolution fails (no btc config)', async () => {
      const api = createApi();
      const { did } = api.did.generate();
      await expect(api.updateDid(did, patch, stubSigner, ids)).to.be.rejected;
    });

    it('names the error code and the detail of a failed source resolution that returns', async () => {
      const api = createApi();
      const { did } = api.did.generate();
      const error = { type: 'https://dcdpr.github.io/did-btcr2/errors.html#late_publishing', title: 'Late publishing', detail: 'late' };
      (api.btcr2 as any).resolve = async () => ({ didResolutionMetadata: { error }, didDocument: null, didDocumentMetadata: {} });
      await expect(api.updateDid(did, patch, stubSigner, ids))
        .to.be.rejectedWith(`Failed to resolve DID ${did} for update: LATE_PUBLISHING late`);
      (api.btcr2 as any).resolve = async () => ({ didResolutionMetadata: {}, didDocument: null, didDocumentMetadata: {} });
      await expect(api.updateDid(did, patch, stubSigner, ids))
        .to.be.rejectedWith(new RegExp(`^Failed to resolve DID ${did} for update\\.$`));
    });

    it('refuses a resolved source with no versionId or a non-numeric versionId', async () => {
      const api = createApi();
      const { did } = api.did.generate();
      const resolveWith = (versionId: unknown): void => {
        (api.btcr2 as any).resolve = async () => ({
          didResolutionMetadata : {},
          didDocument           : { id: did },
          didDocumentMetadata   : versionId === undefined ? {} : { versionId },
        });
      };
      resolveWith(undefined);
      await expect(api.updateDid(did, patch, stubSigner, ids))
        .to.be.rejectedWith(`Resolution of DID ${did} succeeded but returned no versionId in metadata.`);
      resolveWith('one');
      await expect(api.updateDid(did, patch, stubSigner, ids))
        .to.be.rejectedWith(`Resolution of DID ${did} returned a non-numeric versionId: one.`);
    });

    it('rejects an empty DID string with an INVALID_DID cause', async () => {
      const api = createApi();
      const err: unknown = await api.updateDid('', patch, stubSigner, ids).catch((e: unknown) => e);
      expect((err as Error).message).to.match(/^Failed to resolve DID : /);
      expect((err as Error).cause).to.be.instanceOf(IdentifierError).with.property('type', INVALID_DID);
    });

    it('refuses a source that is neither a DID nor a state', async () => {
      const api = createApi();
      const err: unknown = await api.updateDid(null as any, patch, stubSigner, ids).catch((e: unknown) => e);
      expect(err).to.be.instanceOf(UpdateError);
      expect((err as UpdateError).message).to.include('must be a DID or a resolved state');
      expect((err as UpdateError).type).to.equal(INVALID_DID_UPDATE);
    });

    it('should skip resolution when the source is a state', async () => {
      const api = createApi();
      const source = { document: { id: 'did:btcr2:test', verificationMethod: [], service: [] } as any, versionId: 1 };
      await expect(api.updateDid(source, patch, stubSigner, ids)).to.be.rejected;
    });

    it('should throw when resolution fails', async () => {
      const api = createApi({ btc: { network: 'regtest' } });
      const { did } = api.did.generate();
      // Resolution will fail (no Bitcoin node running); the error may come
      // from the network layer or from our "Failed to resolve" guard.
      await expect(api.updateDid(did, patch, stubSigner, ids)).to.be.rejected;
    });

    it('threads resolutionOptions through to resolution (sidecar-only update #2)', async () => {
      const api = createApi();
      const { did } = api.did.generate();
      const priorUpdate = { proof: {} } as any;
      const resolutionOptions: ResolutionOptions = { sidecar: { updates: [priorUpdate] } };

      // A sidecar-only DID: resolution succeeds only when the caller's
      // sidecar rides along, exactly like update #2 under publishToCas 'never'.
      let seenOptions: ResolutionOptions | undefined;
      (api.btcr2 as any).resolve = async (_did: string, options?: ResolutionOptions) => {
        seenOptions = options;
        if (!options?.sidecar) throw new Error('signed update unreachable without sidecar');
        return {
          didDocument           : { id: did, verificationMethod: [], service: [] },
          didDocumentMetadata   : { versionId: '2' },
          didResolutionMetadata : {},
        };
      };
      let captured: any[] = [];
      (api.btcr2 as any).update = async (...args: any[]) => {
        captured = args;
        return { signedUpdate: {}, txid: 'txid', publishedToCas: [] };
      };

      await api.updateDid(did, patch, stubSigner, { ...ids, resolutionOptions });

      expect(seenOptions).to.equal(resolutionOptions);
      const [source, forwardedPatch, signer, options] = captured;
      expect(source.document.id).to.equal(did);
      expect(source.versionId).to.equal(2);
      expect(forwardedPatch).to.equal(patch);
      expect(signer).to.equal(stubSigner);
      // The facade consumes resolutionOptions. The method facade gets the rest.
      expect(options).to.deep.equal(ids);
    });

    it('ignores resolutionOptions when the source is a state', async () => {
      const api = createApi();
      let resolveCalls = 0;
      (api.btcr2 as any).resolve = async () => {
        resolveCalls++;
        throw new Error('resolution must be skipped');
      };
      let captured: any[] = [];
      (api.btcr2 as any).update = async (...args: any[]) => {
        captured = args;
        return { signedUpdate: {}, txid: 'txid', publishedToCas: [] };
      };
      const source = { document: { id: 'did:btcr2:test', verificationMethod: [], service: [] } as any, versionId: 1 };

      await api.updateDid(source, patch, stubSigner, { ...ids, resolutionOptions: { sidecar: {} } });

      expect(resolveCalls).to.equal(0);
      expect(captured[0]).to.equal(source);
    });

    it('passes omitted verificationMethodId and beaconId through for derivation', async () => {
      const api = createApi();
      const { did } = api.did.generate();
      (api.btcr2 as any).resolve = async () => ({
        didDocument           : { id: did, verificationMethod: [], service: [] },
        didDocumentMetadata   : { versionId: '1' },
        didResolutionMetadata : {},
      });
      let captured: any[] = [];
      (api.btcr2 as any).update = async (...args: any[]) => {
        captured = args;
        return { signedUpdate: {}, txid: 'txid', publishedToCas: [] };
      };

      await api.updateDid(did, [], stubSigner);

      // The facade adds nothing. The method facade derives both ids.
      expect(captured[2]).to.equal(stubSigner);
      expect(captured[3]).to.deep.equal({});
    });

    it('refuses an auto-resolved deactivated document before signing', async () => {
      const api = createApi();
      const { did } = api.did.generate();
      let resolveCalls = 0;
      (api.btcr2 as any).resolve = async () => {
        resolveCalls++;
        return {
          didDocument           : { id: did, deactivated: true, verificationMethod: [], service: [] },
          didDocumentMetadata   : { versionId: '2', deactivated: true },
          didResolutionMetadata : {},
        };
      };

      // No Bitcoin connection is configured, so a "connection required"
      // rejection would mean the resolved document reached the write path.
      await expect(api.updateDid(did, patch, stubSigner, ids))
        .to.be.rejectedWith(UpdateError, 'is deactivated and cannot be updated');
      expect(resolveCalls).to.equal(1);
    });

    it('refuses a supplied deactivated document', async () => {
      const api = createApi();
      const source = {
        document : {
          id                 : 'did:btcr2:test',
          deactivated        : true,
          verificationMethod : [],
          service            : [],
        } as any,
        versionId : 2,
      };
      await expect(api.updateDid(source, patch, stubSigner, ids))
        .to.be.rejectedWith(UpdateError, 'is deactivated and cannot be updated');
    });

    it('does not refuse a supplied document whose deactivated value is not true (ADR 142)', async () => {
      const api = createApi();
      const source = {
        document : {
          id                 : 'did:btcr2:test',
          deactivated        : 'yes',
          verificationMethod : [],
          service            : [],
        } as any,
        versionId : 2,
      };
      // No Bitcoin connection is configured: the connection check is the next refusal.
      await expect(api.updateDid(source, patch, stubSigner, ids))
        .to.be.rejectedWith(UpdateError, 'Bitcoin connection required');
    });

    describe('source check against the sidecar updates', () => {
      it('refuses a versionId less than the highest targetVersionId', async () => {
        const api = createApi();
        const { did } = api.did.generate();
        stubResolution(api, did, 2);
        let updateCalls = 0;
        (api.btcr2 as any).update = async () => {
          updateCalls++;
          return { signedUpdate: {}, txid: 'txid', publishedToCas: [] };
        };
        const resolutionOptions: ResolutionOptions = {
          sidecar : { updates: [ sidecarUpdate(did, 3), sidecarUpdate(did, 2) ] },
        };

        const err: unknown = await api.updateDid(did, patch, stubSigner, { ...ids, resolutionOptions })
          .catch((e: unknown) => e);

        expect(err).to.be.instanceOf(UpdateError);
        expect((err as UpdateError).type).to.equal(INVALID_DID_UPDATE);
        expect((err as UpdateError).message).to.include('returned versionId 2')
          .and.to.include('targetVersionId 3')
          .and.to.include('6 confirmations');
        expect((err as UpdateError).data).to.deep.equal({ did, versionId: 2, announcedVersionId: 3, minConf: 6 });
        expect(updateCalls).to.equal(0);
      });

      it('names the minConf of the resolution options', async () => {
        const api = createApi();
        const { did } = api.did.generate();
        stubResolution(api, did, 1);
        const resolutionOptions: ResolutionOptions = { minConf: 1, sidecar: { updates: [ sidecarUpdate(did, 2) ] } };

        const err: unknown = await api.updateDid(did, patch, stubSigner, { ...ids, resolutionOptions })
          .catch((e: unknown) => e);

        expect((err as UpdateError).data).to.include({ minConf: 1 });
      });

      it('accepts a versionId equal to the highest targetVersionId', async () => {
        const api = createApi();
        const { did } = api.did.generate();
        stubResolution(api, did, 3);
        let captured: any[] = [];
        (api.btcr2 as any).update = async (...args: any[]) => {
          captured = args;
          return { signedUpdate: {}, txid: 'txid', publishedToCas: [] };
        };
        const resolutionOptions: ResolutionOptions = {
          sidecar : { updates: [ sidecarUpdate(did, 2), sidecarUpdate(did, 3) ] },
        };

        await api.updateDid(did, patch, stubSigner, { ...ids, resolutionOptions });

        expect(captured[0].versionId).to.equal(3);
      });

      it('ignores a sidecar update of another DID', async () => {
        const api = createApi();
        const { did } = api.did.generate();
        const { did: otherDid } = api.did.generate();
        stubResolution(api, did, 1);
        let updateCalls = 0;
        (api.btcr2 as any).update = async () => {
          updateCalls++;
          return { signedUpdate: {}, txid: 'txid', publishedToCas: [] };
        };
        const resolutionOptions: ResolutionOptions = { sidecar: { updates: [ sidecarUpdate(otherDid, 5) ] } };

        await api.updateDid(did, patch, stubSigner, { ...ids, resolutionOptions });

        expect(updateCalls).to.equal(1);
      });

      it('checks nothing without sidecar updates', async () => {
        const api = createApi();
        const { did } = api.did.generate();
        stubResolution(api, did, 1);
        let updateCalls = 0;
        (api.btcr2 as any).update = async () => {
          updateCalls++;
          return { signedUpdate: {}, txid: 'txid', publishedToCas: [] };
        };

        await api.updateDid(did, patch, stubSigner, { ...ids, resolutionOptions: { sidecar: {} } });

        expect(updateCalls).to.equal(1);
      });

      it('skips the check for a state source', async () => {
        const api = createApi();
        const did = 'did:btcr2:test';
        let captured: any[] = [];
        (api.btcr2 as any).update = async (...args: any[]) => {
          captured = args;
          return { signedUpdate: {}, txid: 'txid', publishedToCas: [] };
        };
        const source = { document: { id: did, verificationMethod: [], service: [] } as any, versionId: 1 };
        const resolutionOptions: ResolutionOptions = { sidecar: { updates: [ sidecarUpdate(did, 3) ] } };

        await api.updateDid(source, patch, stubSigner, { ...ids, resolutionOptions });

        expect(captured[0]).to.equal(source);
      });
    });
  });

  describe('deactivateDid()', () => {
    const ids = { verificationMethodId: '#initialKey', announce: { beaconId: '#beacon-0' } };

    it('rejects an empty DID string with an INVALID_DID cause', async () => {
      const api = createApi();
      const err: unknown = await api.deactivateDid('', stubSigner, ids).catch((e: unknown) => e);
      expect((err as Error).message).to.match(/^Failed to resolve DID : /);
      expect((err as Error).cause).to.be.instanceOf(IdentifierError).with.property('type', INVALID_DID);
    });

    it('refuses an already-deactivated document', async () => {
      const api = createApi({ btc: { network: 'regtest' } });
      const source = {
        document : {
          id                 : 'did:btcr2:test',
          deactivated        : true,
          verificationMethod : [],
          service            : [],
        } as any,
        versionId : 2,
      };
      await expect(api.deactivateDid(source, stubSigner, ids)).to.be.rejectedWith('already deactivated');
    });

    it('does not refuse a document whose deactivated value is not true (ADR 142)', async () => {
      const api = createApi();
      const source = {
        document : {
          id                 : 'did:btcr2:test',
          deactivated        : 'yes',
          verificationMethod : [],
          service            : [],
        } as any,
        versionId : 2,
      };
      // No Bitcoin connection is configured: the connection check is the next refusal.
      await expect(api.deactivateDid(source, stubSigner, ids))
        .to.be.rejectedWith(UpdateError, 'Bitcoin connection required');
    });

    it('threads resolutionOptions through to resolution', async () => {
      const api = createApi();
      const { did } = api.did.generate();
      const resolutionOptions: ResolutionOptions = { sidecar: { updates: [] } };

      let seenOptions: ResolutionOptions | undefined;
      (api.btcr2 as any).resolve = async (_did: string, options?: ResolutionOptions) => {
        seenOptions = options;
        return {
          didDocument           : { id: did, verificationMethod: [], service: [] },
          didDocumentMetadata   : { versionId: '3' },
          didResolutionMetadata : {},
        };
      };
      let captured: any[] = [];
      (api.btcr2 as any).deactivate = async (...args: any[]) => {
        captured = args;
        return { signedUpdate: {}, txid: 'txid', publishedToCas: [] };
      };

      await api.deactivateDid(did, stubSigner, { ...ids, resolutionOptions });

      expect(seenOptions).to.equal(resolutionOptions);
      const [source, signer, options] = captured;
      expect(source.versionId).to.equal(3);
      expect(signer).to.equal(stubSigner);
      expect(options).to.deep.equal(ids);
    });

    it('refuses a versionId less than the highest targetVersionId of the sidecar updates', async () => {
      const api = createApi();
      const { did } = api.did.generate();
      stubResolution(api, did, 1);
      let deactivateCalls = 0;
      (api.btcr2 as any).deactivate = async () => {
        deactivateCalls++;
        return { signedUpdate: {}, txid: 'txid', publishedToCas: [] };
      };
      const resolutionOptions: ResolutionOptions = { sidecar: { updates: [ sidecarUpdate(did, 2) ] } };

      await expect(api.deactivateDid(did, stubSigner, { ...ids, resolutionOptions }))
        .to.be.rejectedWith(UpdateError, 'targetVersionId 2');
      expect(deactivateCalls).to.equal(0);
    });

    it('passes omitted verificationMethodId and beaconId through for derivation', async () => {
      const api = createApi();
      const { did } = api.did.generate();
      (api.btcr2 as any).resolve = async () => ({
        didDocument           : { id: did, verificationMethod: [], service: [] },
        didDocumentMetadata   : { versionId: '1' },
        didResolutionMetadata : {},
      });
      let captured: any[] = [];
      (api.btcr2 as any).deactivate = async (...args: any[]) => {
        captured = args;
        return { signedUpdate: {}, txid: 'txid', publishedToCas: [] };
      };

      await api.deactivateDid(did, stubSigner);

      // The facade adds nothing. The method facade derives both ids.
      expect(captured[1]).to.equal(stubSigner);
      expect(captured[2]).to.deep.equal({});
    });
  });

  describe('expandRelativeUrls in the source resolution of updateDid() and deactivateDid()', () => {
    const patch = [{ op: 'add' as const, path: '/test', value: 'x' }];
    const ids = { verificationMethodId: '#initialKey', announce: { beaconId: '#beacon-0' } };
    const refusal = 'The source resolution of an update cannot use `expandRelativeUrls: true`: the '
      + '`sourceHash` must be the hash of the document with no expansion.';

    /**
     * An api that records its Bitcoin requests, its resolve calls, and its calls of the write
     * (`btcr2.update` or `btcr2.deactivate`). The resolve and the write return stub results.
     */
    const recordingApi = (write: 'update' | 'deactivate') => {
      const urls: string[] = [];
      const resolved: unknown[][] = [];
      const written: unknown[][] = [];
      const executor: HttpExecutor = async (req) => {
        urls.push(req.url);
        return new Response('[]', { status: 200 });
      };
      const api = createApi({ btc: { network: 'regtest', executor } });
      const { did } = api.did.generate();
      (api.btcr2 as any).resolve = async (...args: unknown[]) => {
        resolved.push(args);
        return {
          didDocument           : { id: did, verificationMethod: [], service: [] },
          didDocumentMetadata   : { versionId: '1' },
          didResolutionMetadata : {},
        };
      };
      (api.btcr2 as any)[write] = async (...args: unknown[]) => {
        written.push(args);
        return { signedUpdate: {}, txid: 'txid', publishedToCas: [] };
      };
      return { api, did, urls, resolved, written };
    };

    for (const write of ['update', 'deactivate'] as const) {
      const run = (api: DidBtcr2Api, source: UpdateSource, resolutionOptions: ResolutionOptions) => write === 'update'
        ? api.updateDid(source, patch, stubSigner, { ...ids, resolutionOptions })
        : api.deactivateDid(source, stubSigner, { ...ids, resolutionOptions });

      it(`${write}Did() refuses expandRelativeUrls true for a DID source before any I/O`, async () => {
        const { api, did, urls, resolved, written } = recordingApi(write);

        const err: unknown = await run(api, did, { expandRelativeUrls: true }).catch((e: unknown) => e);

        expect(err).to.be.instanceOf(UpdateError);
        expect((err as UpdateError).type).to.equal(INVALID_OPTIONS);
        expect((err as UpdateError).message).to.equal(refusal);
        expect((err as UpdateError).data).to.deep.equal({ expandRelativeUrls: true });
        expect(resolved).to.have.length(0);
        expect(written).to.have.length(0);
        expect(urls).to.have.length(0);
      });

      it(`${write}Did() resolves a DID source with expandRelativeUrls false`, async () => {
        const { api, did, resolved, written } = recordingApi(write);
        const resolutionOptions: ResolutionOptions = { expandRelativeUrls: false };

        await run(api, did, resolutionOptions);

        expect(resolved).to.deep.equal([[did, resolutionOptions]]);
        expect(written).to.have.length(1);
      });

      it(`${write}Did() ignores expandRelativeUrls true for a state source`, async () => {
        const { api, resolved, written } = recordingApi(write);
        const source = { document: { id: 'did:btcr2:test', verificationMethod: [], service: [] } as any, versionId: 1 };

        await run(api, source, { expandRelativeUrls: true });

        // The facade does not resolve a state source, so the write gets the state as it is.
        expect(resolved).to.have.length(0);
        expect(written).to.have.length(1);
        expect(written[0][0]).to.equal(source);
      });
    }
  });

  describe('tryResolveDid()', () => {
    it('returns ok: false when resolution fails (no btc config)', async () => {
      const api = createApi();
      const { did } = api.did.generate();
      const result = await api.tryResolveDid(did);
      expect(result.ok).to.equal(false);
      if (!result.ok) {
        expect(result.error).to.be.a('string');
      }
    });

    it('returns ok: false with network error (btc config, no node)', async () => {
      const api = createApi({ btc: { network: 'regtest' } });
      const { did } = api.did.generate();
      const result = await api.tryResolveDid(did);
      expect(result.ok).to.equal(false);
      if (!result.ok) {
        expect(result.error).to.equal(INTERNAL_ERROR);
        expect(result.errorMessage).to.be.a('string');
        expect(result.raw).to.exist;
      }
    });

    it('gives INVALID_DID_DOCUMENT for a sidecar genesis document with no JCS form', async () => {
      const api = createApi();
      const genesis = JSON.parse(JSON.stringify(api.btcr2.buildGenesisDocument({
        network             : 'regtest',
        verificationMethods : [{ publicKey: SchnorrKeyPair.generate().publicKey.compressed }],
      })));
      const did = api.btcr2.createExternal(new Uint8Array(32).fill(7), { network: 'regtest' });
      const result = await api.tryResolveDid(did, { sidecar: { genesisDocument: { ...genesis, note: '\ud800' } } });
      expect(result.ok).to.equal(false);
      if (!result.ok) {
        expect(result.error).to.equal(INVALID_DID_DOCUMENT);
        expect(result.errorMessage).to.include('lone surrogate');
      }
    });

    it('gives INVALID_OPTIONS for a versionId object with no text form, not INTERNAL_ERROR (ADR 156)', async () => {
      const api = createApi();
      const { did } = api.did.generate();
      const versionId = JSON.parse('{"toString":1,"valueOf":1}');
      const result = await api.tryResolveDid(did, { versionId });
      expect(result.ok).to.equal(false);
      if (!result.ok) {
        expect(result.error).to.equal(INVALID_OPTIONS);
        expect(result.errorMessage).to.equal('Invalid resolution option versionId: expected an ASCII string of an integer.');
      }
    });

    it('gives an INVALID_DID result for the empty DID string', async () => {
      const api = createApi();
      const result = await api.tryResolveDid('');
      expect(result.ok).to.equal(false);
      if (!result.ok) {
        expect(result.error).to.equal(INVALID_DID);
        expect(result.errorMessage).to.equal('Invalid did: ');
        expect(result.raw).to.deep.equal({
          didResolutionMetadata : { error: { type: 'https://www.w3.org/ns/did#INVALID_DID', title: 'Invalid DID', detail: 'Invalid did: ' } },
          didDocument           : null,
          didDocumentMetadata   : {},
        });
      }
    });

    for (const [label, value] of [['a number', 42], ['null', null], ['an object', {}], ['a null-prototype object', Object.create(null)]] as const) {
      it(`gives an INVALID_DID result for a DID that is ${label}`, async () => {
        const api = createApi();
        const result = await api.tryResolveDid(value as unknown as string);
        expect(result.ok).to.equal(false);
        if (!result.ok) {
          expect(result.error).to.equal(INVALID_DID);
          expect(result.errorMessage).to.equal('Invalid did: expected a string.');
        }
      });
    }

    it('gives the did:btcr2 errors page URL for a did:btcr2 error type', async () => {
      const api = createApi();
      const { did } = api.did.generate();
      (api.btcr2 as any).resolve = () => Promise.reject(
        new Error(`Failed to resolve DID ${did}: missing`, { cause: new ResolveError('Signed update not found', MISSING_UPDATE_DATA) })
      );
      const result = await api.tryResolveDid(did);
      expect(result.ok).to.equal(false);
      if (!result.ok) {
        expect(result.error).to.equal(MISSING_UPDATE_DATA);
        expect(result.raw.didResolutionMetadata.error).to.deep.equal({
          type   : 'https://dcdpr.github.io/did-btcr2/errors.html#missing_update_data',
          title  : 'Missing update data',
          detail : 'Signed update not found',
        });
      }
    });

    it('gives FEATURE_NOT_SUPPORTED for an unknown option', async () => {
      const api = createApi();
      const { did } = api.did.generate();
      const result = await api.tryResolveDid(did, { foo: 1 } as unknown as ResolutionOptions);
      expect(result.ok).to.equal(false);
      if (!result.ok) {
        expect(result.error).to.equal(FEATURE_NOT_SUPPORTED);
        expect(result.raw.didResolutionMetadata.error?.type).to.equal('https://www.w3.org/ns/did#FEATURE_NOT_SUPPORTED');
      }
    });

    it('gives INVALID_OPTIONS for a noCache value that is not a boolean or "true" or "false"', async () => {
      const api = createApi();
      const { did } = api.did.generate();
      const result = await api.tryResolveDid(did, { noCache: 'yes' } as unknown as ResolutionOptions);
      expect(result.ok).to.equal(false);
      if (!result.ok) {
        expect(result.error).to.equal(INVALID_OPTIONS);
        expect(result.raw.didResolutionMetadata.error?.title).to.equal('Invalid resolution options');
      }
    });

    it('gives INVALID_OPTIONS for a sidecar member of the wrong JSON type, not INTERNAL_ERROR', async () => {
      const api = createApi();
      const { did } = api.did.generate();
      for (const updates of [ 5, { length: 1 } ]) {
        const result = await api.tryResolveDid(did, { sidecar: { updates } } as unknown as ResolutionOptions);
        expect(result.ok).to.equal(false);
        if (!result.ok) {
          expect(result.error, JSON.stringify(updates)).to.equal(INVALID_OPTIONS);
          expect(result.errorMessage).to.include('Invalid resolution option sidecar.updates: expected an array');
        }
      }
    });

    it('gives NOT_FOUND for a genesis document if the CAS read times out, not INTERNAL_ERROR', async () => {
      const api = createApi({ cas: { executor: { retrieve: () => new Promise(() => {}), publish: async () => '' }, timeoutMs: 20 } });
      const did = api.btcr2.createExternal(new Uint8Array(32).fill(7), { network: 'regtest' });
      const result = await api.tryResolveDid(did);
      expect(result.ok).to.equal(false);
      if (!result.ok) {
        expect(result.error).to.equal(NOT_FOUND);
        expect(result.errorMessage).to.include('cannot be retrieved: CAS operation timed out after 20ms');
      }
    });

    it('takes the code of a failed result that resolve returns from the error type', async () => {
      const api = createApi();
      const { did } = api.did.generate();
      const error = { type: 'https://www.w3.org/ns/did#NOT_FOUND', title: 'DID not found', detail: 'gone' };
      (api.btcr2 as any).resolve = async () => ({ didResolutionMetadata: { error }, didDocument: null, didDocumentMetadata: {} });
      const result = await api.tryResolveDid(did);
      expect(result.ok).to.equal(false);
      if (!result.ok) {
        expect(result.error).to.equal(NOT_FOUND);
        expect(result.errorMessage).to.equal('gone');
        expect(result.cause).to.equal(undefined);
      }
      (api.btcr2 as any).resolve = async () => ({ didResolutionMetadata: {}, didDocument: null, didDocumentMetadata: {} });
      const empty = await api.tryResolveDid(did);
      expect(empty.ok).to.equal(false);
      if (!empty.ok) {
        expect(empty.error).to.equal(INTERNAL_ERROR);
        expect(empty.errorMessage).to.equal(undefined);
      }
    });

    it('carries the root cause, not the wrapper, in errorMessage', async () => {
      const api = createApi();
      const { did } = api.did.generate();
      const result = await api.tryResolveDid(did);
      expect(result.ok).to.equal(false);
      if (!result.ok) {
        // errorMessage is the deepest cause (the no-connection guard), not the
        // constant "Failed to resolve DID ..." wrapper around it.
        expect(result.errorMessage).to.include('Bitcoin connection required to fetch beacon signals');
        expect(result.errorMessage).to.not.include('Failed to resolve DID');
        // The original thrown wrapper rides along for callers that need the chain.
        expect(result.cause).to.be.instanceOf(Error);
        expect((result.cause as Error).message).to.include(`Failed to resolve DID ${did}: `);
        // The raw metadata holds the error object of the top-level code.
        expect(result.error).to.equal(INTERNAL_ERROR);
        expect(result.raw.didResolutionMetadata.error).to.deep.equal({
          type   : 'https://www.w3.org/ns/did#INTERNAL_ERROR',
          title  : 'Internal error',
          detail : result.errorMessage,
        });
      }
    });

    it('does not throw when resolution rejects with null', async () => {
      const api = createApi();
      const { did } = api.did.generate();
      (api.btcr2 as any).resolve = () => Promise.reject(null);
      const result = await api.tryResolveDid(did);
      expect(result.ok).to.equal(false);
      if (!result.ok) {
        expect(result.errorMessage).to.equal('Unknown error');
        expect(result.cause).to.equal(null);
        expect(result.raw.didResolutionMetadata.error?.detail).to.equal('Unknown error');
      }
    });

    it('reports the DID Resolution error code of a typed failure in the cause chain', async () => {
      const api = createApi();
      const { did } = api.did.generate();
      (api.btcr2 as any).resolve = () => Promise.reject(
        new Error(`Failed to resolve DID ${did}: not found`, { cause: new ResolveError('Genesis document not found in CAS', NOT_FOUND) })
      );
      const result = await api.tryResolveDid(did);
      expect(result.ok).to.equal(false);
      if (!result.ok) {
        expect(result.error).to.equal(NOT_FOUND);
        expect(result.errorMessage).to.equal('Genesis document not found in CAS');
        expect(result.raw.didResolutionMetadata.error?.type).to.equal('https://www.w3.org/ns/did#NOT_FOUND');
      }
    });

    it('reports NOT_FOUND for an EXTERNAL DID whose genesis document the CAS does not return', async () => {
      // A hermetic CAS: the default createApi() config reaches a public gateway.
      const api = createApi({ cas: { executor: { retrieve: async () => null, publish: async () => '' } } });
      const did = api.btcr2.createExternal(new Uint8Array(32).fill(0xAB), { network: 'regtest' });
      const result = await api.tryResolveDid(did);
      expect(result.ok).to.equal(false);
      if (!result.ok) {
        expect(result.error).to.equal(NOT_FOUND);
      }
    });
  });

  describe('dispose()', () => {
    it('should set disposed to true', () => {
      const api = createApi();
      expect(api.disposed).to.equal(false);
      api.dispose();
      expect(api.disposed).to.equal(true);
    });

    it('should throw on btc access after dispose', () => {
      const api = createApi({ btc: { network: 'regtest' } });
      api.dispose();
      expect(() => api.btc).to.throw('disposed');
    });

    it('should throw on btcr2 access after dispose', () => {
      const api = createApi();
      api.dispose();
      expect(() => api.btcr2).to.throw('disposed');
    });

    it('should throw on generateDid after dispose', () => {
      const api = createApi();
      api.dispose();
      expect(() => api.generateDid()).to.throw('disposed');
    });

    it('should throw on resolveDid after dispose', async () => {
      const api = createApi();
      api.dispose();
      await expect(api.resolveDid('did:btcr2:test')).to.be.rejectedWith('disposed');
    });

    it('should throw on updateDid after dispose', async () => {
      const api = createApi();
      api.dispose();
      await expect(api.updateDid('did:btcr2:test', [], stubSigner)).to.be.rejectedWith('disposed');
    });

    it('should throw on deactivateDid after dispose', async () => {
      const api = createApi();
      api.dispose();
      await expect(api.deactivateDid('did:btcr2:test', stubSigner)).to.be.rejectedWith('disposed');
    });

    it('should throw on createDid after dispose', () => {
      const api = createApi();
      api.dispose();
      expect(() => api.createDid('deterministic', new Uint8Array(33).fill(1))).to.throw('disposed');
    });
  });
});

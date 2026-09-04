import { expect, use } from 'chai';
import chaiAsPromised from 'chai-as-promised';
import { INVALID_DID_UPDATE, UpdateError } from '@did-btcr2/common';
import { LocalSigner, SchnorrKeyPair } from '@did-btcr2/keypair';
import {
  BitcoinApi,
  CryptoApi,
  createApi,
  DidApi,
  DidBtcr2Api,
  DidMethodApi,
  KeyManagerApi,
} from '../src/index.js';
import type { ResolutionOptions } from '../src/index.js';

const stubSigner = new LocalSigner(SchnorrKeyPair.generate().secretKey.bytes);

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
  });

  describe('updateDid()', () => {
    it('should throw when resolution fails (no btc config)', async () => {
      const api = createApi();
      const { did } = api.did.generate();
      await expect(
        api.updateDid({
          did,
          patches              : [{ op: 'add', path: '/test', value: 'x' }],
          verificationMethodId : '#initialKey',
          beaconId             : '#beacon-0',
          signer               : stubSigner,
        })
      ).to.be.rejected;
    });

    it('should reject empty DID string', async () => {
      const api = createApi();
      await expect(
        api.updateDid({
          did                  : '',
          patches              : [{ op: 'add', path: '/test', value: 'x' }],
          verificationMethodId : '#initialKey',
          beaconId             : '#beacon-0',
          signer               : stubSigner,
        })
      ).to.be.rejectedWith('did must be a non-empty string');
    });

    it('should skip resolution when sourceDocument and sourceVersionId provided', async () => {
      const api = createApi();
      await expect(
        api.updateDid({
          did                    : 'did:btcr2:test',
          patches                : [{ op: 'add', path: '/test', value: 'x' }],
          verificationMethodId   : '#initialKey',
          beaconId               : '#beacon-0',
          signer                 : stubSigner,
          sourceDocument         : { id: 'did:btcr2:test', verificationMethod: [], service: [] } as any,
          sourceVersionId        : 1,
        })
      ).to.be.rejected;
    });

    it('should throw when resolution fails', async () => {
      const api = createApi({ btc: { network: 'regtest' } });
      const { did } = api.did.generate();
      // Resolution will fail (no Bitcoin node running); the error may come
      // from the network layer or from our "Failed to resolve" guard.
      await expect(
        api.updateDid({
          did,
          patches              : [{ op: 'add', path: '/test', value: 'x' }],
          verificationMethodId : '#initialKey',
          beaconId             : '#beacon-0',
          signer               : stubSigner,
        })
      ).to.be.rejected;
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
      let captured: any;
      (api.btcr2 as any).update = async (params: any) => {
        captured = params;
        return { signedUpdate: {}, txid: 'txid', publishedToCas: [] };
      };

      await api.updateDid({
        did,
        patches              : [{ op: 'add', path: '/test', value: 'x' }],
        verificationMethodId : '#initialKey',
        beaconId             : '#beacon-0',
        signer               : stubSigner,
        resolutionOptions,
      });

      expect(seenOptions).to.equal(resolutionOptions);
      expect(captured.sourceDocument.id).to.equal(did);
      expect(captured.sourceVersionId).to.equal(2);
    });

    it('ignores resolutionOptions when sourceDocument and sourceVersionId are supplied', async () => {
      const api = createApi();
      let resolveCalls = 0;
      (api.btcr2 as any).resolve = async () => {
        resolveCalls++;
        throw new Error('resolution must be skipped');
      };
      let captured: any;
      (api.btcr2 as any).update = async (params: any) => {
        captured = params;
        return { signedUpdate: {}, txid: 'txid', publishedToCas: [] };
      };

      await api.updateDid({
        did                  : 'did:btcr2:test',
        patches              : [{ op: 'add', path: '/test', value: 'x' }],
        verificationMethodId : '#initialKey',
        beaconId             : '#beacon-0',
        signer               : stubSigner,
        sourceDocument       : { id: 'did:btcr2:test', verificationMethod: [], service: [] } as any,
        sourceVersionId      : 1,
        resolutionOptions    : { sidecar: {} },
      });

      expect(resolveCalls).to.equal(0);
      expect(captured.sourceVersionId).to.equal(1);
    });

    it('refuses a sourceDocument without a sourceVersionId before resolving', async () => {
      const api = createApi();
      let resolveCalls = 0;
      (api.btcr2 as any).resolve = async () => {
        resolveCalls++;
        throw new Error('resolution must not run');
      };

      const err: unknown = await api.updateDid({
        did                  : 'did:btcr2:test',
        patches              : [{ op: 'add', path: '/test', value: 'x' }],
        verificationMethodId : '#initialKey',
        beaconId             : '#beacon-0',
        signer               : stubSigner,
        sourceDocument       : { id: 'did:btcr2:test', verificationMethod: [], service: [] } as any,
      }).catch((e: unknown) => e);

      expect(err).to.be.instanceOf(UpdateError);
      expect((err as UpdateError).message).to.include('both sourceDocument and sourceVersionId');
      expect((err as UpdateError).type).to.equal(INVALID_DID_UPDATE);
      expect((err as UpdateError).data).to.deep.equal({ did: 'did:btcr2:test' });
      expect(resolveCalls).to.equal(0);
    });

    it('refuses a sourceVersionId without a sourceDocument before resolving', async () => {
      const api = createApi();
      let resolveCalls = 0;
      (api.btcr2 as any).resolve = async () => {
        resolveCalls++;
        throw new Error('resolution must not run');
      };

      await expect(
        api.updateDid({
          did                  : 'did:btcr2:test',
          patches              : [{ op: 'add', path: '/test', value: 'x' }],
          verificationMethodId : '#initialKey',
          beaconId             : '#beacon-0',
          signer               : stubSigner,
          sourceVersionId      : 1,
        })
      ).to.be.rejectedWith(UpdateError, 'both sourceDocument and sourceVersionId');
      expect(resolveCalls).to.equal(0);
    });

    it('refuses a sourceDocument that describes a different DID', async () => {
      const api = createApi();
      let resolveCalls = 0;
      let updateCalls = 0;
      (api.btcr2 as any).resolve = async () => {
        resolveCalls++;
        throw new Error('resolution must not run');
      };
      (api.btcr2 as any).update = async () => {
        updateCalls++;
        return { signedUpdate: {}, txid: 'txid', publishedToCas: [] };
      };

      const err: unknown = await api.updateDid({
        did                  : 'did:btcr2:test',
        patches              : [{ op: 'add', path: '/test', value: 'x' }],
        verificationMethodId : '#initialKey',
        beaconId             : '#beacon-0',
        signer               : stubSigner,
        sourceDocument       : { id: 'did:btcr2:other', verificationMethod: [], service: [] } as any,
        sourceVersionId      : 1,
      }).catch((e: unknown) => e);

      expect(err).to.be.instanceOf(UpdateError);
      expect((err as UpdateError).message).to.include('does not match the DID under update');
      expect((err as UpdateError).type).to.equal(INVALID_DID_UPDATE);
      expect((err as UpdateError).data).to.deep.equal({ did: 'did:btcr2:test', sourceDocumentId: 'did:btcr2:other' });
      expect(resolveCalls).to.equal(0);
      expect(updateCalls).to.equal(0);
    });

    it('treats a null sourceVersionId as not supplied', async () => {
      const api = createApi();
      let resolveCalls = 0;
      (api.btcr2 as any).resolve = async () => {
        resolveCalls++;
        throw new Error('resolution must not run');
      };

      await expect(
        api.updateDid({
          did                  : 'did:btcr2:test',
          patches              : [{ op: 'add', path: '/test', value: 'x' }],
          verificationMethodId : '#initialKey',
          beaconId             : '#beacon-0',
          signer               : stubSigner,
          sourceDocument       : { id: 'did:btcr2:test', verificationMethod: [], service: [] } as any,
          sourceVersionId      : null as any,
        })
      ).to.be.rejectedWith(UpdateError, 'both sourceDocument and sourceVersionId');
      expect(resolveCalls).to.equal(0);
    });

    it('treats a null source pair as neither supplied and takes both values from the resolution', async () => {
      const api = createApi();
      const { did } = api.did.generate();
      let resolveCalls = 0;
      (api.btcr2 as any).resolve = async () => {
        resolveCalls++;
        return {
          didDocument           : { id: did, verificationMethod: [], service: [] },
          didDocumentMetadata   : { versionId: '2' },
          didResolutionMetadata : {},
        };
      };
      let captured: any;
      (api.btcr2 as any).update = async (params: any) => {
        captured = params;
        return { signedUpdate: {}, txid: 'txid', publishedToCas: [] };
      };

      await api.updateDid({
        did,
        patches              : [{ op: 'add', path: '/test', value: 'x' }],
        verificationMethodId : '#initialKey',
        beaconId             : '#beacon-0',
        signer               : stubSigner,
        sourceDocument       : null as any,
        sourceVersionId      : null as any,
      });

      expect(resolveCalls).to.equal(1);
      expect(captured.sourceDocument.id).to.equal(did);
      expect(captured.sourceVersionId).to.equal(2);
    });

    it('passes omitted verificationMethodId and beaconId through for derivation', async () => {
      const api = createApi();
      const { did } = api.did.generate();
      (api.btcr2 as any).resolve = async () => ({
        didDocument           : { id: did, verificationMethod: [], service: [] },
        didDocumentMetadata   : { versionId: '1' },
        didResolutionMetadata : {},
      });
      let captured: any;
      (api.btcr2 as any).update = async (params: any) => {
        captured = params;
        return { signedUpdate: {}, txid: 'txid', publishedToCas: [] };
      };

      await api.updateDid({ did, patches: [], signer: stubSigner });

      // The facade adds nothing. The method facade derives both ids.
      expect(captured.verificationMethodId).to.equal(undefined);
      expect(captured.beaconId).to.equal(undefined);
      expect(captured.signer).to.equal(stubSigner);
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
      await expect(
        api.updateDid({
          did,
          patches              : [{ op: 'add', path: '/test', value: 'x' }],
          verificationMethodId : '#initialKey',
          beaconId             : '#beacon-0',
          signer               : stubSigner,
        })
      ).to.be.rejectedWith(UpdateError, 'is deactivated and cannot be updated');
      expect(resolveCalls).to.equal(1);
    });

    it('refuses a supplied deactivated document', async () => {
      const api = createApi();
      await expect(
        api.updateDid({
          did                  : 'did:btcr2:test',
          patches              : [{ op: 'add', path: '/test', value: 'x' }],
          verificationMethodId : '#initialKey',
          beaconId             : '#beacon-0',
          signer               : stubSigner,
          sourceVersionId      : 2,
          sourceDocument       : {
            id                 : 'did:btcr2:test',
            deactivated        : true,
            verificationMethod : [],
            service            : [],
          } as any,
        })
      ).to.be.rejectedWith(UpdateError, 'is deactivated and cannot be updated');
    });
  });

  describe('deactivateDid()', () => {
    it('should reject empty DID string', async () => {
      const api = createApi();
      await expect(
        api.deactivateDid({
          did                  : '',
          verificationMethodId : '#initialKey',
          beaconId             : '#beacon-0',
          signer               : stubSigner,
        })
      ).to.be.rejectedWith('did must be a non-empty string');
    });

    it('refuses an already-deactivated document', async () => {
      const api = createApi({ btc: { network: 'regtest' } });
      await expect(
        api.deactivateDid({
          did                  : 'did:btcr2:test',
          verificationMethodId : '#initialKey',
          beaconId             : '#beacon-0',
          signer               : stubSigner,
          sourceDocument       : {
            id                 : 'did:btcr2:test',
            deactivated        : true,
            verificationMethod : [],
            service            : [],
          } as any,
          sourceVersionId : 2,
        })
      ).to.be.rejectedWith('already deactivated');
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
      let captured: any;
      (api.btcr2 as any).deactivate = async (params: any) => {
        captured = params;
        return { signedUpdate: {}, txid: 'txid', publishedToCas: [] };
      };

      await api.deactivateDid({
        did,
        verificationMethodId : '#initialKey',
        beaconId             : '#beacon-0',
        signer               : stubSigner,
        resolutionOptions,
      });

      expect(seenOptions).to.equal(resolutionOptions);
      expect(captured.sourceVersionId).to.equal(3);
    });

    it('passes omitted verificationMethodId and beaconId through for derivation', async () => {
      const api = createApi();
      const { did } = api.did.generate();
      (api.btcr2 as any).resolve = async () => ({
        didDocument           : { id: did, verificationMethod: [], service: [] },
        didDocumentMetadata   : { versionId: '1' },
        didResolutionMetadata : {},
      });
      let captured: any;
      (api.btcr2 as any).deactivate = async (params: any) => {
        captured = params;
        return { signedUpdate: {}, txid: 'txid', publishedToCas: [] };
      };

      await api.deactivateDid({ did, signer: stubSigner });

      // The facade adds nothing. The method facade derives both ids.
      expect(captured.verificationMethodId).to.equal(undefined);
      expect(captured.beaconId).to.equal(undefined);
      expect(captured.signer).to.equal(stubSigner);
    });

    it('refuses a half-supplied source before resolving', async () => {
      const api = createApi();
      let resolveCalls = 0;
      (api.btcr2 as any).resolve = async () => {
        resolveCalls++;
        throw new Error('resolution must not run');
      };

      await expect(
        api.deactivateDid({
          did                  : 'did:btcr2:test',
          verificationMethodId : '#initialKey',
          beaconId             : '#beacon-0',
          signer               : stubSigner,
          sourceVersionId      : 2,
        })
      ).to.be.rejectedWith(UpdateError, 'both sourceDocument and sourceVersionId');
      expect(resolveCalls).to.equal(0);
    });

    it('refuses a sourceDocument that describes a different DID', async () => {
      const api = createApi();
      let deactivateCalls = 0;
      (api.btcr2 as any).deactivate = async () => {
        deactivateCalls++;
        return { signedUpdate: {}, txid: 'txid', publishedToCas: [] };
      };

      await expect(
        api.deactivateDid({
          did                  : 'did:btcr2:test',
          verificationMethodId : '#initialKey',
          beaconId             : '#beacon-0',
          signer               : stubSigner,
          sourceDocument       : { id: 'did:btcr2:other', verificationMethod: [], service: [] } as any,
          sourceVersionId      : 2,
        })
      ).to.be.rejectedWith(UpdateError, 'does not match the DID under update');
      expect(deactivateCalls).to.equal(0);
    });
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
        expect(result.error).to.equal('internalError');
        expect(result.errorMessage).to.be.a('string');
        expect(result.raw).to.exist;
      }
    });

    it('rejects empty DID string', async () => {
      const api = createApi();
      await expect(api.tryResolveDid('')).to.be.rejectedWith(
        'did must be a non-empty string'
      );
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
        // The raw metadata mirrors the top-level fields.
        expect(result.raw.didResolutionMetadata.error).to.equal('internalError');
        expect(result.raw.didResolutionMetadata.errorMessage).to.equal(result.errorMessage);
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
        expect(result.raw.didResolutionMetadata.errorMessage).to.equal('Unknown error');
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
      await expect(
        api.updateDid({
          did                  : 'did:btcr2:test',
          patches              : [],
          verificationMethodId : '#key',
          beaconId             : '#beacon',
          signer               : stubSigner,
        })
      ).to.be.rejectedWith('disposed');
    });

    it('should throw on deactivateDid after dispose', async () => {
      const api = createApi();
      api.dispose();
      await expect(
        api.deactivateDid({
          did                  : 'did:btcr2:test',
          verificationMethodId : '#key',
          beaconId             : '#beacon',
          signer               : stubSigner,
        })
      ).to.be.rejectedWith('disposed');
    });

    it('should throw on createDid after dispose', () => {
      const api = createApi();
      api.dispose();
      expect(() => api.createDid('deterministic', new Uint8Array(33).fill(1))).to.throw('disposed');
    });
  });
});

import { expect, use } from 'chai';
import chaiAsPromised from 'chai-as-promised';
import {
  BitcoinApi,
  CryptoApi,
  createApi,
  DidApi,
  DidBtcr2Api,
  DidMethodApi,
  KeyManagerApi,
} from '../src/index.js';

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

  describe('resolveDid()', () => {
    it('should delegate to btcr2.resolve', async () => {
      const api = createApi({ btc: { network: 'regtest' } });
      const { did } = api.did.generate();
      try {
        await api.resolveDid(did);
      } catch (e: any) {
        expect(e.message).to.not.include('Bitcoin not configured');
      }
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
        })
      ).to.be.rejected;
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

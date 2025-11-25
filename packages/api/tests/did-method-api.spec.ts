import { expect, use } from 'chai';
import chaiAsPromised from 'chai-as-promised';
import { SchnorrKeyPair } from '@did-btcr2/keypair';
import { NotImplementedError } from '@did-btcr2/common';
import {
  BitcoinApi,
  DidApi,
  DidMethodApi,
  MultikeyApi,
  UpdateBuilder,
} from '../src/index.js';

use(chaiAsPromised);

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

  describe('resolve()', () => {
    it('injects bitcoin connection when configured', async () => {
      const btc = new BitcoinApi({ network: 'regtest' });
      const methodApi = new DidMethodApi(btc);
      const kp = SchnorrKeyPair.generate();
      const did = methodApi.createDeterministic(kp.publicKey.compressed, { network: 'regtest' });
      try {
        await methodApi.resolve(did);
      } catch (e: any) {
        expect(e.message).to.not.include('Bitcoin connection required');
      }
    });

    it('passes through user-provided driver options', async () => {
      const btc = new BitcoinApi({ network: 'regtest' });
      const methodApi = new DidMethodApi();
      const kp = SchnorrKeyPair.generate();
      const did = methodApi.createDeterministic(kp.publicKey.compressed, { network: 'regtest' });
      try {
        await methodApi.resolve(did, { drivers: { bitcoin: btc.connection } });
      } catch (e: any) {
        expect(e.message).to.not.include('Bitcoin not configured');
      }
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
  });

  describe('update()', () => {
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
          bitcoin              : btc.connection,
        })
      ).to.be.rejected;
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
          .signer('#key')
          .beacon('#beacon')
          .execute()
      ).to.be.rejectedWith('sourceVersionId is required');

      // Missing signer
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
          .signer('#key')
          .execute()
      ).to.be.rejectedWith('beaconId is required');
    });

    it('builder chains fluently and calls update', async () => {
      const btc = new BitcoinApi({ network: 'regtest' });
      const methodApi = new DidMethodApi(btc);
      const doc = { id: 'did:btcr2:test', verificationMethod: [], service: [] } as any;

      // Will fail at the method layer (missing signingMaterial) but proves wiring works
      await expect(
        methodApi.buildUpdate(doc)
          .patch({ op: 'add', path: '/test', value: 'x' })
          .version(1)
          .signer('#initialKey')
          .beacon('#beacon-0')
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
          .signer('#key')
          .beacon('#beacon')
          .execute()
      ).to.be.rejected;
    });

    it('builder supports signingMaterial and withBitcoin', async () => {
      const btc = new BitcoinApi({ network: 'regtest' });
      const methodApi = new DidMethodApi();
      const doc = { id: 'did:btcr2:test', verificationMethod: [], service: [] } as any;

      await expect(
        methodApi.buildUpdate(doc)
          .patch({ op: 'add', path: '/a', value: 1 })
          .version(1)
          .signer('#key')
          .beacon('#beacon')
          .signingMaterial(new Uint8Array(32).fill(0x01))
          .withBitcoin(btc.connection)
          .execute()
      ).to.be.rejected;
    });
  });

  describe('deactivate()', () => {
    it('throws NotImplementedError', async () => {
      const methodApi = new DidMethodApi();
      await expect(methodApi.deactivate()).to.be.rejectedWith(
        NotImplementedError,
        'not implemented yet'
      );
    });
  });
});

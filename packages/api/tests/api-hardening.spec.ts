import { expect, use } from 'chai';
import chaiAsPromised from 'chai-as-promised';
import { canonicalHashBytes } from '@did-btcr2/common';
import { sha256 } from 'multiformats/hashes/sha2';
import { createApi, type DidBtcr2Api } from '../src/index.js';
import { CasApi, HttpGatewayCasExecutor, IpfsRpcCasExecutor, DEFAULT_MAX_CAS_RESPONSE_BYTES } from '../src/cas.js';
import type { CasExecutor } from '../src/cas.js';

use(chaiAsPromised);

type FetchInput = Parameters<typeof fetch>[0];

/** Shadow the prototype's lazy btcr2 getter with a capturing stub. */
function stubBtcr2Update(api: DidBtcr2Api): { called: boolean } {
  const state = { called: false };
  Object.defineProperty(api, 'btcr2', {
    configurable : true,
    value        : { update: async () => { state.called = true; } },
  });
  return state;
}

describe('api hardening (audit N3, N4, N5)', () => {
  describe('updateDid rejects deactivated DIDs (N3)', () => {
    const did = 'did:btcr2:k1qqpyerymt5aaxm2jyh7za2594hgrq24uhqanxe5h94rf42flxkwhvmqd03t47';

    it('throws when the caller-supplied source document is deactivated', async () => {
      const api = createApi();
      const btcr2 = stubBtcr2Update(api);
      await expect(
        api.updateDid({
          did,
          patches              : [],
          verificationMethodId : `${did}#initialKey`,
          beaconId             : `${did}#beacon-0`,
          signer               : {} as never,
          sourceDocument       : { id: did, deactivated: true } as never,
          sourceVersionId      : 1,
        })
      ).to.be.rejectedWith(/deactivated/);
      expect(btcr2.called).to.equal(false);
    });

    it('throws when resolution surfaces a deactivated document', async () => {
      const api = createApi();
      const btcr2 = stubBtcr2Update(api);
      (api as any).resolveDid = async () => ({
        didDocument           : { id: did, deactivated: true },
        didDocumentMetadata   : { deactivated: true, versionId: '3' },
        didResolutionMetadata : {},
      });
      await expect(
        api.updateDid({
          did,
          patches              : [],
          verificationMethodId : `${did}#initialKey`,
          beaconId             : `${did}#beacon-0`,
          signer               : {} as never,
        })
      ).to.be.rejectedWith(/deactivated/);
      expect(btcr2.called).to.equal(false);
    });

    it('DidMethodApi.update rejects a deactivated source document before touching bitcoin', async () => {
      const api: DidBtcr2Api = createApi();
      await expect(
        api.btcr2.update({
          sourceDocument       : { id: did, deactivated: true } as never,
          patches              : [],
          sourceVersionId      : 1,
          verificationMethodId : `${did}#initialKey`,
          beaconId             : `${did}#beacon-0`,
          signer               : {} as never,
          bitcoin              : { rest: {} } as never,
        })
      ).to.be.rejectedWith(/deactivated/);
    });
  });

  describe('CAS response size cap (N4)', () => {
    const originalFetch = globalThis.fetch;

    afterEach(() => {
      globalThis.fetch = originalFetch;
    });

    const stubFetch = (handler: (url: string) => Response | Promise<Response>) => {
      globalThis.fetch = (async (input: FetchInput) => handler(
        typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
      )) as typeof fetch;
    };

    it('gateway retrieve returns null when declared Content-Length exceeds the cap', async () => {
      stubFetch(() => new Response('x', {
        status  : 200,
        headers : { 'Content-Length': String(DEFAULT_MAX_CAS_RESPONSE_BYTES + 1) },
      }));
      const executor = new HttpGatewayCasExecutor('https://gateway.example');
      expect(await executor.retrieve('whatever')).to.be.null;
    });

    it('gateway retrieve returns null when a streamed body grows past a custom cap', async () => {
      const chunk = new Uint8Array(256);
      stubFetch(() => new Response(new ReadableStream<Uint8Array>({
        start(controller) {
          for (let i = 0; i < 10; i++) controller.enqueue(chunk);
          controller.close();
        },
      })));
      const executor = new HttpGatewayCasExecutor('https://gateway.example', 1024);
      expect(await executor.retrieve('whatever')).to.be.null;
    });

    it('rpc retrieve returns null when the body exceeds the cap', async () => {
      stubFetch(() => new Response('x', {
        status  : 200,
        headers : { 'Content-Length': String(DEFAULT_MAX_CAS_RESPONSE_BYTES + 1) },
      }));
      const executor = new IpfsRpcCasExecutor('http://node:5001');
      expect(await executor.retrieve('whatever')).to.be.null;
    });

    it('the cap is configurable through CasConfig.maxResponseBytes', async () => {
      const bytes = new TextEncoder().encode('{"ok":true}');
      stubFetch(() => new Response(Uint8Array.from(bytes)));
      const cas = new CasApi({ gateway: 'https://gateway.example', maxResponseBytes: 4 });
      const digest = await sha256.digest(bytes);
      expect(await cas.retrieve(digest.digest)).to.be.null;
    });
  });

  describe('CAS retrieval integrity verification (N5)', () => {
    const object = { hello: 'world' };
    const hashBytes = canonicalHashBytes(object);

    it('throws CAS_INTEGRITY_ERROR when the executor returns bytes that do not hash to the address', async () => {
      const hostile: CasExecutor = {
        retrieve : async () => new TextEncoder().encode('{"hello":"evil"}'),
        publish  : async () => 'unused',
      };
      const cas = new CasApi({ executor: hostile });
      let error: any;
      try {
        await cas.retrieve(hashBytes);
      } catch (e: any) {
        error = e;
      }
      expect(error).to.not.equal(undefined);
      expect(error.type).to.equal('CAS_INTEGRITY_ERROR');
      expect(error.message).to.match(/integrity/);
    });

    it('returns the parsed object when the bytes hash to the address', async () => {
      const honest: CasExecutor = {
        retrieve : async () => new TextEncoder().encode(JSON.stringify(object)),
        publish  : async () => 'unused',
      };
      // JSON.stringify({hello:'world'}) is already JCS-canonical for this object.
      const cas = new CasApi({ executor: honest });
      expect(await cas.retrieve(canonicalHashBytes(object))).to.deep.equal(object);
    });

    it('still returns null when the content is simply absent', async () => {
      const missing: CasExecutor = {
        retrieve : async () => null,
        publish  : async () => 'unused',
      };
      const cas = new CasApi({ executor: missing });
      expect(await cas.retrieve(hashBytes)).to.be.null;
    });
  });
});

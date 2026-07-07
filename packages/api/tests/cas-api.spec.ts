import { canonicalHash, canonicalHashBytes, canonicalize, encode, hash } from '@did-btcr2/common';
import { expect } from 'chai';
import { CID } from 'multiformats/cid';
import * as raw from 'multiformats/codecs/raw';
import { sha256 } from 'multiformats/hashes/sha2';
import {
  BlockstoreCasExecutor,
  CasApi,
  HttpGatewayCasExecutor,
  IpfsRpcCasExecutor,
} from '../src/index.js';
import type { CasExecutor } from '../src/index.js';

/** Derive the CIDv1 (raw codec, SHA-256) string for raw content bytes. */
async function cidForData(data: Uint8Array): Promise<string> {
  const digest = await sha256.digest(data);
  return CID.createV1(raw.code, digest).toString();
}

/** In-memory blockstore matching the structural BlockstoreLike shape. */
class FakeBlockstore {
  store = new Map<string, Uint8Array>();
  puts: string[] = [];

  async get(cid: CID): Promise<Uint8Array> {
    const block = this.store.get(cid.toString());
    if (!block) throw new Error(`block not found: ${cid.toString()}`);
    return block;
  }

  async put(cid: CID, block: Uint8Array): Promise<CID> {
    this.puts.push(cid.toString());
    this.store.set(cid.toString(), block);
    return cid;
  }
}

type FetchInput = Parameters<typeof fetch>[0];
type FetchInit = Parameters<typeof fetch>[1];
type FetchCall = { url: string; init?: FetchInit };

/**
 * CasApi Test
 */
describe('CasApi', () => {
  const object = { hello: 'world', num: 42 };
  const text = canonicalize(object);
  const data = new TextEncoder().encode(text);
  const dataHash = encode(hash(text), 'base64urlnopad');

  const originalFetch = globalThis.fetch;
  let fetchCalls: FetchCall[] = [];

  const stubFetch = (handler: (url: string, init?: FetchInit) => Response | Promise<Response>) => {
    globalThis.fetch = (async (input: FetchInput, init?: FetchInit) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
      fetchCalls.push({ url, init });
      return await handler(url, init);
    }) as typeof fetch;
  };

  beforeEach(() => {
    fetchCalls = [];
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  describe('BlockstoreCasExecutor', () => {
    it('publish stores the block under the content-derived CID and returns the base64url hash', async () => {
      const blockstore = new FakeBlockstore();
      const executor = new BlockstoreCasExecutor(blockstore);
      const published = await executor.publish(data);
      expect(published).to.equal(dataHash);
      expect(blockstore.puts).to.deep.equal([await cidForData(data)]);
    });

    it('retrieve returns the bytes published under the same hash', async () => {
      const blockstore = new FakeBlockstore();
      const executor = new BlockstoreCasExecutor(blockstore);
      const published = await executor.publish(data);
      const retrieved = await executor.retrieve(published);
      expect(retrieved).to.deep.equal(data);
    });

    it('accepts a provider object exposing a blockstore (e.g. an IPFS node instance)', async () => {
      const blockstore = new FakeBlockstore();
      const executor = new BlockstoreCasExecutor({ blockstore });
      const published = await executor.publish(data);
      expect(await executor.retrieve(published)).to.deep.equal(data);
      expect(blockstore.puts).to.have.length(1);
    });

    it('retrieve returns null when the blockstore is missing the block', async () => {
      const executor = new BlockstoreCasExecutor(new FakeBlockstore());
      expect(await executor.retrieve(dataHash)).to.be.null;
    });
  });

  describe('IpfsRpcCasExecutor', () => {
    it('publish POSTs to block/put (raw codec, sha2-256, pinned) and returns the content hash', async () => {
      const expectedCid = await cidForData(data);
      stubFetch(() => new Response(JSON.stringify({ Key: expectedCid, Size: data.length })));
      const executor = new IpfsRpcCasExecutor('http://node:5001');
      const published = await executor.publish(data);
      expect(published).to.equal(dataHash);
      expect(fetchCalls).to.have.length(1);
      expect(fetchCalls[0].url).to.equal('http://node:5001/api/v0/block/put?cid-codec=raw&mhtype=sha2-256&pin=true');
      expect(fetchCalls[0].init?.method).to.equal('POST');
      expect(fetchCalls[0].init?.body).to.be.instanceOf(FormData);
    });

    it('publish throws when the node returns a different CID', async () => {
      stubFetch(() => new Response(JSON.stringify({ Key: 'bafkbogus' })));
      const executor = new IpfsRpcCasExecutor('http://node:5001');
      let error: Error | undefined;
      try {
        await executor.publish(data);
      } catch (e: any) {
        error = e;
      }
      expect(error?.message).to.match(/unexpected CID/);
    });

    it('publish throws on a non-ok RPC response', async () => {
      stubFetch(() => new Response('nope', { status: 500, statusText: 'Internal Server Error' }));
      const executor = new IpfsRpcCasExecutor('http://node:5001');
      let error: Error | undefined;
      try {
        await executor.publish(data);
      } catch (e: any) {
        error = e;
      }
      expect(error?.message).to.match(/block\/put failed: 500/);
    });

    it('retrieve POSTs block/get with the hash-derived CID and returns the bytes', async () => {
      stubFetch(() => new Response(Uint8Array.from(data)));
      const executor = new IpfsRpcCasExecutor('http://node:5001');
      const retrieved = await executor.retrieve(dataHash);
      expect(retrieved).to.deep.equal(data);
      expect(fetchCalls[0].url).to.equal(`http://node:5001/api/v0/block/get?arg=${await cidForData(data)}`);
      expect(fetchCalls[0].init?.method).to.equal('POST');
    });

    it('retrieve returns null on a non-ok response', async () => {
      stubFetch(() => new Response('nope', { status: 500 }));
      const executor = new IpfsRpcCasExecutor('http://node:5001');
      expect(await executor.retrieve(dataHash)).to.be.null;
    });

    it('retrieve returns null when fetch rejects', async () => {
      stubFetch(() => { throw new Error('connection refused'); });
      const executor = new IpfsRpcCasExecutor('http://node:5001');
      expect(await executor.retrieve(dataHash)).to.be.null;
    });

    it('trims trailing slashes from the RPC URL', async () => {
      stubFetch(() => new Response(Uint8Array.from(data)));
      const executor = new IpfsRpcCasExecutor('http://node:5001///');
      await executor.retrieve(dataHash);
      expect(fetchCalls[0].url).to.match(/^http:\/\/node:5001\/api\/v0\/block\/get/);
    });
  });

  describe('HttpGatewayCasExecutor', () => {
    it('retrieve fetches the trustless-gateway raw block URL', async () => {
      stubFetch(() => new Response(Uint8Array.from(data)));
      const executor = new HttpGatewayCasExecutor('https://gateway.example');
      const retrieved = await executor.retrieve(dataHash);
      expect(retrieved).to.deep.equal(data);
      expect(fetchCalls[0].url).to.equal(`https://gateway.example/ipfs/${await cidForData(data)}?format=raw`);
      expect((fetchCalls[0].init?.headers as Record<string, string>).Accept).to.equal('application/vnd.ipld.raw');
    });

    it('retrieve returns null on a non-ok response', async () => {
      stubFetch(() => new Response('nope', { status: 404 }));
      const executor = new HttpGatewayCasExecutor('https://gateway.example');
      expect(await executor.retrieve(dataHash)).to.be.null;
    });

    it('publish rejects: the gateway protocol is read-only', async () => {
      const executor = new HttpGatewayCasExecutor('https://gateway.example');
      let error: Error | undefined;
      try {
        await executor.publish();
      } catch (e: any) {
        error = e;
      }
      expect(error?.message).to.match(/read-only/);
    });
  });

  describe('config selection', () => {
    const recordingExecutor = (): CasExecutor & { calls: string[] } => ({
      calls : [] as string[],
      async retrieve(h: string) {
        this.calls.push(`retrieve:${h}`);
        return null;
      },
      async publish(_data: Uint8Array) {
        this.calls.push('publish');
        return dataHash;
      },
    });

    it('requires at least one backend', () => {
      expect(() => new CasApi({})).to.throw(/executor, blockstore, RPC URL, or gateway/);
    });

    it('prefers a custom executor over all other backends', async () => {
      stubFetch(() => new Response('should not be called', { status: 500 }));
      const executor = recordingExecutor();
      const cas = new CasApi({
        executor,
        blockstore : new FakeBlockstore(),
        rpcUrl     : 'http://node:5001',
        gateway    : 'https://gateway.example',
      });
      expect(await cas.publish(object)).to.equal(dataHash);
      expect(executor.calls).to.deep.equal(['publish']);
      expect(fetchCalls).to.have.length(0);
    });

    it('prefers a blockstore over rpcUrl and gateway', async () => {
      stubFetch(() => new Response('should not be called', { status: 500 }));
      const blockstore = new FakeBlockstore();
      const cas = new CasApi({
        blockstore,
        rpcUrl  : 'http://node:5001',
        gateway : 'https://gateway.example',
      });
      await cas.publish(object);
      expect(blockstore.puts).to.have.length(1);
      expect(fetchCalls).to.have.length(0);
    });

    it('prefers rpcUrl over gateway', async () => {
      const expectedCid = await cidForData(data);
      stubFetch(() => new Response(JSON.stringify({ Key: expectedCid })));
      const cas = new CasApi({
        rpcUrl  : 'http://node:5001',
        gateway : 'https://gateway.example',
      });
      await cas.publish(object);
      expect(fetchCalls[0].url).to.match(/^http:\/\/node:5001\/api\/v0\/block\/put/);
    });
  });

  describe('canPublish / writable', () => {
    it('HttpGatewayCasExecutor declares canPublish false and CasApi reports non-writable', () => {
      const executor = new HttpGatewayCasExecutor('https://gateway.example');
      expect(executor.canPublish).to.equal(false);
      expect(new CasApi({ executor }).writable).to.equal(false);
    });

    it('an executor without canPublish is treated as writable (undefined means true)', () => {
      const executor: CasExecutor = {
        retrieve : async () => null,
        publish  : async () => 'hash',
      };
      expect(new CasApi({ executor }).writable).to.equal(true);
    });

    it('an executor with canPublish true is writable', () => {
      const executor: CasExecutor = {
        retrieve   : async () => null,
        publish    : async () => 'hash',
        canPublish : true,
      };
      expect(new CasApi({ executor }).writable).to.equal(true);
    });

    it('blockstore- and RPC-backed configs are writable', () => {
      expect(new CasApi({ blockstore: new FakeBlockstore() }).writable).to.equal(true);
      expect(new CasApi({ rpcUrl: 'http://127.0.0.1:5001' }).writable).to.equal(true);
    });
  });

  describe('publish / retrieve', () => {
    it('publish canonicalizes the object and returns its canonical hash', async () => {
      const cas = new CasApi({ blockstore: new FakeBlockstore() });
      expect(await cas.publish(object)).to.equal(canonicalHash(object));
    });

    it('retrieve returns the parsed object by its canonical hash bytes', async () => {
      const cas = new CasApi({ blockstore: new FakeBlockstore() });
      await cas.publish(object);
      expect(await cas.retrieve(canonicalHashBytes(object))).to.deep.equal(object);
    });

    it('retrieve returns null when the content is not found', async () => {
      const cas = new CasApi({ blockstore: new FakeBlockstore() });
      expect(await cas.retrieve(canonicalHashBytes(object))).to.be.null;
    });

    it('times out stalled operations after timeoutMs', async () => {
      const stalled: CasExecutor = {
        retrieve : () => new Promise(() => {}),
        publish  : () => new Promise(() => {}),
      };
      const cas = new CasApi({ executor: stalled, timeoutMs: 20 });
      let error: Error | undefined;
      try {
        await cas.retrieve(canonicalHashBytes(object));
      } catch (e: any) {
        error = e;
      }
      expect(error?.message).to.match(/timed out after 20ms/);
    });
  });
});

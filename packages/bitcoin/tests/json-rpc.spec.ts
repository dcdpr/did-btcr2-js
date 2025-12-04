import { expect } from 'chai';
import { JsonRpcTransport } from '../src/client/rpc/json-rpc.js';
import { isBitcoinRpcClient } from '../src/index.js';
import { MethodNameInLowerCase } from '../src/types.js';

/**
 * JsonRpcTransport Test Suite
 */
describe('JsonRpcTransport', () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it('constructs with default URL and no auth', () => {
    const transport = new JsonRpcTransport({});
    expect((transport as any).url).to.equal('http://127.0.0.1:8332');
  });

  it('catches an error if host/url is undefined', () => {
    new JsonRpcTransport({ host: 'undefined' });
  });

  it('builds auth header from config or URL and handles calls', async () => {
    const calls: any[] = [];
    global.fetch = async (url: any, init?: any) => {
      calls.push({ url, init });
      return {
        ok      : true,
        status  : 200,
        json    : async () => ({ result: 'ok' }),
        headers : new Headers(),
        text    : async () => '',
      } as any;
    };

    const transport = new JsonRpcTransport({ host: 'http://user:pass@node:8332' });
    const single = await transport.command({ method: 'getblockhash', parameters: [1] });
    expect(single).to.equal('ok');
    expect(calls[0].url).to.equal('http://node:8332');
    expect(calls[0].init.headers.Authorization).to.match(/^Basic/);

    const batchTransport = new JsonRpcTransport({ host: 'http://node:8332', username: 'alice', password: 'pw' });
    const batch = await batchTransport.command([{ method: 'a' as MethodNameInLowerCase }, { method: 'b' as MethodNameInLowerCase, parameters: [2] }]);
    expect(batch).to.deep.equal(['ok', 'ok']);
  });

  it('throws on HTTP errors and RPC errors', async () => {
    global.fetch = async () => ({
      ok         : false,
      status     : 500,
      statusText : 'Bad',
      headers    : new Headers(),
      text       : async () => 'fail',
      json       : async () => ({}),
    } as any);

    const transport = new JsonRpcTransport({ host: 'http://node:8332' });
    try {
      await transport.command({ method: 'bad' });
      expect.fail('Expected http error');
    } catch (err: any) {
      expect((err as any).code).to.equal(500);
      expect((err as any).rpc).to.equal(true);
    }

    global.fetch = async () => ({
      ok      : true,
      status  : 200,
      headers : new Headers(),
      json    : async () => ({ error: { code: -1, message: 'oops' } }),
      text    : async () => '',
    } as any);

    try {
      await transport.command({ method: 'bad' });
      expect.fail('Expected RPC error');
    } catch (err: any) {
      expect((err as any).code).to.equal(-1);
      expect((err as any).rpc).to.equal(true);
    }
  });

  it('returns true for objects that look like a BitcoinRpcClient', () => {
    const impl = {
      getBlockCount     : async () => 1,
      getBlockHash      : async (_h: number) => 'hash',
      getBlockchainInfo : async () => ({ /* ... */ }),
    };
    expect(isBitcoinRpcClient(impl)).to.equal(true);
  });

  it('returns false for non-matching objects', () => {
    expect(isBitcoinRpcClient({})).to.equal(false);
  });
});
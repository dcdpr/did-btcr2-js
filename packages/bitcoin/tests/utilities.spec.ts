import { NETWORK, TEST_NETWORK } from '@scure/btc-signer';
import { expect } from 'chai';
import type { HttpRequest } from '../src/client/http.js';
import { createFetchExecutor, defaultHttpExecutor } from '../src/client/http.js';
import { safeText, toBase64 } from '../src/client/utils.js';
import { BitcoinRestError, BitcoinRpcError } from '../src/errors.js';
import { getNetwork } from '../src/network.js';

describe('Utilities', () => {
  const originalBuffer = global.Buffer;

  afterEach(() => {
    global.Buffer = originalBuffer;
    // @ts-ignore
    delete global.btoa;
  });

  it('encodes base64 using Buffer', () => {
    expect(toBase64('hello')).to.equal(Buffer.from('hello', 'utf8').toString('base64'));
  });

  it('falls back to btoa when Buffer is unavailable', () => {
    // @ts-ignore
    global.Buffer = undefined;
    // @ts-ignore
    global.btoa = (s: string) => `btoa:${s}`;
    expect(toBase64('abc')).to.equal('btoa:abc');
  });

  it('throws if no base64 encoder is available', () => {
    // @ts-ignore
    global.Buffer = undefined;
    // @ts-ignore
    delete global.btoa;
    expect(() => toBase64('x')).to.throw('No base64 encoder available');
  });

  it('safeText returns text from a Response', async () => {
    const res = new Response('text');
    expect(await safeText(res)).to.equal('text');
  });

  it('safeText swallows errors and returns empty string', async () => {
    const throwing = { text: async () => { throw new Error('boom'); } } as any;
    expect(await safeText(throwing)).to.equal('');
  });
});

describe('defaultHttpExecutor', () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it('calls global fetch with correct arguments', async () => {
    const seen: any[] = [];
    global.fetch = async (url: any, init?: any) => {
      seen.push({ url, init });
      return new Response('{}', { status: 200 });
    };

    const req: HttpRequest = {
      url     : 'http://example.com/test',
      method  : 'POST',
      headers : { 'Content-Type': 'application/json' },
      body    : '{"a":1}',
    };

    const res = await defaultHttpExecutor(req);
    expect(res.status).to.equal(200);
    expect(seen).to.have.length(1);
    expect(seen[0].url).to.equal('http://example.com/test');
    expect(seen[0].init.method).to.equal('POST');
    expect(seen[0].init.headers['Content-Type']).to.equal('application/json');
    expect(seen[0].init.body).to.equal('{"a":1}');
  });

  it('passes undefined body for GET requests', async () => {
    const seen: any[] = [];
    global.fetch = async (url: any, init?: any) => {
      seen.push({ url, init });
      return new Response('{}', { status: 200 });
    };

    const req: HttpRequest = {
      url     : 'http://example.com/test',
      method  : 'GET',
      headers : {},
    };

    await defaultHttpExecutor(req);
    expect(seen[0].init.body).to.be.undefined;
  });

  it('keeps the URL and sets no cache option for a request that is not fresh', async () => {
    const seen: any[] = [];
    global.fetch = async (url: any, init?: any) => {
      seen.push({ url, init });
      return new Response('{}', { status: 200 });
    };

    await defaultHttpExecutor({ url: 'http://example.com/tx/abc/hex', method: 'GET', headers: {} });
    expect(seen[0].url).to.equal('http://example.com/tx/abc/hex');
    expect(seen[0].init).to.not.have.property('cache');
    expect(seen[0].init).to.not.have.property('signal');
  });

  it('sets no-store and a unique query for a fresh request, with no added header', async () => {
    const seen: any[] = [];
    global.fetch = async (url: any, init?: any) => {
      seen.push({ url, init });
      return new Response('1', { status: 200 });
    };

    const req: HttpRequest = { url: 'http://example.com/blocks/tip/height', method: 'GET', headers: { 'X-Api-Key': 'k' }, fresh: true };
    await defaultHttpExecutor(req);
    await defaultHttpExecutor(req);
    expect(seen[0].url).to.match(/^http:\/\/example\.com\/blocks\/tip\/height\?_=[0-9a-f]{16}$/);
    expect(seen[1].url).to.match(/^http:\/\/example\.com\/blocks\/tip\/height\?_=[0-9a-f]{16}$/);
    expect(seen[0].url).to.not.equal(seen[1].url);
    expect(seen[0].init.cache).to.equal('no-store');
    expect(seen[0].init.headers).to.deep.equal({ 'X-Api-Key': 'k' });
    expect(req.url).to.equal('http://example.com/blocks/tip/height');
  });

  it('appends the unique query with & if the URL has a query', async () => {
    const seen: any[] = [];
    global.fetch = async (url: any) => {
      seen.push(url);
      return new Response('{}', { status: 200 });
    };

    await defaultHttpExecutor({ url: '/esplora/address/a/txs?after_txid=b', method: 'GET', headers: {}, fresh: true });
    expect(seen[0]).to.match(/^\/esplora\/address\/a\/txs\?after_txid=b&_=[0-9a-f]{16}$/);
  });
});

describe('createFetchExecutor', () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it('sets an abort signal if timeoutMs is set', async () => {
    const seen: any[] = [];
    global.fetch = async (url: any, init?: any) => {
      seen.push({ url, init });
      return new Response('{}', { status: 200 });
    };

    await createFetchExecutor({ timeoutMs: 5_000 })({ url: 'http://example.com/x', method: 'GET', headers: {}, fresh: true });
    expect(seen[0].init.signal).to.be.instanceOf(AbortSignal);
    expect(seen[0].init.signal.aborted).to.equal(false);
    expect(seen[0].init.cache).to.equal('no-store');
    expect(seen[0].url).to.match(/^http:\/\/example\.com\/x\?_=[0-9a-f]{16}$/);
  });

  it('sets no abort signal if timeoutMs is absent', async () => {
    const seen: any[] = [];
    global.fetch = async (url: any, init?: any) => {
      seen.push({ url, init });
      return new Response('{}', { status: 200 });
    };

    await createFetchExecutor()({ url: 'http://example.com/x', method: 'GET', headers: {} });
    expect(seen[0].init).to.not.have.property('signal');
  });
});

describe('Network', () => {
  it('maps bitcoin to mainnet NETWORK', () => {
    expect(getNetwork('bitcoin')).to.equal(NETWORK);
  });

  it('maps testnet variants to TEST_NETWORK', () => {
    expect(getNetwork('testnet3')).to.equal(TEST_NETWORK);
    expect(getNetwork('testnet4')).to.equal(TEST_NETWORK);
    expect(getNetwork('signet')).to.equal(TEST_NETWORK);
    expect(getNetwork('mutinynet')).to.equal(TEST_NETWORK);
  });

  it('maps regtest to its own bcrt params', () => {
    const regtest = getNetwork('regtest');
    expect(regtest.bech32).to.equal('bcrt');
    expect(regtest.pubKeyHash).to.equal(0x6f);
    expect(regtest.scriptHash).to.equal(0xc4);
    expect(regtest.wif).to.equal(0xef);
  });

  it('throws on unknown network', () => {
    expect(() => getNetwork('unknown')).to.throw('Unknown network "unknown"');
  });
});

describe('Errors', () => {
  it('constructs BitcoinRpcError with all fields', () => {
    const err = new BitcoinRpcError('RPC_ERROR', 1, 'msg', { a: 1 });
    expect(err.type).to.equal('RPC_ERROR');
    expect(err.code).to.equal(1);
    expect(err.message).to.equal('msg');
    expect(err.data).to.deep.equal({ a: 1 });
    expect(err.name).to.equal('BitcoinRpcError');
    expect(err).to.be.instanceOf(Error);
  });

  it('constructs BitcoinRpcError without data', () => {
    const err = new BitcoinRpcError('UNKNOWN_ERROR', 0, 'no data');
    expect(err.data).to.be.undefined;
  });

  it('constructs BitcoinRestError with all fields', () => {
    const err = new BitcoinRestError('rest error', { foo: 'bar' });
    expect(err.message).to.equal('rest error');
    expect(err.data).to.deep.equal({ foo: 'bar' });
    expect(err.name).to.equal('BitcoinRestError');
    expect(err).to.be.instanceOf(Error);
  });

  it('constructs BitcoinRestError without data', () => {
    const err = new BitcoinRestError('no data');
    expect(err.data).to.be.undefined;
  });
});

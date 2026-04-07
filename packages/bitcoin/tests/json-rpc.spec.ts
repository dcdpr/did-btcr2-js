import { expect } from 'chai';
import { JsonRpcTransport } from '../src/client/rpc/json-rpc.js';
import { JsonRpcProtocol } from '../src/client/rpc/protocol.js';
import { BitcoinRpcError } from '../src/errors.js';
import type { HttpExecutor, HttpRequest } from '../src/client/http.js';

// ── JsonRpcProtocol (sans-I/O) ────────────────────────────────────────

describe('JsonRpcProtocol', () => {
  describe('construction', () => {
    it('uses default URL when host is not provided', () => {
      const protocol = new JsonRpcProtocol({});
      expect(protocol.url).to.equal('http://127.0.0.1:8332');
    });

    it('strips trailing slashes from host', () => {
      const protocol = new JsonRpcProtocol({ host: 'http://node:8332///' });
      expect(protocol.url).to.equal('http://node:8332');
    });

    it('handles undefined host string gracefully', () => {
      const protocol = new JsonRpcProtocol({ host: 'undefined' });
      expect(protocol.url).to.equal('undefined');
    });

    it('sets hasAuth to true when credentials exist', () => {
      const protocol = new JsonRpcProtocol({ username: 'u', password: 'p' });
      expect(protocol.hasAuth).to.be.true;
    });

    it('sets hasAuth to false when no credentials', () => {
      const protocol = new JsonRpcProtocol({ host: 'http://node:8332' });
      expect(protocol.hasAuth).to.be.false;
    });
  });

  describe('buildRequest()', () => {
    it('builds a valid JSON-RPC 2.0 request', () => {
      const protocol = new JsonRpcProtocol({ host: 'http://localhost:18443' });
      const req = protocol.buildRequest('getblockcount', []);

      expect(req.url).to.equal('http://localhost:18443');
      expect(req.method).to.equal('POST');
      expect(req.headers['Content-Type']).to.equal('application/json');

      const body = JSON.parse(req.body!);
      expect(body.jsonrpc).to.equal('2.0');
      expect(body.method).to.equal('getblockcount');
      expect(body.params).to.deep.equal([]);
      expect(body.id).to.be.a('number');
    });

    it('includes parameters in the body', () => {
      const protocol = new JsonRpcProtocol({});
      const req = protocol.buildRequest('getblockhash', [100]);
      const body = JSON.parse(req.body!);
      expect(body.params).to.deep.equal([100]);
    });

    it('increments request IDs', () => {
      const protocol = new JsonRpcProtocol({});
      const id1 = JSON.parse(protocol.buildRequest('a', []).body!).id;
      const id2 = JSON.parse(protocol.buildRequest('b', []).body!).id;
      const id3 = JSON.parse(protocol.buildRequest('c', []).body!).id;
      expect(id2).to.equal(id1 + 1);
      expect(id3).to.equal(id2 + 1);
    });

    it('returns independent header objects per request', () => {
      const protocol = new JsonRpcProtocol({});
      const req1 = protocol.buildRequest('a', []);
      const req2 = protocol.buildRequest('b', []);
      req1.headers['X-Mutated'] = 'yes';
      expect(req2.headers['X-Mutated']).to.be.undefined;
    });
  });

  describe('buildBatchRequest()', () => {
    it('builds a JSON array of JSON-RPC calls', () => {
      const protocol = new JsonRpcProtocol({ host: 'http://localhost:18443' });
      const req = protocol.buildBatchRequest([
        { method: 'getblockcount', params: [] },
        { method: 'getblockhash', params: [100] },
      ]);

      expect(req.method).to.equal('POST');
      const body = JSON.parse(req.body!);
      expect(body).to.be.an('array').with.length(2);
      expect(body[0].method).to.equal('getblockcount');
      expect(body[1].method).to.equal('getblockhash');
      expect(body[1].params).to.deep.equal([100]);
      expect(body[0].id).to.not.equal(body[1].id);
    });
  });

  describe('authentication', () => {
    it('adds Basic auth from username/password config', () => {
      const protocol = new JsonRpcProtocol({
        host     : 'http://localhost:18443',
        username : 'user',
        password : 'pass',
      });
      const req = protocol.buildRequest('test', []);
      expect(req.headers['Authorization']).to.match(/^Basic /);
    });

    it('extracts auth from URL and cleans the URL', () => {
      const protocol = new JsonRpcProtocol({ host: 'http://alice:pw@node:8332' });
      expect(protocol.url).to.equal('http://node:8332');
      const req = protocol.buildRequest('test', []);
      expect(req.headers['Authorization']).to.match(/^Basic /);
    });

    it('prefers explicit username/password over URL-embedded credentials', () => {
      const protocol = new JsonRpcProtocol({
        host     : 'http://urluser:urlpass@node:8332',
        username : 'explicituser',
        password : 'explicitpass',
      });
      const req = protocol.buildRequest('test', []);
      const encoded = req.headers['Authorization'].replace('Basic ', '');
      const decoded = Buffer.from(encoded, 'base64').toString('utf8');
      expect(decoded).to.equal('explicituser:explicitpass');
    });

    it('omits Authorization header when no credentials exist', () => {
      const protocol = new JsonRpcProtocol({ host: 'http://node:8332' });
      const req = protocol.buildRequest('test', []);
      expect(req.headers['Authorization']).to.be.undefined;
    });
  });

  describe('parseResponse()', () => {
    it('returns result on success', () => {
      const protocol = new JsonRpcProtocol({});
      expect(protocol.parseResponse({ result: 42 }, 'getblockcount')).to.equal(42);
    });

    it('returns null result', () => {
      const protocol = new JsonRpcProtocol({});
      expect(protocol.parseResponse({ result: null }, 'getblockcount')).to.be.null;
    });

    it('throws BitcoinRpcError on error response', () => {
      const protocol = new JsonRpcProtocol({});
      try {
        protocol.parseResponse({ error: { code: -1, message: 'oops' } }, 'bad');
        expect.fail('Expected to throw');
      } catch (err: any) {
        expect(err).to.be.instanceOf(BitcoinRpcError);
        expect(err.type).to.equal('RPC_ERROR');
        expect(err.code).to.equal(-1);
        expect(err.message).to.equal('oops');
        expect(err.data.method).to.equal('bad');
      }
    });
  });

  describe('parseBatchResponse()', () => {
    it('parses batch responses in correct order', () => {
      const protocol = new JsonRpcProtocol({});
      const calls = [
        { method: 'getblockcount', params: [] as unknown[] },
        { method: 'getblockhash', params: [100] as unknown[] },
      ];
      // Build batch to assign IDs
      protocol.buildBatchRequest(calls);
      // IDs are now (id-1) and (id)
      const id = (protocol as any)._id;
      const results = protocol.parseBatchResponse(
        [
          { id: id, result: 'hash100' },
          { id: id - 1, result: 12345 },
        ],
        calls,
      );
      expect(results).to.deep.equal([12345, 'hash100']);
    });

    it('throws on missing response', () => {
      const protocol = new JsonRpcProtocol({});
      const calls = [{ method: 'getblockcount', params: [] as unknown[] }];
      protocol.buildBatchRequest(calls);
      try {
        protocol.parseBatchResponse([], calls);
        expect.fail('Expected to throw');
      } catch (err: any) {
        expect(err).to.be.instanceOf(BitcoinRpcError);
        expect(err.message).to.include('Missing response');
      }
    });
  });

  describe('redactedHeaders()', () => {
    it('redacts the Authorization header', () => {
      const protocol = new JsonRpcProtocol({ username: 'u', password: 'p' });
      const headers = protocol.redactedHeaders();
      expect(headers.Authorization).to.equal('Basic [REDACTED]');
      expect(headers['Content-Type']).to.equal('application/json');
    });

    it('returns clean headers when no auth is present', () => {
      const protocol = new JsonRpcProtocol({});
      const headers = protocol.redactedHeaders();
      expect(headers.Authorization).to.be.undefined;
    });
  });
});

// ── JsonRpcTransport ───────────────────────────────────────────────────

describe('JsonRpcTransport', () => {
  /** Creates a transport with a mock executor. */
  function createTransport(
    response: { result?: any; error?: any; httpStatus?: number } = {},
    cfg: any = { host: 'http://node:8332' }
  ): { transport: JsonRpcTransport; seen: HttpRequest[] } {
    const seen: HttpRequest[] = [];
    const httpStatus = response.httpStatus ?? 200;
    const body = httpStatus === 200
      ? { result: response.result ?? 'ok', error: response.error }
      : {};

    const executor: HttpExecutor = async (req) => {
      seen.push(req);
      return new Response(JSON.stringify(body), {
        status     : httpStatus,
        statusText : httpStatus === 200 ? 'OK' : 'Error',
        headers    : { 'Content-Type': 'application/json' },
      });
    };

    return { transport: new JsonRpcTransport(cfg, executor), seen };
  }

  /** Creates a transport that supports batch responses. */
  function createBatchTransport(
    cfg: any = { host: 'http://node:8332' }
  ): { transport: JsonRpcTransport; seen: HttpRequest[] } {
    const seen: HttpRequest[] = [];
    const executor: HttpExecutor = async (req) => {
      seen.push(req);
      const reqBody = JSON.parse(req.body!);
      // If it's a batch request (array), return batch response
      if (Array.isArray(reqBody)) {
        const responses = reqBody.map((item: any) => ({
          jsonrpc : '2.0',
          id      : item.id,
          result  : `${item.method}-result`,
        }));
        return new Response(JSON.stringify(responses), {
          status  : 200,
          headers : { 'Content-Type': 'application/json' },
        });
      }
      // Single request
      return new Response(JSON.stringify({ result: `${reqBody.method}-result` }), {
        status  : 200,
        headers : { 'Content-Type': 'application/json' },
      });
    };
    return { transport: new JsonRpcTransport(cfg, executor), seen };
  }

  describe('construction', () => {
    it('exposes protocol and URL', () => {
      const { transport } = createTransport();
      expect(transport.protocol).to.be.instanceOf(JsonRpcProtocol);
      expect(transport.url).to.equal('http://node:8332');
    });

    it('defaults to http://127.0.0.1:8332', () => {
      const { transport } = createTransport({}, {});
      expect(transport.url).to.equal('http://127.0.0.1:8332');
    });
  });

  describe('call() — single call', () => {
    it('returns result from successful RPC call', async () => {
      const { transport } = createTransport({ result: 'blockdata' });
      const result = await transport.call('getblock', ['hash']);
      expect(result).to.equal('blockdata');
    });

    it('sends correct JSON-RPC body', async () => {
      const { transport, seen } = createTransport();
      await transport.call('getblockhash', [1]);

      expect(seen).to.have.length(1);
      const body = JSON.parse(seen[0].body!);
      expect(body.method).to.equal('getblockhash');
      expect(body.params).to.deep.equal([1]);
    });

    it('defaults parameters to empty array', async () => {
      const { transport, seen } = createTransport();
      await transport.call('getblockcount');

      const body = JSON.parse(seen[0].body!);
      expect(body.params).to.deep.equal([]);
    });
  });

  describe('batch() — real JSON-RPC batching', () => {
    it('sends all calls in a single HTTP request', async () => {
      const { transport, seen } = createBatchTransport();
      const results = await transport.batch([
        { method: 'getblockcount', params: [] },
        { method: 'getblockhash', params: [100] },
      ]);
      // Only one HTTP call for the batch
      expect(seen).to.have.length(1);
      const body = JSON.parse(seen[0].body!);
      expect(body).to.be.an('array').with.length(2);
      expect(results).to.deep.equal(['getblockcount-result', 'getblockhash-result']);
    });

    it('throws BitcoinRpcError with HTTP_ERROR on batch non-OK status', async () => {
      const seen: HttpRequest[] = [];
      const executor: HttpExecutor = async (req) => {
        seen.push(req);
        return new Response('Internal Server Error', {
          status     : 502,
          statusText : 'Bad Gateway',
          headers    : { 'Content-Type': 'text/plain' },
        });
      };
      const transport = new JsonRpcTransport({ host: 'http://node:8332' }, executor);
      try {
        await transport.batch([
          { method: 'getblockcount', params: [] },
          { method: 'getblockhash', params: [100] },
        ]);
        expect.fail('Expected HTTP error');
      } catch (err: any) {
        expect(err).to.be.instanceOf(BitcoinRpcError);
        expect(err.type).to.equal('HTTP_ERROR');
        expect(err.code).to.equal(502);
        expect(err.message).to.equal('Internal Server Error');
        expect(err.data.methods).to.deep.equal(['getblockcount', 'getblockhash']);
      }
    });

    it('uses status text fallback when body is empty on batch error', async () => {
      const executor: HttpExecutor = async () => {
        return new Response('', {
          status     : 503,
          statusText : 'Service Unavailable',
        });
      };
      const transport = new JsonRpcTransport({ host: 'http://node:8332' }, executor);
      try {
        await transport.batch([
          { method: 'a', params: [] },
          { method: 'b', params: [] },
        ]);
        expect.fail('Expected HTTP error');
      } catch (err: any) {
        expect(err).to.be.instanceOf(BitcoinRpcError);
        expect(err.message).to.equal('503 Service Unavailable');
      }
    });

    it('returns empty array for empty batch', async () => {
      const { transport, seen } = createBatchTransport();
      const results = await transport.batch([]);
      expect(results).to.deep.equal([]);
      expect(seen).to.have.length(0);
    });

    it('falls back to single call for batch of one', async () => {
      const { transport, seen } = createBatchTransport();
      const results = await transport.batch([{ method: 'getblockcount', params: [] }]);
      expect(results).to.deep.equal(['getblockcount-result']);
      expect(seen).to.have.length(1);
      // Single call sends a plain object, not an array
      const body = JSON.parse(seen[0].body!);
      expect(body).to.not.be.an('array');
    });
  });

  describe('call() — auth forwarding', () => {
    it('includes auth header from URL credentials', async () => {
      const { transport, seen } = createTransport({}, { host: 'http://user:pass@node:8332' });
      await transport.call('test');
      expect(seen[0].headers['Authorization']).to.match(/^Basic/);
    });

    it('includes auth header from explicit credentials', async () => {
      const { transport, seen } = createTransport({}, { host: 'http://node:8332', username: 'alice', password: 'pw' });
      await transport.call('test');
      expect(seen[0].headers['Authorization']).to.match(/^Basic/);
    });
  });

  describe('error handling', () => {
    it('throws BitcoinRpcError with HTTP_ERROR on non-OK status', async () => {
      const { transport } = createTransport({ httpStatus: 500 });
      try {
        await transport.call('bad');
        expect.fail('Expected HTTP error');
      } catch (err: any) {
        expect(err).to.be.instanceOf(BitcoinRpcError);
        expect(err.type).to.equal('HTTP_ERROR');
        expect(err.code).to.equal(500);
      }
    });

    it('uses status text fallback when body is empty on call error', async () => {
      const executor: HttpExecutor = async () => {
        return new Response('', {
          status     : 504,
          statusText : 'Gateway Timeout',
        });
      };
      const transport = new JsonRpcTransport({ host: 'http://node:8332' }, executor);
      try {
        await transport.call('bad');
        expect.fail('Expected HTTP error');
      } catch (err: any) {
        expect(err).to.be.instanceOf(BitcoinRpcError);
        expect(err.message).to.equal('504 Gateway Timeout');
      }
    });

    it('throws BitcoinRpcError with RPC_ERROR on RPC error payload', async () => {
      const { transport } = createTransport({
        result : undefined,
        error  : { code: -1, message: 'oops' },
      });
      try {
        await transport.call('bad');
        expect.fail('Expected RPC error');
      } catch (err: any) {
        expect(err).to.be.instanceOf(BitcoinRpcError);
        expect(err.type).to.equal('RPC_ERROR');
        expect(err.code).to.equal(-1);
        expect(err.message).to.equal('oops');
      }
    });
  });
});

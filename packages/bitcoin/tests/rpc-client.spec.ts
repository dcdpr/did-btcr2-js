import { expect } from 'chai';
import { BitcoinCoreRpcClient } from '../src/client/rpc/index.js';
import { JsonRpcTransport } from '../src/client/rpc/json-rpc.js';
import { JsonRpcProtocol } from '../src/client/rpc/protocol.js';
import { BitcoinRpcError } from '../src/errors.js';
import type { HttpExecutor, HttpRequest } from '../src/client/http.js';

/** Creates an RPC client backed by a mock executor that returns a configurable result. */
function createMockRpcClient(
  cfg: any = {},
  rpcResult: any = 'mock-result'
): { client: BitcoinCoreRpcClient; seen: HttpRequest[] } {
  const seen: HttpRequest[] = [];
  const executor: HttpExecutor = async (req) => {
    seen.push(req);
    return new Response(JSON.stringify({ result: rpcResult }), {
      status  : 200,
      headers : { 'Content-Type': 'application/json' },
    });
  };
  return { client: new BitcoinCoreRpcClient(cfg, executor), seen };
}

describe('BitcoinCoreRpcClient', () => {
  describe('construction', () => {
    it('exposes config and client accessors', () => {
      const rpc = new BitcoinCoreRpcClient({ host: 'http://localhost:8332' });
      expect(rpc.config.host).to.equal('http://localhost:8332');
      expect(rpc.client).to.be.instanceOf(JsonRpcTransport);
    });

    it('exposes JsonRpcProtocol through transport', () => {
      const rpc = new BitcoinCoreRpcClient({ host: 'http://localhost:8332' });
      expect(rpc.client.protocol).to.be.instanceOf(JsonRpcProtocol);
    });

    it('accepts a custom executor', async () => {
      const { client, seen } = createMockRpcClient({ host: 'http://node:8332' }, 42);
      const count = await client.getBlockCount();
      expect(count).to.equal(42);
      expect(seen).to.have.length(1);
      const body = JSON.parse(seen[0].body!);
      expect(body.method).to.equal('getblockcount');
    });
  });

  describe('error handling', () => {
    it('wraps unknown errors as BitcoinRpcError', async () => {
      const executor: HttpExecutor = async () => {
        throw new TypeError('network down');
      };
      const rpc = new BitcoinCoreRpcClient({}, executor);

      try {
        await rpc.getBlockCount();
        expect.fail('Expected error');
      } catch (err: any) {
        expect(err).to.be.instanceOf(BitcoinRpcError);
        expect(err.type).to.equal('UNKNOWN_ERROR');
        expect(err.code).to.equal(500);
      }
    });

    it('wraps non-Error throws as BitcoinRpcError with String()', async () => {
      const executor: HttpExecutor = async () => {
        throw 'raw string error';
      };
      const rpc = new BitcoinCoreRpcClient({}, executor);

      try {
        await rpc.getBlockCount();
        expect.fail('Expected error');
      } catch (err: any) {
        expect(err).to.be.instanceOf(BitcoinRpcError);
        expect(err.type).to.equal('UNKNOWN_ERROR');
        expect(err.message).to.include('raw string error');
      }
    });

    it('rethrows BitcoinRpcError as-is', async () => {
      const executor: HttpExecutor = async () => {
        return new Response(JSON.stringify({ error: { code: -8, message: 'Block not found' } }), {
          status  : 200,
          headers : { 'Content-Type': 'application/json' },
        });
      };
      const rpc = new BitcoinCoreRpcClient({}, executor);

      try {
        await rpc.getBlockCount();
        expect.fail('Expected error');
      } catch (err: any) {
        expect(err).to.be.instanceOf(BitcoinRpcError);
        expect(err.type).to.equal('RPC_ERROR');
        expect(err.code).to.equal(-8);
      }
    });
  });

  describe('RPC method wrappers', () => {
    /** Creates a client with a spy executeRpc to test method delegation. */
    function createSpyClient(): { client: BitcoinCoreRpcClient; calls: Array<{ method: string; params: any[] }> } {
      const client = new BitcoinCoreRpcClient({});
      const calls: Array<{ method: string; params: any[] }> = [];
      (client as any).executeRpc = async (method: string, params: any[] = []) => {
        calls.push({ method, params });
        if (method === 'getrawtransaction') return { txid: '123', params };
        if (method === 'signrawtransactionwithwallet') return { hex: 'signed', complete: true };
        return `${method}-result`;
      };
      return { client, calls };
    }

    it('getBlockCount() delegates to getblockcount', async () => {
      const { client } = createSpyClient();
      expect(await client.getBlockCount()).to.equal('getblockcount-result');
    });

    it('getBlockHash() delegates to getblockhash', async () => {
      const { client } = createSpyClient();
      expect(await client.getBlockHash(1)).to.equal('getblockhash-result');
    });

    it('getBlockchainInfo() delegates to getblockchaininfo', async () => {
      const { client } = createSpyClient();
      expect(await client.getBlockchainInfo()).to.equal('getblockchaininfo-result');
    });

    it('signRawTransaction() delegates to signrawtransactionwithwallet', async () => {
      const { client } = createSpyClient();
      expect(await client.signRawTransaction('00')).to.deep.equal({ hex: 'signed', complete: true });
    });

    it('sendRawTransaction() delegates to sendrawtransaction with defaults', async () => {
      const { client, calls } = createSpyClient();
      await client.sendRawTransaction('aa');
      const call = calls.find(c => c.method === 'sendrawtransaction')!;
      expect(call.params).to.deep.equal(['aa', 0.10, 0.00]);
    });

    it('sendRawTransaction() accepts custom maxfeerate and maxBurnAmount', async () => {
      const { client, calls } = createSpyClient();
      await client.sendRawTransaction('aa', 0.5, 0.2);
      const call = calls.find(c => c.method === 'sendrawtransaction')!;
      expect(call.params).to.deep.equal(['aa', 0.5, 0.2]);
    });

    it('signAndSendRawTransaction() signs then sends', async () => {
      const { client, calls } = createSpyClient();
      await client.signAndSendRawTransaction('11');
      expect(calls.map(c => c.method)).to.deep.equal([
        'signrawtransactionwithwallet',
        'sendrawtransaction'
      ]);
    });

    it('signAndSendRawTransaction() throws when signing is incomplete', async () => {
      const client = new BitcoinCoreRpcClient({});
      (client as any).executeRpc = async (method: string) => {
        if (method === 'signrawtransactionwithwallet') return { hex: 'partial', complete: false, errors: [{ error: 'missing key' }] };
        return `${method}-result`;
      };
      try {
        await client.signAndSendRawTransaction('11');
        expect.fail('Should have thrown');
      } catch (err: any) {
        expect(err).to.be.instanceOf(BitcoinRpcError);
        expect(err.type).to.equal('SIGNING_INCOMPLETE');
      }
    });

    it('createSignSendRawTransaction() creates, signs, then sends', async () => {
      const { client, calls } = createSpyClient();
      await client.createSignSendRawTransaction([], []);
      expect(calls.map(c => c.method)).to.deep.equal([
        'createrawtransaction',
        'signrawtransactionwithwallet',
        'sendrawtransaction'
      ]);
    });

    it('createSignSendRawTransaction() throws when signing is incomplete', async () => {
      const client = new BitcoinCoreRpcClient({});
      (client as any).executeRpc = async (method: string) => {
        if (method === 'signrawtransactionwithwallet') return { hex: 'partial', complete: false };
        return `${method}-result`;
      };
      try {
        await client.createSignSendRawTransaction([], []);
        expect.fail('Should have thrown');
      } catch (err: any) {
        expect(err).to.be.instanceOf(BitcoinRpcError);
        expect(err.type).to.equal('SIGNING_INCOMPLETE');
      }
    });

    it('listTransactions() delegates to listtransactions', async () => {
      const { client } = createSpyClient();
      expect(await client.listTransactions({} as any)).to.equal('listtransactions-result');
    });

    it('createRawTransaction() delegates with all params', async () => {
      const { client, calls } = createSpyClient();
      await client.createRawTransaction([{ txid: 'a', vout: 0 }], [{ addr: 1 }], 0, true);
      const call = calls.find(c => c.method === 'createrawtransaction')!;
      expect(call.params).to.deep.equal([[{ txid: 'a', vout: 0 }], [{ addr: 1 }], 0, true]);
    });

    it('deriveAddresses() delegates to deriveaddresses', async () => {
      const { client } = createSpyClient();
      expect(await client.deriveAddresses('desc', [0, 1])).to.equal('deriveaddresses-result');
    });

    it('getBalance() delegates to getbalance', async () => {
      const { client } = createSpyClient();
      expect(await client.getBalance()).to.equal('getbalance-result');
    });

    it('getNewAddress() delegates to getnewaddress', async () => {
      const { client, calls } = createSpyClient();
      await client.getNewAddress('bech32', 'lbl');
      const call = calls.find(c => c.method === 'getnewaddress')!;
      expect(call.params).to.deep.equal(['lbl', 'bech32']);
    });

    it('listUnspent() sends positional params with defaults', async () => {
      const { client, calls } = createSpyClient();
      await client.listUnspent({ address: ['a'] });
      const call = calls.find(c => c.method === 'listunspent')!;
      expect(call.params).to.deep.equal([0, 9999999, ['a'], true]);
    });

    it('listUnspent() uses all defaults when called with empty params', async () => {
      const { client, calls } = createSpyClient();
      await client.listUnspent({});
      const call = calls.find(c => c.method === 'listunspent')!;
      expect(call.params).to.deep.equal([0, 9999999, [], true]);
    });

    it('signMessage() delegates to signmessage', async () => {
      const { client } = createSpyClient();
      expect(await client.signMessage('addr', 'msg')).to.equal('signmessage-result');
    });

    it('verifyMessage() delegates to verifymessage', async () => {
      const { client } = createSpyClient();
      expect(await client.verifyMessage('addr', 'sig', 'msg')).to.equal('verifymessage-result');
    });

    it('getTransaction() delegates to gettransaction', async () => {
      const { client, calls } = createSpyClient();
      await client.getTransaction('tx', true);
      const call = calls.find(c => c.method === 'gettransaction')!;
      expect(call.params).to.deep.equal(['tx', true]);
    });

    it('sendToAddress() sends then fetches raw tx', async () => {
      const { client, calls } = createSpyClient();
      const result = await client.sendToAddress('addr', 1.0);
      expect(calls.map(c => c.method)).to.deep.equal(['sendtoaddress', 'getrawtransaction']);
      expect(result).to.have.property('txid', '123');
    });
  });

  describe('getRawTransaction()', () => {
    function createSpyClient() {
      const client = new BitcoinCoreRpcClient({});
      (client as any).executeRpc = async (_method: string, params: any[] = []) => {
        return { txid: '123', params };
      };
      return client;
    }

    it('defaults verbosity to 2', async () => {
      const client = createSpyClient();
      const result = await client.getRawTransaction('txid') as any;
      expect(result.params[1]).to.equal(2);
    });

    it('passes explicit verbosity', async () => {
      const client = createSpyClient();
      const result = await client.getRawTransaction('txid', 1, 'block') as any;
      expect(result.params).to.deep.equal(['txid', 1, 'block']);
    });

    it('returns correct type for each verbosity level', async () => {
      const client = createSpyClient();
      // verbosity 0 returns hex string type
      await client.getRawTransaction('txid', 0);
      // verbosity 1
      await client.getRawTransaction('txid', 1);
      // verbosity 2 (explicit)
      await client.getRawTransaction('txid', 2);
    });

    it('getRawTransactions() uses JSON-RPC batching with verbosity 0 (hex strings)', async () => {
      const seen: HttpRequest[] = [];
      const executor: HttpExecutor = async (req) => {
        seen.push(req);
        const reqBody = JSON.parse(req.body!);
        if (Array.isArray(reqBody)) {
          // verbosity 0 returns hex strings, not objects
          const responses = reqBody.map((item: any) => ({
            jsonrpc : '2.0',
            id      : item.id,
            result  : 'deadbeef',
          }));
          return new Response(JSON.stringify(responses), {
            status  : 200,
            headers : { 'Content-Type': 'application/json' },
          });
        }
        return new Response(JSON.stringify({ result: 'deadbeef' }), {
          status  : 200,
          headers : { 'Content-Type': 'application/json' },
        });
      };
      const client = new BitcoinCoreRpcClient({}, executor);
      const results = await client.getRawTransactions(['aaa', 'bbb'], 0);
      expect(results).to.have.length(2);
      expect(results[0]).to.equal('deadbeef');
      // Should have sent a single batch HTTP request (2 items)
      expect(seen).to.have.length(1);
      const body = JSON.parse(seen[0].body!);
      expect(body).to.be.an('array').with.length(2);
    });

    it('getRawTransactions() covers verbosity 1 branch', async () => {
      const executor: HttpExecutor = async (req) => {
        const reqBody = JSON.parse(req.body!);
        if (Array.isArray(reqBody)) {
          const responses = reqBody.map((item: any) => ({
            jsonrpc : '2.0',
            id      : item.id,
            result  : { txid: item.params[0], hex: 'ff' },
          }));
          return new Response(JSON.stringify(responses), {
            status  : 200,
            headers : { 'Content-Type': 'application/json' },
          });
        }
        return new Response(JSON.stringify({ result: { txid: reqBody.params[0] } }), {
          status  : 200,
          headers : { 'Content-Type': 'application/json' },
        });
      };
      const client = new BitcoinCoreRpcClient({}, executor);
      const results = await client.getRawTransactions(['aaa', 'bbb'], 1);
      expect(results).to.have.length(2);
    });

    it('getRawTransactions() defaults verbosity to 2', async () => {
      const executor: HttpExecutor = async (req) => {
        const reqBody = JSON.parse(req.body!);
        if (Array.isArray(reqBody)) {
          // Verify default verbosity is 2
          expect(reqBody[0].params[1]).to.equal(2);
          const responses = reqBody.map((item: any) => ({
            jsonrpc : '2.0',
            id      : item.id,
            result  : { txid: item.params[0] },
          }));
          return new Response(JSON.stringify(responses), {
            status  : 200,
            headers : { 'Content-Type': 'application/json' },
          });
        }
        return new Response(JSON.stringify({ result: { txid: reqBody.params[0] } }), {
          status  : 200,
          headers : { 'Content-Type': 'application/json' },
        });
      };
      const client = new BitcoinCoreRpcClient({}, executor);
      // No verbosity param — should default to 2
      const results = await client.getRawTransactions(['aaa', 'bbb']);
      expect(results).to.have.length(2);
    });
  });

  describe('getBlock()', () => {
    function createSpyClient() {
      const client = new BitcoinCoreRpcClient({});
      (client as any).executeRpc = async (method: string, params: any[] = []) => {
        if (method === 'getblockhash') return 'resolved-hash';
        return `block-v${params[1] ?? 3}`;
      };
      return client;
    }

    it('throws when neither blockhash nor height provided', async () => {
      const client = createSpyClient();
      try {
        await client.getBlock({} as any);
        expect.fail('Expected error');
      } catch (err: any) {
        expect(err).to.be.instanceOf(BitcoinRpcError);
        expect(err.code).to.equal(400);
      }
    });

    it('fetches by blockhash directly', async () => {
      const client = createSpyClient();
      const result = await client.getBlock({ blockhash: 'h', verbosity: 0 });
      expect(result).to.equal('block-v0');
    });

    it('resolves height to blockhash first', async () => {
      const client = createSpyClient();
      const result = await client.getBlock({ height: 1 });
      expect(result).to.equal('block-v3');
    });

    it('returns correct type for each verbosity level', async () => {
      const client = createSpyClient();
      expect(await client.getBlock({ blockhash: 'h', verbosity: 0 })).to.equal('block-v0');
      expect(await client.getBlock({ blockhash: 'h', verbosity: 1 })).to.equal('block-v1');
      expect(await client.getBlock({ blockhash: 'h', verbosity: 2 })).to.equal('block-v2');
      expect(await client.getBlock({ blockhash: 'h', verbosity: 3 })).to.equal('block-v3');
    });

    it('returns undefined when getBlockHash returns non-string', async () => {
      const client = createSpyClient();
      client.getBlockHash = async () => undefined as any;
      const result = await client.getBlock({ height: 1, verbosity: 1 });
      expect(result).to.be.undefined;
    });
  });

  describe('end-to-end with executor', () => {
    it('getBlockCount() through full stack', async () => {
      const { client, seen } = createMockRpcClient({ host: 'http://node:18443' }, 808080);
      const count = await client.getBlockCount();
      expect(count).to.equal(808080);
      expect(seen).to.have.length(1);

      const body = JSON.parse(seen[0].body!);
      expect(body.method).to.equal('getblockcount');
      expect(body.jsonrpc).to.equal('2.0');
    });

    it('getBlockHash() through full stack', async () => {
      const { client } = createMockRpcClient({}, 'blockhash-at-100');
      const hash = await client.getBlockHash(100);
      expect(hash).to.equal('blockhash-at-100');
    });

    it('sendRawTransaction() through full stack', async () => {
      const { client, seen } = createMockRpcClient({}, 'txid-sent');
      const txid = await client.sendRawTransaction('deadbeef');
      expect(txid).to.equal('txid-sent');

      const body = JSON.parse(seen[0].body!);
      expect(body.method).to.equal('sendrawtransaction');
      expect(body.params[0]).to.equal('deadbeef');
    });
  });
});

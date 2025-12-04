import { expect } from 'chai';
import { BitcoinCoreRpcClient, } from '../src/client/rpc/index.js';
import { JsonRpcTransport } from '../src/client/rpc/json-rpc.js';
import { BitcoinRpcError } from '../src/errors.js';

/**
 * BitcoinCoreRpcClient Test Suite
 */
describe('BitcoinCoreRpcClient', () => {
  it('can be initialized', () => {
    const client = BitcoinCoreRpcClient.initialize({ host: 'http://localhost:8332' });
    expect(client).to.be.instanceOf(BitcoinCoreRpcClient);
  });

  it('can connect', () => {
    const client = BitcoinCoreRpcClient.connect({ host: 'http://localhost:8332' });
    expect(client).to.be.instanceOf(BitcoinCoreRpcClient);
  });

  it('exposes config and client accessors', () => {
    const rpc = new BitcoinCoreRpcClient({ host: 'http://localhost:8332' });
    expect(rpc.config.host).to.equal('http://localhost:8332');
    expect(rpc.client).to.be.an.instanceOf(JsonRpcTransport);
  });

  it('identifies JSON-RPC errors', () => {
    const rpc = new BitcoinCoreRpcClient({});
    const err = new Error('bad');
    err.name = 'RpcError';
    (err as any).code = 1;
    expect(rpc.isJsonRpcError(err)).to.equal(true);
    expect(rpc.isJsonRpcError(new Error('nope'))).to.equal(false);
  });

  it('executes RPC calls, normalizes results, and handles errors', async () => {
    const rpc = new BitcoinCoreRpcClient({});
    const calls: any[] = [];
    (rpc as any)._transport = {
      command : async () => {
        const raw = Object.setPrototypeOf({ result: 'ok' }, null);
        calls.push(raw);
        return raw;
      }
    };

    try {
      await (rpc as any).executeRpc('bad');
      expect.fail('Expected rpc error');
    } catch (err: any) {
      expect(err).to.be.instanceOf(BitcoinRpcError);
      expect(err.type).to.equal('UNKNOWN_ERROR');
      expect(err.code).to.equal(500);
    }

    try {
      await (rpc as any).executeRpc('bad2');
      expect.fail('Expected network error');
    } catch (err: any) {
      expect(err).to.be.instanceOf(BitcoinRpcError);
      expect(err.type).to.equal('UNKNOWN_ERROR');
      expect(err.code).to.equal(500);
    }

    try {
      await (rpc as any).executeRpc('bad3');
      expect.fail('Expected unknown error');
    } catch (err: any) {
      expect(err).to.be.instanceOf(BitcoinRpcError);
      expect(err.type).to.equal('UNKNOWN_ERROR');
      expect(err.code).to.equal(500);
    }

    expect([-32700, -32600, -32602].every(code => (rpc as any).mapRpcCodeToHttp(code))).to.be.true;
    expect((rpc as any).mapRpcCodeToHttp(-32601)).to.equal(404);
    expect((rpc as any).mapRpcCodeToHttp(0)).to.equal(422);

    const rpcError = new Error('test');
    rpcError.name = 'RpcError';
    (rpcError as any).code = -32601;
    expect(() => (rpc as any).handleError(rpcError)).to.throw(BitcoinRpcError);

    const networkError = new Error('test');
    networkError.name = 'NetworkError';
    expect(() => (rpc as any).handleError(networkError)).to.throw(BitcoinRpcError);
  });

  it('wraps high level RPC methods', async () => {
    const rpc = new BitcoinCoreRpcClient({});
    const calls: Array<{ method: string; params: any[] }> = [];
    (rpc as any).executeRpc = async (method: string, params: any[] = []) => {
      calls.push({ method, params });
      if (method === 'getrawtransaction') return { txid: '123', params };
      return `${method}-result`;
    };

    expect(await rpc.getBlockCount()).to.equal('getblockcount-result');
    expect(await rpc.getBlockHash(1)).to.equal('getblockhash-result');
    expect(await rpc.getBlockchainInfo()).to.equal('getblockchaininfo-result');
    expect(await rpc.signRawTransaction('00')).to.equal('signrawtransactionwithwallet-result');
    expect(await rpc.sendRawTransaction('aa', 0.1, 0.2)).to.equal('sendrawtransaction-result');
    expect(await rpc.signAndSendRawTransaction('11')).to.equal('sendrawtransaction-result');
    expect(await rpc.createSignSendRawTransaction([], [])).to.equal('sendrawtransaction-result');
    expect(await rpc.listTransactions({} as any)).to.equal('listtransactions-result');
    expect(await rpc.createRawTransaction([], [], 0, true)).to.equal('createrawtransaction-result');
    expect(await rpc.deriveAddresses('desc', [0, 1] as any)).to.equal('deriveaddresses-result');
    expect(await rpc.getBalance()).to.equal('getbalance-result');
    expect(await rpc.getNewAddress('bech32', 'lbl')).to.equal('getnewaddress-result');
    expect(await rpc.listUnspent({ address: ['a'] })).to.equal('listunspent-result');
    expect(await rpc.signMessage('addr', 'msg')).to.equal('signmessage-result');
    expect(await rpc.verifyMessage('addr', 'sig', 'msg')).to.equal('verifymessage-result');
    expect(await rpc.getTransaction('tx', true)).to.equal('gettransaction-result');
    expect(await rpc.getRawTransaction('tx', 1, 'block')).to.deep.equal({ txid: '123', params: ['tx', 1, 'block'] });
    expect(await rpc.getRawTransactions(['a', 'b'], 0)).to.deep.equal([
      { txid: '123', params: ['a', 0, undefined] },
      { txid: '123', params: ['b', 0, undefined] },
    ]);

    let block = await rpc.getBlock({ blockhash: 'h', height: undefined, verbosity: 0 });
    block = await rpc.getBlock({ blockhash: undefined, height: 1 });
    block = await rpc.getBlock({ blockhash: undefined, height: 1, verbosity: 1 });
    block = await rpc.getBlock({ blockhash: undefined, height: 1, verbosity: 2 });
    block = await rpc.getBlock({ blockhash: undefined, height: 1, verbosity: 3 });
    expect(block).to.equal('getblock-result');

    rpc.getBlockHash = async () => {
      return undefined as any as string;
    };
    await rpc.getBlock({ blockhash: undefined, height: 1, verbosity: 1 });
    expect(block).to.equal('getblock-result');

    try {
      await rpc.getBlock({} as any);
      expect.fail('Expected getBlock error');
    } catch (err: any) {
      expect(err.code).to.equal(400);
    }

    expect(calls.find(c => c.method === 'listunspent')!.params[0].minconf).to.equal(0);

    const send = await rpc.sendToAddress('addr', 1.0);
    expect(send).to.deep.equal(
      { txid: '123', params: [ 'sendtoaddress-result', 2, undefined ] }
    );

    const raw = await rpc.getRawTransaction('txid123', 2);
    expect(raw).to.deep.equal(
      { txid: '123', params: ['txid123', 2, undefined] },
    );
  });
});

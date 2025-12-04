import { expect } from 'chai';
import { BitcoinAddress } from '../src/client/rest/address.js';
import { BitcoinBlock } from '../src/client/rest/block.js';
import { BitcoinRestClient } from '../src/client/rest/index.js';
import { BitcoinTransaction } from '../src/client/rest/transaction.js';
import { DEFAULT_BITCOIN_NETWORK_CONFIG } from '../src/constants.js';
import { BitcoinRestError } from '../src/errors.js';
import { RestClientConfig } from '../src/types.js';

/**
 * BitcoinRestClient Test Suite
 */
describe('BitcoinRestClient', () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it('connects with default config', () => {
    const rest = BitcoinRestClient.connect();
    expect(rest.config.host).to.equal(DEFAULT_BITCOIN_NETWORK_CONFIG.regtest.rest.host);
  });

  it('calls endpoints and handles JSON/text and errors', async () => {
    const rest = new BitcoinRestClient(new RestClientConfig({ host: 'http://example.com/' }));
    const calls: any[] = [];

    global.fetch = async (url: any, init?: any) => {
      calls.push({ url, init });
      return {
        ok         : true,
        status     : 200,
        statusText : 'OK',
        headers    : new Headers({ 'Content-Type': 'application/json' }),
        json       : async () => ({ ok: true }),
        text       : async () => 'text',
      } as any;
    };

    const data = await (rest as any).call({ path: '/demo', body: { a: 1 } });
    expect(data).to.deep.equal({ ok: true });
    expect(calls[0].url).to.equal('http://example.com/demo');
    expect(calls[0].init.method).to.equal('POST');

    global.fetch = async () => ({
      ok         : false,
      status     : 500,
      statusText : 'Fail',
      headers    : new Headers({ 'Content-Type': 'text/plain' }),
      json       : async () => ({ error: true }),
      text       : async () => 'bad',
    } as any);

    try {
      await (rest as any).call({ path: '/error' });
      expect.fail('Expected to throw');
    } catch (err: any) {
      expect(err).to.be.instanceOf(Error);
      expect(err.message).to.include('Request to http://example.com/error failed');
    }
  });

  it('handles block calls (count, lookups, validation, etc)', async () => {
    const seen: string[] = [];
    const api = async ({ path }: any) => {
      seen.push(path);
      if (path.includes('/block-height')) return 'HASH123';
      if (path.includes('/blocks')) return 12345;
      return { block: path };
    };
    const block = new BitcoinBlock(api);

    try {
      await block.get({});
      expect.fail('Should have thrown for missing params');
    } catch (err) {
      expect(err).to.be.instanceOf(BitcoinRestError);
    }

    const byHash = await block.get({ blockhash: 'abc' });
    expect((byHash as any).block).to.equal('/block/abc');

    const byHeight = await block.get({ height: 1 });
    expect((byHeight as any).block).to.equal('/block/HASH123');

    const count = await block.count();
    expect(count).to.equal(12345);

    block.getHash = async () => {
      return undefined as any as string;
    };
    const missing = await block.get({ height: 2 });
    expect(missing).to.equal(undefined);
  });

  it('handles address endpoints', async () => {
    const api = async ({ path }: any) => ({ path });
    const address = new BitcoinAddress(api);
    expect(await address.getTxs('addr')).to.deep.equal({ path: '/address/addr/txs' });
    expect(await address.getTxsMempool('addr')).to.deep.equal({ path: '/address/addr/txs/mempool' });
    expect(await address.getInfo('addr')).to.deep.equal({ path: '/address/addr' });
    expect(await address.getConfirmedTxs('addr')).to.deep.equal({ path: '/address/addr/txs/chain' });
    expect(await address.getConfirmedTxs('addr', 'last')).to.deep.equal({ path: '/address/addr/txs/chain/last' });
    expect(await address.getUtxos('addr')).to.deep.equal({ path: '/address/addr/utxo' });

    class TestAddress extends BitcoinAddress {
      async getConfirmedTxs(): Promise<any[]> {
        return [
          { status: { confirmed: false } },
          { status: { confirmed: true } },
        ] as any;
      }
    }
    const tester = new TestAddress(api);
    expect(await tester.isFundedAddress('addr')).to.equal(true);
  });

  it('handles transaction endpoints', async () => {
    const api = async ({ path, method, body }: any) => {
      if (path.startsWith('/tx/txid')) {
        return { path, method, body, status: { confirmed: false } };
      }
      return { path, method, body };
    };
    const tx = new BitcoinTransaction(api);
    expect(await tx.get('txid')).to.deep.equal({ path: '/tx/txid', method: undefined, body: undefined, status: { confirmed: false } });
    expect(await tx.isConfirmed('txid')).to.equal(false);
    expect(await tx.getHex('txid')).to.deep.equal({ path: '/tx/txid/hex', method: undefined, body: undefined, status: { confirmed: false } });
    expect(await tx.getRaw('txid')).to.deep.equal({ path: '/tx/txid/raw', method: undefined, body: undefined, status: { confirmed: false } });
    expect(await tx.send('rawtx')).to.deep.equal({ path: '/tx', method: 'POST', body: 'rawtx' });
  });
});
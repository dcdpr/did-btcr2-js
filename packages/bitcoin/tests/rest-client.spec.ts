import { expect } from 'chai';
import { BitcoinAddress } from '../src/client/rest/address.js';
import { BitcoinBlock } from '../src/client/rest/block.js';
import { BitcoinRestClient } from '../src/client/rest/index.js';
import { BitcoinTransaction } from '../src/client/rest/transaction.js';
import { EsploraProtocol } from '../src/client/rest/protocol.js';
import { DEFAULT_BITCOIN_NETWORK_CONFIG } from '../src/constants.js';
import { BitcoinRestError } from '../src/errors.js';
import type { HttpExecutor, HttpRequest } from '../src/client/http.js';

const VALID_TXID = 'a'.repeat(64);
const VALID_HASH = 'b'.repeat(64);

/** Creates a mock executor that records requests and returns configured responses. */
function mockExecutor(
  response: { status?: number; body?: any; contentType?: string } = {}
): { executor: HttpExecutor; seen: HttpRequest[] } {
  const seen: HttpRequest[] = [];
  const status = response.status ?? 200;
  const contentType = response.contentType ?? 'application/json';
  const body = typeof response.body === 'string'
    ? response.body
    : JSON.stringify(response.body ?? {});

  const executor: HttpExecutor = async (req) => {
    seen.push(req);
    return new Response(body, {
      status,
      statusText : status === 200 ? 'OK' : 'Error',
      headers    : { 'Content-Type': contentType },
    });
  };

  return { executor, seen };
}

/** Creates a protocol + mock exec pair for isolated sub-client tests. */
function createMockSubClient() {
  const protocol = new EsploraProtocol({ host: 'https://test.com' });
  const seen: HttpRequest[] = [];
  const exec = async (req: HttpRequest) => {
    seen.push(req);
    // Return a response that lets us inspect what was requested
    if (req.url.includes('/blocks/tip/height')) return 12345;
    if (req.url.includes('/block-height/')) return VALID_HASH;
    if (req.url.includes('/block/')) return { hash: VALID_HASH };
    if (req.url.includes('/tx/') && req.url.endsWith('/hex')) return 'deadbeef';
    if (req.url.includes('/tx/') && req.url.endsWith('/raw')) return new Uint8Array([0xde, 0xad]);
    if (req.url.includes('/tx') && req.method === 'POST') return VALID_TXID;
    if (req.url.includes('/tx/')) return { txid: VALID_TXID, status: { confirmed: false } };
    if (req.url.includes('/utxo')) return [{ txid: VALID_TXID, vout: 0, value: 5000 }];
    if (req.url.includes('/address/') && req.url.endsWith('/txs/chain')) return [{ status: { confirmed: true } }];
    if (req.url.includes('/address/') && req.url.endsWith('/txs/mempool')) return [];
    if (req.url.includes('/address/') && req.url.endsWith('/txs')) return [{ status: { confirmed: true } }];
    if (req.url.includes('/address/')) return { address: 'addr1' };
    return {};
  };
  return { protocol, exec, seen };
}

describe('EsploraProtocol', () => {
  const protocol = new EsploraProtocol({ host: 'https://mempool.space/api' });

  describe('transaction requests', () => {
    it('builds GET /tx/:txid', () => {
      const req = protocol.getTx(VALID_TXID);
      expect(req.url).to.equal(`https://mempool.space/api/tx/${VALID_TXID}`);
      expect(req.method).to.equal('GET');
      expect(req.body).to.be.undefined;
      expect(req.headers['Content-Type']).to.equal('application/json');
    });

    it('builds GET /tx/:txid/hex', () => {
      const req = protocol.getTxHex(VALID_TXID);
      expect(req.url).to.equal(`https://mempool.space/api/tx/${VALID_TXID}/hex`);
      expect(req.method).to.equal('GET');
    });

    it('builds GET /tx/:txid/raw', () => {
      const req = protocol.getTxRaw(VALID_TXID);
      expect(req.url).to.equal(`https://mempool.space/api/tx/${VALID_TXID}/raw`);
      expect(req.method).to.equal('GET');
    });

    it('builds POST /tx with text/plain body', () => {
      const req = protocol.postTx('deadbeef');
      expect(req.url).to.equal('https://mempool.space/api/tx');
      expect(req.method).to.equal('POST');
      expect(req.body).to.equal('deadbeef');
      expect(req.headers['Content-Type']).to.equal('text/plain');
    });

    it('rejects invalid txid', () => {
      expect(() => protocol.getTx('invalid')).to.throw('Invalid txid');
      expect(() => protocol.getTxHex('../etc/passwd')).to.throw('Invalid txid');
      expect(() => protocol.getTxRaw('short')).to.throw('Invalid txid');
    });
  });

  describe('block requests', () => {
    it('builds GET /blocks/tip/height', () => {
      const req = protocol.getBlockTipHeight();
      expect(req.url).to.equal('https://mempool.space/api/blocks/tip/height');
      expect(req.method).to.equal('GET');
    });

    it('builds GET /block/:blockhash', () => {
      const req = protocol.getBlock(VALID_HASH);
      expect(req.url).to.equal(`https://mempool.space/api/block/${VALID_HASH}`);
    });

    it('builds GET /block-height/:height', () => {
      const req = protocol.getBlockHeight(100);
      expect(req.url).to.equal('https://mempool.space/api/block-height/100');
    });

    it('rejects invalid blockhash', () => {
      expect(() => protocol.getBlock('invalid')).to.throw('Invalid blockhash');
    });
  });

  describe('address requests', () => {
    it('builds GET /address/:address/txs', () => {
      const req = protocol.getAddressTxs('addr1');
      expect(req.url).to.equal('https://mempool.space/api/address/addr1/txs');
    });

    it('builds GET /address/:address/txs/mempool', () => {
      const req = protocol.getAddressTxsMempool('addr1');
      expect(req.url).to.equal('https://mempool.space/api/address/addr1/txs/mempool');
    });

    it('builds GET /address/:address/txs/chain without lastSeenTxId', () => {
      const req = protocol.getAddressTxsChain('addr1');
      expect(req.url).to.equal('https://mempool.space/api/address/addr1/txs/chain');
    });

    it('builds GET /address/:address/txs/chain/:last_seen_txid', () => {
      const req = protocol.getAddressTxsChain('addr1', VALID_TXID);
      expect(req.url).to.equal(`https://mempool.space/api/address/addr1/txs/chain/${VALID_TXID}`);
    });

    it('builds GET /address/:address', () => {
      const req = protocol.getAddressInfo('addr1');
      expect(req.url).to.equal('https://mempool.space/api/address/addr1');
    });

    it('builds GET /address/:address/utxo', () => {
      const req = protocol.getAddressUtxos('addr1');
      expect(req.url).to.equal('https://mempool.space/api/address/addr1/utxo');
    });

    it('rejects address with illegal characters', () => {
      expect(() => protocol.getAddressTxs('../etc')).to.throw('Invalid address');
      expect(() => protocol.getAddressInfo('addr/evil')).to.throw('Invalid address');
      expect(() => protocol.getAddressUtxos('')).to.throw('Invalid address');
    });

    it('rejects invalid lastSeenTxId', () => {
      expect(() => protocol.getAddressTxsChain('addr1', 'bad')).to.throw('Invalid lastSeenTxId');
    });
  });

  describe('config handling', () => {
    it('strips trailing slash from host', () => {
      const p = new EsploraProtocol({ host: 'https://example.com/' });
      expect(p.getTx(VALID_TXID).url).to.equal(`https://example.com/tx/${VALID_TXID}`);
    });

    it('includes custom headers from config', () => {
      const p = new EsploraProtocol({
        host    : 'https://example.com',
        headers : { 'X-Custom': 'value' },
      });
      const req = p.getTx(VALID_TXID);
      expect(req.headers['X-Custom']).to.equal('value');
      expect(req.headers['Content-Type']).to.equal('application/json');
    });

    it('returns independent header objects per request', () => {
      const req1 = protocol.getTx(VALID_TXID);
      const req2 = protocol.getTx(VALID_TXID);
      req1.headers['X-Mutated'] = 'yes';
      expect(req2.headers['X-Mutated']).to.be.undefined;
    });
  });
});



describe('BitcoinRestClient', () => {
  describe('construction', () => {
    it('constructs with config and exposes protocol', () => {
      const rest = new BitcoinRestClient(DEFAULT_BITCOIN_NETWORK_CONFIG.regtest.rest);
      expect(rest.config.host).to.equal(DEFAULT_BITCOIN_NETWORK_CONFIG.regtest.rest.host);
      expect(rest.protocol).to.be.instanceOf(EsploraProtocol);
    });

    it('accepts a custom executor', async () => {
      const { executor, seen } = mockExecutor({ body: { txid: VALID_TXID, status: { confirmed: false } } });
      const rest = new BitcoinRestClient({ host: 'https://example.com' }, executor);

      const tx = await rest.transaction.get(VALID_TXID);
      expect(tx.txid).to.equal(VALID_TXID);
      expect(seen).to.have.length(1);
      expect(seen[0].url).to.equal(`https://example.com/tx/${VALID_TXID}`);
      expect(seen[0].method).to.equal('GET');
    });
  });

  describe('response handling', () => {
    it('returns text for text/plain content type', async () => {
      const { executor } = mockExecutor({ body: '12345', contentType: 'text/plain' });
      const rest = new BitcoinRestClient({ host: 'http://example.com' }, executor);
      const height = await rest.block.count();
      expect(height).to.equal('12345');
    });

    it('throws MethodError on non-OK responses', async () => {
      const { executor } = mockExecutor({ status: 500, body: { error: 'internal' } });
      const rest = new BitcoinRestClient({ host: 'http://example.com' }, executor);

      try {
        await rest.block.count();
        expect.fail('Expected to throw');
      } catch (err: any) {
        expect(err).to.be.instanceOf(Error);
        expect(err.message).to.include('failed');
        expect(err.message).to.include('500');
      }
    });

    it('throws on text/plain error response', async () => {
      const { executor } = mockExecutor({ status: 400, body: 'Bad request', contentType: 'text/plain' });
      const rest = new BitcoinRestClient({ host: 'http://example.com' }, executor);
      try {
        await rest.block.count();
        expect.fail('Expected to throw');
      } catch (err: any) {
        expect(err).to.be.instanceOf(Error);
        expect(err.message).to.include('400');
      }
    });

    it('handles response with no Content-Type header', async () => {
      const seen: HttpRequest[] = [];
      const executor: HttpExecutor = async (req) => {
        seen.push(req);
        // Response constructor with string body sets Content-Type: text/plain by default,
        // so we explicitly override to empty to test the fallback branch.
        const res = new Response(JSON.stringify(12345), {
          status  : 200,
          headers : { 'Content-Type': '' },
        });
        return res;
      };
      const rest = new BitcoinRestClient({ host: 'http://example.com' }, executor);
      const height = await rest.block.count();
      expect(height).to.equal(12345);
    });

    it('merges config headers into requests', async () => {
      const { executor, seen } = mockExecutor({ body: {} });
      const rest = new BitcoinRestClient(
        { host: 'http://example.com', headers: { 'X-Api-Key': 'secret' } },
        executor
      );

      await rest.block.count();
      expect(seen[0].headers['X-Api-Key']).to.equal('secret');
      expect(seen[0].headers['Content-Type']).to.equal('application/json');
    });
  });
});

describe('BitcoinTransaction', () => {
  it('get() delegates to protocol.getTx()', async () => {
    const { protocol, exec, seen } = createMockSubClient();
    const tx = new BitcoinTransaction(protocol, exec);

    const result = await tx.get(VALID_TXID);
    expect(seen).to.have.length(1);
    expect(seen[0].url).to.include(`/tx/${VALID_TXID}`);
    expect(seen[0].method).to.equal('GET');
    expect(result).to.have.property('txid');
  });

  it('isConfirmed() returns boolean from tx status', async () => {
    const { protocol, exec } = createMockSubClient();
    const tx = new BitcoinTransaction(protocol, exec);
    expect(await tx.isConfirmed(VALID_TXID)).to.equal(false);
  });

  it('getHex() delegates to protocol.getTxHex()', async () => {
    const { protocol, exec, seen } = createMockSubClient();
    const tx = new BitcoinTransaction(protocol, exec);

    const result = await tx.getHex(VALID_TXID);
    expect(seen[0].url).to.include(`/tx/${VALID_TXID}/hex`);
    expect(result).to.equal('deadbeef');
  });

  it('getRaw() delegates to protocol.getTxRaw()', async () => {
    const { protocol, exec, seen } = createMockSubClient();
    const tx = new BitcoinTransaction(protocol, exec);

    await tx.getRaw(VALID_TXID);
    expect(seen[0].url).to.include(`/tx/${VALID_TXID}/raw`);
  });

  it('send() delegates to protocol.postTx()', async () => {
    const { protocol, exec, seen } = createMockSubClient();
    const tx = new BitcoinTransaction(protocol, exec);

    await tx.send('rawtxhex');
    expect(seen[0].url).to.include('/tx');
    expect(seen[0].method).to.equal('POST');
    expect(seen[0].body).to.equal('rawtxhex');
  });

  it('works end-to-end through BitcoinRestClient with executor', async () => {
    const mockTx = { txid: VALID_TXID, status: { confirmed: true, block_height: 100, block_hash: 'h', block_time: 0 } };
    const { executor } = mockExecutor({ body: mockTx });
    const rest = new BitcoinRestClient({ host: 'http://node' }, executor);

    const tx = await rest.transaction.get(VALID_TXID);
    expect(tx.txid).to.equal(VALID_TXID);
    expect(await rest.transaction.isConfirmed(VALID_TXID)).to.equal(true);
  });
});

describe('BitcoinBlock', () => {
  it('count() delegates to protocol.getBlockTipHeight()', async () => {
    const { protocol, exec, seen } = createMockSubClient();
    const block = new BitcoinBlock(protocol, exec);

    expect(await block.count()).to.equal(12345);
    expect(seen[0].url).to.include('/blocks/tip/height');
  });

  it('get() by blockhash delegates to protocol.getBlock()', async () => {
    const { protocol, exec, seen } = createMockSubClient();
    const block = new BitcoinBlock(protocol, exec);

    const result = await block.get({ blockhash: VALID_HASH });
    expect(seen[0].url).to.include(`/block/${VALID_HASH}`);
    expect(result).to.have.property('hash');
  });

  it('get() by height resolves hash first', async () => {
    const { protocol, exec, seen } = createMockSubClient();
    const block = new BitcoinBlock(protocol, exec);

    await block.get({ height: 1 });
    expect(seen[0].url).to.include('/block-height/1');
    expect(seen[1].url).to.include(`/block/${VALID_HASH}`);
  });

  it('get() throws BitcoinRestError when neither blockhash nor height provided', async () => {
    const { protocol, exec } = createMockSubClient();
    const block = new BitcoinBlock(protocol, exec);

    try {
      await block.get({});
      expect.fail('Should have thrown');
    } catch (err) {
      expect(err).to.be.instanceOf(BitcoinRestError);
    }
  });

  it('get() returns undefined when getHash returns non-string', async () => {
    const protocol = new EsploraProtocol({ host: 'https://test.com' });
    const exec = async () => undefined;
    const block = new BitcoinBlock(protocol, exec);
    const result = await block.get({ height: 999 });
    expect(result).to.be.undefined;
  });

  it('getHash() delegates to protocol.getBlockHeight()', async () => {
    const { protocol, exec, seen } = createMockSubClient();
    const block = new BitcoinBlock(protocol, exec);

    expect(await block.getHash(42)).to.equal(VALID_HASH);
    expect(seen[0].url).to.include('/block-height/42');
  });

  it('works end-to-end through BitcoinRestClient with executor', async () => {
    const { executor } = mockExecutor({ body: 808080 });
    const rest = new BitcoinRestClient({ host: 'http://node' }, executor);
    const height = await rest.block.count();
    expect(height).to.equal(808080);
  });
});

describe('BitcoinAddress', () => {
  it('getTxs() delegates to protocol.getAddressTxs()', async () => {
    const { protocol, exec, seen } = createMockSubClient();
    const address = new BitcoinAddress(protocol, exec);

    await address.getTxs('addr1');
    expect(seen[0].url).to.include('/address/addr1/txs');
    expect(seen[0].url).not.to.include('mempool');
  });

  it('getTxsMempool() delegates to protocol.getAddressTxsMempool()', async () => {
    const { protocol, exec, seen } = createMockSubClient();
    const address = new BitcoinAddress(protocol, exec);

    await address.getTxsMempool('addr1');
    expect(seen[0].url).to.include('/address/addr1/txs/mempool');
  });

  it('getInfo() delegates to protocol.getAddressInfo()', async () => {
    const { protocol, exec, seen } = createMockSubClient();
    const address = new BitcoinAddress(protocol, exec);

    await address.getInfo('addr1');
    expect(seen[0].url).to.include('/address/addr1');
    expect(seen[0].url).not.to.include('/txs');
    expect(seen[0].url).not.to.include('/utxo');
  });

  it('getConfirmedTxs() delegates to protocol.getAddressTxsChain()', async () => {
    const { protocol, exec, seen } = createMockSubClient();
    const address = new BitcoinAddress(protocol, exec);

    await address.getConfirmedTxs('addr1');
    expect(seen[0].url).to.include('/address/addr1/txs/chain');
  });

  it('getConfirmedTxs() with lastSeenTxId includes it in path', async () => {
    const { protocol, exec, seen } = createMockSubClient();
    const address = new BitcoinAddress(protocol, exec);

    await address.getConfirmedTxs('addr1', VALID_TXID);
    expect(seen[0].url).to.include(`/address/addr1/txs/chain/${VALID_TXID}`);
  });

  it('getUtxos() delegates to protocol.getAddressUtxos()', async () => {
    const { protocol, exec, seen } = createMockSubClient();
    const address = new BitcoinAddress(protocol, exec);

    await address.getUtxos('addr1');
    expect(seen[0].url).to.include('/address/addr1/utxo');
  });

  it('isFundedAddress() returns true when confirmed txs exist', async () => {
    const protocol = new EsploraProtocol({ host: 'https://test.com' });
    const exec = async () => [
      { status: { confirmed: false } },
      { status: { confirmed: true } },
    ];
    const address = new BitcoinAddress(protocol, exec);
    expect(await address.isFundedAddress('addr1')).to.equal(true);
  });

  it('isFundedAddress() returns false when no confirmed txs', async () => {
    const protocol = new EsploraProtocol({ host: 'https://test.com' });
    const exec = async () => [{ status: { confirmed: false } }];
    const address = new BitcoinAddress(protocol, exec);
    expect(await address.isFundedAddress('addr1')).to.equal(false);
  });

  it('works end-to-end through BitcoinRestClient with executor', async () => {
    const utxos = [{ txid: VALID_TXID, vout: 0, value: 5000, status: { confirmed: true } }];
    const { executor } = mockExecutor({ body: utxos });
    const rest = new BitcoinRestClient({ host: 'http://node' }, executor);

    const result = await rest.address.getUtxos('myaddr');
    expect(result).to.deep.equal(utxos);
  });
});

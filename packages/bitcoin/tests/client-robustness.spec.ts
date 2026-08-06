import { expect } from 'chai';
import { BitcoinRestClient } from '../src/client/rest/index.js';
import { BitcoinCoreRpcClient } from '../src/client/rpc/index.js';
import { BitcoinConnection } from '../src/connection.js';
import { BitcoinRpcError, BitcoinRestError } from '../src/errors.js';
import type { HttpExecutor } from '../src/client/http.js';
import { DEFAULT_MAX_RESPONSE_BYTES } from '../src/client/utils.js';

const VALID_TXID = 'a'.repeat(64);

/** Minimal Esplora tx fixture accepted by the response validators. */
function restTx(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return { txid: VALID_TXID, vin: [], vout: [], status: { confirmed: false }, ...overrides };
}

/** Executor returning a JSON body with a 200 status. */
function jsonExecutor(body: unknown): HttpExecutor {
  return async () => new Response(JSON.stringify(body), {
    status  : 200,
    headers : { 'Content-Type': 'application/json' },
  });
}

describe('client robustness (audit M9, M11, L14)', () => {
  describe('response size cap (M11)', () => {
    it('REST rejects a body whose declared Content-Length exceeds the cap', async () => {
      const executor: HttpExecutor = async () => new Response('{}', {
        status  : 200,
        headers : { 'Content-Type': 'application/json', 'Content-Length': String(DEFAULT_MAX_RESPONSE_BYTES + 1) },
      });
      const rest = new BitcoinRestClient({ host: 'http://node' }, executor);
      try {
        await rest.transaction.get(VALID_TXID);
        expect.fail('Expected to throw');
      } catch (err: any) {
        expect(err.message).to.include('exceeds');
        expect(err.type).to.equal('INVALID_RESPONSE_BODY');
      }
    });

    it('REST rejects a streamed body that grows past the cap without a Content-Length', async () => {
      const chunk = new Uint8Array(64);
      const stream = new ReadableStream<Uint8Array>({
        async start(controller) {
          // Push well past the small configured cap in repeated chunks.
          for (let i = 0; i < 100; i++) controller.enqueue(chunk);
          controller.close();
        },
      });
      const executor: HttpExecutor = async () => new Response(stream, {
        status  : 200,
        headers : { 'Content-Type': 'application/json' },
      });
      const rest = new BitcoinRestClient({ host: 'http://node', maxResponseBytes: 1024 }, executor);
      try {
        await rest.transaction.get(VALID_TXID);
        expect.fail('Expected to throw');
      } catch (err: any) {
        expect(err.message).to.include('exceeds');
        expect(err.type).to.equal('INVALID_RESPONSE_BODY');
      }
    });

    it('REST accepts a body within a custom maxResponseBytes', async () => {
      const rest = new BitcoinRestClient(
        { host: 'http://node', maxResponseBytes: 1024 * 1024 },
        jsonExecutor(restTx())
      );
      const tx = await rest.transaction.get(VALID_TXID);
      expect(tx.txid).to.equal(VALID_TXID);
    });

    it('RPC rejects an oversized body with a typed error', async () => {
      const executor: HttpExecutor = async () => new Response('{}', {
        status  : 200,
        headers : { 'Content-Type': 'application/json', 'Content-Length': String(DEFAULT_MAX_RESPONSE_BYTES + 1) },
      });
      const rpc = new BitcoinCoreRpcClient({ host: 'http://node' }, executor);
      try {
        await rpc.getBlockCount();
        expect.fail('Expected to throw');
      } catch (err: any) {
        expect(err).to.be.instanceOf(BitcoinRpcError);
        expect(err.type).to.equal('INVALID_RESPONSE');
        expect(err.message).to.include('exceeds');
      }
    });

    it('RPC wraps an invalid JSON body in a typed error instead of a raw SyntaxError', async () => {
      const executor: HttpExecutor = async () => new Response('not json', {
        status  : 200,
        headers : { 'Content-Type': 'application/json' },
      });
      const rpc = new BitcoinCoreRpcClient({ host: 'http://node' }, executor);
      try {
        await rpc.getBlockCount();
        expect.fail('Expected to throw');
      } catch (err: any) {
        expect(err).to.be.instanceOf(BitcoinRpcError);
        expect(err.type).to.equal('INVALID_RESPONSE');
      }
    });
  });

  describe('REST structural validation (M11)', () => {
    const rest = (body: unknown) => new BitcoinRestClient({ host: 'http://node' }, jsonExecutor(body));

    it('rejects a transaction missing vin/vout arrays', async () => {
      try {
        await rest({ txid: VALID_TXID, status: { confirmed: false } }).transaction.get(VALID_TXID);
        expect.fail('Expected to throw');
      } catch (err: any) {
        expect(err).to.be.instanceOf(BitcoinRestError);
        expect(err.message).to.include('vin is not an array');
      }
    });

    it('rejects a transaction with a non-boolean status.confirmed', async () => {
      try {
        await rest(restTx({ status: { confirmed: 'yes' } })).transaction.get(VALID_TXID);
        expect.fail('Expected to throw');
      } catch (err: any) {
        expect(err.message).to.include('status.confirmed is not a boolean');
      }
    });

    it('rejects a confirmed transaction without a block height', async () => {
      try {
        await rest(restTx({ status: { confirmed: true } })).transaction.get(VALID_TXID);
        expect.fail('Expected to throw');
      } catch (err: any) {
        expect(err.message).to.include('block_height');
      }
    });

    it('rejects a vout entry with a negative value', async () => {
      const tx = restTx({ vout: [{ scriptpubkey: '6a', value: -5 }] });
      try {
        await rest(tx).transaction.get(VALID_TXID);
        expect.fail('Expected to throw');
      } catch (err: any) {
        expect(err.message).to.include('vout[0].value');
      }
    });

    it('rejects utxos with a fractional satoshi value', async () => {
      const utxos = [{ txid: VALID_TXID, vout: 0, value: 5000.5, status: { confirmed: false } }];
      try {
        await rest(utxos).address.getUtxos('addr');
        expect.fail('Expected to throw');
      } catch (err: any) {
        expect(err.message).to.include('utxo.value');
      }
    });

    it('rejects utxos with a malformed txid', async () => {
      const utxos = [{ txid: 'short', vout: 0, value: 5000, status: { confirmed: false } }];
      try {
        await rest(utxos).address.getUtxos('addr');
        expect.fail('Expected to throw');
      } catch (err: any) {
        expect(err.message).to.include('utxo.txid');
      }
    });

    it('rejects a non-array address txs response', async () => {
      try {
        await rest({ not: 'an array' }).address.getTxs('addr');
        expect.fail('Expected to throw');
      } catch (err: any) {
        expect(err.message).to.include('expected an array');
      }
    });

    it('rejects a garbage tip height', async () => {
      const executor: HttpExecutor = async () => new Response('tip height unavailable', {
        status  : 200,
        headers : { 'Content-Type': 'text/plain' },
      });
      const client = new BitcoinRestClient({ host: 'http://node' }, executor);
      try {
        await client.block.count();
        expect.fail('Expected to throw');
      } catch (err: any) {
        expect(err).to.be.instanceOf(BitcoinRestError);
        expect(err.message).to.include('tip height');
      }
    });

    it('rejects a malformed block hash for a height lookup', async () => {
      const executor: HttpExecutor = async () => new Response('../../etc/passwd', {
        status  : 200,
        headers : { 'Content-Type': 'text/plain' },
      });
      const client = new BitcoinRestClient({ host: 'http://node' }, executor);
      try {
        await client.block.getHash(100);
        expect.fail('Expected to throw');
      } catch (err: any) {
        expect(err).to.be.instanceOf(BitcoinRestError);
      }
    });

    it('rejects a block response missing its id', async () => {
      try {
        await rest({ height: 100, tx_count: 1 }).block.get({ blockhash: VALID_TXID });
        expect.fail('Expected to throw');
      } catch (err: any) {
        expect(err.message).to.include('block.id');
      }
    });

    it('rejects a non-hex transaction hex response', async () => {
      const executor: HttpExecutor = async () => new Response('<html>error</html>', {
        status  : 200,
        headers : { 'Content-Type': 'text/plain' },
      });
      const client = new BitcoinRestClient({ host: 'http://node' }, executor);
      try {
        await client.transaction.getHex(VALID_TXID);
        expect.fail('Expected to throw');
      } catch (err: any) {
        expect(err).to.be.instanceOf(BitcoinRestError);
      }
    });
  });

  describe('RPC structural validation (M11)', () => {
    const rpc = (result: unknown) => new BitcoinCoreRpcClient({ host: 'http://node' }, jsonExecutor({ result }));

    it('rejects a non-integer getblockcount result', async () => {
      try {
        await rpc('eight hundred').getBlockCount();
        expect.fail('Expected to throw');
      } catch (err: any) {
        expect(err).to.be.instanceOf(BitcoinRpcError);
        expect(err.type).to.equal('INVALID_RESPONSE');
      }
    });

    it('rejects a negative getblockcount result', async () => {
      try {
        await rpc(-5).getBlockCount();
        expect.fail('Expected to throw');
      } catch (err: any) {
        expect(err.type).to.equal('INVALID_RESPONSE');
      }
    });

    it('rejects a listunspent entry with a negative amount', async () => {
      const utxos = [{ txid: VALID_TXID, vout: 0, amount: -1.5 }];
      try {
        await rpc(utxos).listUnspent({});
        expect.fail('Expected to throw');
      } catch (err: any) {
        expect(err.type).to.equal('INVALID_RESPONSE');
        expect(err.message).to.include('amount');
      }
    });

    it('rejects a verbose getrawtransaction without a vin array', async () => {
      try {
        await rpc({ txid: VALID_TXID, vout: [] }).getRawTransaction(VALID_TXID, 2);
        expect.fail('Expected to throw');
      } catch (err: any) {
        expect(err.type).to.equal('INVALID_RESPONSE');
        expect(err.message).to.include('vin');
      }
    });

    it('rejects a signrawtransactionwithwallet result missing complete', async () => {
      try {
        await rpc({ hex: 'aa' }).signRawTransaction('aa');
        expect.fail('Expected to throw');
      } catch (err: any) {
        expect(err.type).to.equal('INVALID_RESPONSE');
        expect(err.message).to.include('complete');
      }
    });

    it('rejects a malformed getrawtransaction element in a batch', async () => {
      const executor: HttpExecutor = async (req) => {
        const reqBody = JSON.parse(req.body!);
        const responses = reqBody.map((item: any, i: number) => ({
          jsonrpc : '2.0',
          id      : item.id,
          result  : i === 0 ? { txid: VALID_TXID, vin: [], vout: [] } : { corrupted: true },
        }));
        return new Response(JSON.stringify(responses), {
          status  : 200,
          headers : { 'Content-Type': 'application/json' },
        });
      };
      const client = new BitcoinCoreRpcClient({ host: 'http://node' }, executor);
      try {
        await client.getRawTransactions(['a'.repeat(64), 'b'.repeat(64)], 2);
        expect.fail('Expected to throw');
      } catch (err: any) {
        expect(err.type).to.equal('INVALID_RESPONSE');
      }
    });

    it('accepts well-formed results', async () => {
      expect(await rpc(808080).getBlockCount()).to.equal(808080);
      expect(await rpc('ab'.repeat(32)).getBlockHash(1)).to.equal('ab'.repeat(32));
      expect(await rpc(true).verifyMessage('a', 's', 'm')).to.equal(true);
      const tx = { txid: VALID_TXID, vin: [], vout: [{ value: 0.5, scriptPubKey: { hex: '6a' } }] };
      const verbose = await rpc(tx).getRawTransaction(VALID_TXID, 2);
      expect(verbose).to.have.property('txid', VALID_TXID);
    });
  });

  describe('btcToSats edge cases (L14)', () => {
    it('preserves the sign of negative fractional values', () => {
      expect(BitcoinConnection.btcToSats(-0.5)).to.equal(-50_000_000);
      expect(BitcoinConnection.btcToSats(-0.00000001)).to.equal(-1);
      expect(BitcoinConnection.btcToSats(-1.5)).to.equal(-150_000_000);
    });

    it('rejects non-finite values', () => {
      expect(() => BitcoinConnection.btcToSats(Infinity)).to.throw(RangeError);
      expect(() => BitcoinConnection.btcToSats(-Infinity)).to.throw(RangeError);
      expect(() => BitcoinConnection.btcToSats(NaN)).to.throw(RangeError);
    });

    it('rejects values in the exponential-notation range of toFixed', () => {
      expect(() => BitcoinConnection.btcToSats(1e21)).to.throw(RangeError);
      expect(() => BitcoinConnection.btcToSats(-1e21)).to.throw(RangeError);
    });

    it('rejects sub-satoshi precision', () => {
      expect(() => BitcoinConnection.btcToSats(0.000000009)).to.throw(RangeError);
      expect(() => BitcoinConnection.btcToSats(1.000000005)).to.throw(RangeError);
    });

    it('does not false-positive on large values within double representation error', () => {
      expect(BitcoinConnection.btcToSats(21000000.99999999)).to.equal(2100000099999999);
      expect(BitcoinConnection.btcToSats(99999999.99999999)).to.equal(10000000000000000);
      expect(BitcoinConnection.btcToSats(123456789.12345678)).to.equal(12345678912345678);
    });
  });
});

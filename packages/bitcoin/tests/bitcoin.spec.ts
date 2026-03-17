import { expect } from 'chai';
import { BitcoinConnection } from '../src/connection.js';
import { EsploraProtocol } from '../src/client/rest/protocol.js';
import { JsonRpcProtocol } from '../src/client/rpc/protocol.js';
import { HttpExecutor, HttpRequest } from '../src/client/http.js';

/**
 * BitcoinConnection Test Suite
 */
describe('BitcoinConnection', () => {
  describe('forNetwork()', () => {
    it('creates a connection with network defaults', () => {
      const btc = BitcoinConnection.forNetwork('regtest');
      expect(btc.name).to.equal('regtest');
      expect(btc.rest).to.exist;
      expect(btc.rpc).to.exist;
      expect(btc.data).to.exist;
    });

    it('creates a connection with REST overrides', () => {
      const btc = BitcoinConnection.forNetwork('testnet4', {
        rest : { host: 'https://custom-mempool/api' }
      });
      expect(btc.name).to.equal('testnet4');
      expect(btc.rest.config.host).to.equal('https://custom-mempool/api');
      expect(btc.rpc).to.be.undefined;
    });

    it('creates a connection with RPC overrides on a network without default RPC', () => {
      const btc = BitcoinConnection.forNetwork('testnet4', {
        rpc : { host: 'http://mynode:18332', username: 'u', password: 'p' }
      });
      expect(btc.rpc).to.exist;
    });

    it('throws on unknown network', () => {
      expect(() => BitcoinConnection.forNetwork('unknown' as any)).to.throw('Unknown network');
    });

    it('forwards executor to REST and RPC clients', () => {
      const seen: HttpRequest[] = [];
      const executor: HttpExecutor = async (req) => {
        seen.push(req);
        return new Response('{}');
      };

      const btc = BitcoinConnection.forNetwork('regtest', { executor });
      expect(btc.rest).to.exist;
      expect(btc.rpc).to.exist;
      expect(btc.rest.protocol).to.be.instanceOf(EsploraProtocol);
    });
  });

  describe('constructor', () => {
    it('creates a connection with REST and RPC', () => {
      const btc = new BitcoinConnection({
        network : 'regtest',
        rest    : { host: 'http://localhost:3000' },
        rpc     : { host: 'http://localhost:18443', username: 'u', password: 'p' },
      });
      expect(btc.name).to.equal('regtest');
      expect(btc.rest).to.exist;
      expect(btc.rpc).to.exist;
    });

    it('creates a connection without RPC', () => {
      const btc = new BitcoinConnection({
        network : 'bitcoin',
        rest    : { host: 'https://mempool.space/api' },
      });
      expect(btc.name).to.equal('bitcoin');
      expect(btc.rpc).to.be.undefined;
    });

    it('accepts a custom executor', () => {
      const executor: HttpExecutor = async () => new Response('{}');
      const btc = new BitcoinConnection({
        network : 'regtest',
        rest    : { host: 'http://localhost:3000' },
        rpc     : { host: 'http://localhost:18443' },
        executor,
      });
      expect(btc.rest.protocol).to.be.instanceOf(EsploraProtocol);
      expect(btc.rpc!.client.protocol).to.be.instanceOf(JsonRpcProtocol);
    });
  });

  describe('protocol layer access', () => {
    it('exposes EsploraProtocol on rest client', () => {
      const btc = BitcoinConnection.forNetwork('regtest');
      const txid = 'a'.repeat(64);
      const req = btc.rest.protocol.getTx(txid);
      expect(req.url).to.include(`/tx/${txid}`);
      expect(req.method).to.equal('GET');
      expect(req.body).to.be.undefined;
    });

    it('exposes JsonRpcProtocol on rpc transport', () => {
      const btc = BitcoinConnection.forNetwork('regtest');
      const req = btc.rpc!.client.protocol.buildRequest('getblockcount', []);
      expect(req.method).to.equal('POST');
      const body = JSON.parse(req.body!);
      expect(body.method).to.equal('getblockcount');
      expect(body.jsonrpc).to.equal('2.0');
    });
  });

  describe('static helpers', () => {
    it('converts btc to sats', () => {
      expect(BitcoinConnection.btcToSats(1.5)).to.equal(150000000);
      expect(BitcoinConnection.btcToSats(0)).to.equal(0);
      expect(BitcoinConnection.btcToSats(0.00000001)).to.equal(1);
      expect(BitcoinConnection.btcToSats(21000000)).to.equal(2100000000000000);
    });

    it('converts btc to sats with precision edge cases', () => {
      // 0.1 + 0.2 !== 0.3 in floating point, but toFixed(8) handles it
      expect(BitcoinConnection.btcToSats(0.29999999)).to.equal(29999999);
      expect(BitcoinConnection.btcToSats(0.1)).to.equal(10000000);
    });

    it('converts sats to btc', () => {
      expect(BitcoinConnection.satsToBtc(150000000)).to.equal(1.5);
      expect(BitcoinConnection.satsToBtc(0)).to.equal(0);
      expect(BitcoinConnection.satsToBtc(1)).to.equal(0.00000001);
      expect(BitcoinConnection.satsToBtc(2100000000000000)).to.equal(21000000);
    });

    it('converts sats to btc with precision', () => {
      expect(BitcoinConnection.satsToBtc(10000001)).to.equal(0.10000001);
      expect(BitcoinConnection.satsToBtc(99999999)).to.equal(0.99999999);
    });

    it('handles negative sats in satsToBtc', () => {
      expect(BitcoinConnection.satsToBtc(-100000000)).to.equal(-1);
    });

    it('throws RangeError for excessive precision in btcToSats', () => {
      // A value that loses precision beyond 8 decimal places
      expect(() => BitcoinConnection.btcToSats(0.000000001)).to.throw(RangeError);
    });
  });

  describe('end-to-end with custom executor', () => {
    it('routes REST calls through the injected executor', async () => {
      const seen: HttpRequest[] = [];
      const executor: HttpExecutor = async (req) => {
        seen.push(req);
        return new Response(JSON.stringify({ txid: 'mock-txid' }), {
          status  : 200,
          headers : { 'Content-Type': 'application/json' },
        });
      };

      const txid = 'a'.repeat(64);
      const btc = BitcoinConnection.forNetwork('regtest', { executor });
      const tx = await btc.rest.transaction.get(txid);
      expect(tx).to.deep.equal({ txid: 'mock-txid' });
      expect(seen).to.have.length(1);
      expect(seen[0].url).to.include(`/tx/${txid}`);
    });

    it('routes RPC calls through the injected executor', async () => {
      const seen: HttpRequest[] = [];
      const executor: HttpExecutor = async (req) => {
        seen.push(req);
        return new Response(JSON.stringify({ result: 12345 }), {
          status  : 200,
          headers : { 'Content-Type': 'application/json' },
        });
      };

      const btc = BitcoinConnection.forNetwork('regtest', { executor });
      const count = await btc.rpc!.getBlockCount();
      expect(count).to.equal(12345);
      expect(seen).to.have.length(1);
      const body = JSON.parse(seen[0].body!);
      expect(body.method).to.equal('getblockcount');
    });
  });
});

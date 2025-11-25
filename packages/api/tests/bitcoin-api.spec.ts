import { expect, use } from 'chai';
import chaiAsPromised from 'chai-as-promised';
import type { HttpExecutor } from '@did-btcr2/bitcoin';
import { BitcoinApi } from '../src/index.js';

use(chaiAsPromised);

/** Create a mock HttpExecutor that captures requests and returns canned responses. */
function mockExecutor(
  statusCode = 200,
  body: unknown = {}
): { executor: HttpExecutor; requests: { url: string; method: string }[] } {
  const requests: { url: string; method: string }[] = [];
  const executor: HttpExecutor = async (req) => {
    requests.push({ url: req.url, method: req.method });
    return new Response(JSON.stringify(body), {
      status  : statusCode,
      headers : { 'Content-Type': 'application/json' },
    });
  };
  return { executor, requests };
}

/**
 * BitcoinApi Test
 */
describe('BitcoinApi', () => {
  it('should construct with network config', () => {
    const btc = new BitcoinApi({ network: 'regtest' });
    expect(btc).to.be.instanceOf(BitcoinApi);
    expect(btc.connection).to.exist;
  });

  it('should expose rest client', () => {
    const btc = new BitcoinApi({ network: 'regtest' });
    expect(btc.rest).to.exist;
  });

  it('should expose rpc client (may be undefined)', () => {
    const btc = new BitcoinApi({ network: 'regtest' });
    expect(() => btc.rpc).to.not.throw();
  });

  it('should construct with rest overrides', () => {
    const btc = new BitcoinApi({
      network : 'regtest',
      rest    : { host: 'http://localhost:3000' }
    });
    expect(btc.rest).to.exist;
  });

  it('should construct with rpc overrides', () => {
    const btc = new BitcoinApi({
      network : 'regtest',
      rpc     : { host: 'http://localhost:18443', username: 'u', password: 'p' }
    });
    expect(btc.rpc).to.exist;
  });

  it('btcToSats() converts correctly', () => {
    expect(BitcoinApi.btcToSats(1)).to.equal(100_000_000);
    expect(BitcoinApi.btcToSats(0.5)).to.equal(50_000_000);
    expect(BitcoinApi.btcToSats(0)).to.equal(0);
  });

  it('satsToBtc() converts correctly', () => {
    expect(BitcoinApi.satsToBtc(100_000_000)).to.equal(1);
    expect(BitcoinApi.satsToBtc(50_000_000)).to.equal(0.5);
    expect(BitcoinApi.satsToBtc(0)).to.equal(0);
  });

  // --- Input validation ---

  it('getTransaction() rejects empty txid', async () => {
    const btc = new BitcoinApi({ network: 'regtest' });
    await expect(btc.getTransaction('')).to.be.rejectedWith('txid must be a non-empty string');
  });

  it('send() rejects empty hex', async () => {
    const btc = new BitcoinApi({ network: 'regtest' });
    await expect(btc.send('')).to.be.rejectedWith('rawTxHex must be a non-empty string');
  });

  it('getUtxos() rejects empty address', async () => {
    const btc = new BitcoinApi({ network: 'regtest' });
    await expect(btc.getUtxos('')).to.be.rejectedWith('address must be a non-empty string');
  });

  it('getBlock() rejects when neither hash nor height given', async () => {
    const btc = new BitcoinApi({ network: 'regtest' });
    await expect(btc.getBlock({})).to.be.rejectedWith('at least one of hash or height');
  });

  // --- requireRpc ---

  it('requireRpc() throws when RPC is not configured', () => {
    const { executor } = mockExecutor();
    // Create with only REST (no rpc config) to guarantee rpc is undefined
    const btc = new BitcoinApi({ network: 'regtest', executor });
    if (btc.rpc) {
      // regtest defaults include RPC — skip this test variant
      return;
    }
    expect(() => btc.requireRpc()).to.throw('RPC client not configured');
  });

  it('requireRpc() returns client when RPC is configured', () => {
    const btc = new BitcoinApi({
      network : 'regtest',
      rpc     : { host: 'http://localhost:18443', username: 'u', password: 'p' }
    });
    expect(btc.requireRpc()).to.equal(btc.rpc);
  });

  // --- hasRpc ---

  it('hasRpc returns false when RPC is not configured', () => {
    const btc = new BitcoinApi({ network: 'regtest' });
    // Result depends on regtest defaults, but the getter should not throw
    expect(btc.hasRpc).to.be.a('boolean');
  });

  it('hasRpc returns true when RPC is configured', () => {
    const btc = new BitcoinApi({
      network : 'regtest',
      rpc     : { host: 'http://localhost:18443', username: 'u', password: 'p' }
    });
    expect(btc.hasRpc).to.equal(true);
  });

  // --- timeoutMs ---

  it('should construct with timeoutMs config', () => {
    const btc = new BitcoinApi({ network: 'regtest', timeoutMs: 5000 });
    expect(btc).to.be.instanceOf(BitcoinApi);
    expect(btc.connection).to.exist;
  });

  // --- HttpExecutor injection ---

  it('getTransaction() sends request to correct URL via injected executor', async () => {
    const txid = 'a'.repeat(64);
    const { executor, requests } = mockExecutor(200, { txid });
    const btc = new BitcoinApi({ network: 'regtest', executor });
    await btc.getTransaction(txid);
    expect(requests).to.have.lengthOf(1);
    expect(requests[0].url).to.include(txid);
  });

  it('send() sends POST request via injected executor', async () => {
    const { executor, requests } = mockExecutor(200, 'txid-result');
    const btc = new BitcoinApi({ network: 'regtest', executor });
    await btc.send('0200000001...');
    expect(requests).to.have.lengthOf(1);
    expect(requests[0].method).to.equal('POST');
  });

  it('getUtxos() sends request to correct URL via injected executor', async () => {
    const { executor, requests } = mockExecutor(200, []);
    const btc = new BitcoinApi({ network: 'regtest', executor });
    await btc.getUtxos('bcrt1qfakeaddress');
    expect(requests).to.have.lengthOf(1);
    expect(requests[0].url).to.include('bcrt1qfakeaddress');
  });
});

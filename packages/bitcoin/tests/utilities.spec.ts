import { networks } from 'bitcoinjs-lib';
import { expect } from 'chai';
import { safeText, toBase64 } from '../src/client/utils.js';
import { BitcoinRestError, BitcoinRpcError } from '../src/errors.js';
import { getNetwork } from '../src/network.js';
import { BitcoinRpcClientConfig, RestClientConfig } from '../src/types.js';

/**
 * Utilities Tests Suite include utils functions, network mapping, error classes,
 * types and configs.
 */
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

  it('safeText returns text and swallows errors', async () => {
    const res = new Response('text');
    expect(await safeText(res as any)).to.equal('text');

    const throwing = { text: async () => { throw new Error('boom'); } } as any;
    expect(await safeText(throwing)).to.equal('');
  });
});

describe('Network', () => {
  it('returns the correct network', () => {
    expect(getNetwork('bitcoin')).to.equal(networks.bitcoin);
    expect(getNetwork('testnet4')).to.equal(networks.testnet);
    expect(getNetwork('testnet3')).to.equal(networks.testnet);
    expect(getNetwork('signet')).to.equal(networks.testnet);
    expect(getNetwork('mutinynet')).to.equal(networks.testnet);
    expect(getNetwork('regtest')).to.equal(networks.regtest);
  });

  it('throws on unknown network', () => {
    expect(() => getNetwork('unknown')).to.throw('Unknown network "unknown"');
  });
});

describe('Errors', () => {
  it('wraps rpc and rest errors', () => {
    const rpc = new BitcoinRpcError('BITCOIN_RPC_ERROR', 1, 'msg', { a: 1 });
    expect(rpc.type).to.equal('BITCOIN_RPC_ERROR');
    expect(rpc.code).to.equal(1);
    expect(rpc.data).to.deep.equal({ a: 1 });
    expect(rpc.name).to.equal('BitcoinRpcError');

    const rest = new BitcoinRestError('rest', { foo: 'bar' });
    expect(rest.data).to.deep.equal({ foo: 'bar' });
    expect(rest.name).to.equal('BitcoinRestError');
  });
});


describe('Types and configs', () => {
  it('wraps rest and rpc configs', () => {
    const restCfg = new RestClientConfig({ host: 'http://rest', headers: { A: 'b' } });
    expect(restCfg.host).to.equal('http://rest');
    expect(restCfg.headers!.A).to.equal('b');

    const rpcCfg = new BitcoinRpcClientConfig({ host: 'http://rpc' });
    expect((rpcCfg as any).host).to.equal('http://rpc');
  });
});

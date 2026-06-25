import { expect } from 'chai';
import {
  createApi,
  DidBtcr2Api,
  GenesisDocument,
} from '../src/index.js';

/**
 * createApi() Factory Test
 */
describe('createApi()', () => {
  it('should return a DidBtcr2Api instance with no config', () => {
    const api = createApi();
    expect(api).to.be.instanceOf(DidBtcr2Api);
  });

  it('should return a DidBtcr2Api instance with empty config', () => {
    const api = createApi({});
    expect(api).to.be.instanceOf(DidBtcr2Api);
  });

  it('should return a DidBtcr2Api instance with btc config', () => {
    const api = createApi({ btc: { network: 'regtest' } });
    expect(api).to.be.instanceOf(DidBtcr2Api);
  });

  it('should accept a custom logger', () => {
    const messages: string[] = [];
    const logger = {
      debug : (msg: string) => messages.push(msg),
      info  : () => {},
      warn  : () => {},
      error : () => {},
    };
    const api = createApi({ logger });
    expect(api).to.be.instanceOf(DidBtcr2Api);
  });
});

/**
 * GenesisDocument re-export.
 *
 * The genesis-document builder lives in @did-btcr2/method; the SDK re-exports it
 * so callers can construct an external genesis document from a public key without
 * reaching into the method package directly.
 */
describe('GenesisDocument re-export', () => {
  it('re-exports the GenesisDocument class', () => {
    expect(GenesisDocument).to.be.a('function');
  });

  it('builds a genesis document from a generated public key', () => {
    const api = createApi();
    const keyId = api.kms.generateKey();
    const publicKey = api.kms.getPublicKey(keyId);
    const genesis = GenesisDocument.fromPublicKey(publicKey, 'regtest');
    expect(genesis).to.be.instanceOf(GenesisDocument);
    expect(genesis.verificationMethod).to.be.an('array').with.length.greaterThan(0);
    expect(genesis.service).to.be.an('array').with.length.greaterThan(0);
  });
});

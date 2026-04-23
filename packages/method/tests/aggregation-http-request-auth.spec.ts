import { SchnorrKeyPair } from '@did-btcr2/keypair';
import { expect } from 'chai';

import {
  DidBtcr2,
  HTTP_ENVELOPE_VERSION,
  HttpTransportError,
  REQUEST_AUTH_SCHEME,
  buildRequestAuth,
  parseRequestAuth,
  verifyRequestAuth,
} from '../src/index.js';

describe('HTTP transport request-auth', () => {
  const keys = SchnorrKeyPair.generate();
  const did  = DidBtcr2.create(keys.publicKey.compressed, { idType: 'KEY', network: 'mutinynet' });

  const otherKeys = SchnorrKeyPair.generate();

  const path = '/v1/actors/did:btcr2:k.../inbox';

  describe('buildRequestAuth + parseRequestAuth', () => {
    it('produces a well-formed header', () => {
      const header = buildRequestAuth(did, keys, path);

      expect(header.startsWith(`${REQUEST_AUTH_SCHEME} `)).to.be.true;

      const parsed = parseRequestAuth(header);
      expect(parsed.v).to.equal(HTTP_ENVELOPE_VERSION);
      expect(parsed.did).to.equal(did);
      expect(parsed.nonce).to.have.lengthOf(32);
      expect(parsed.sig).to.have.lengthOf(128);
      expect(parsed.ts).to.be.a('number');
    });

    it('rejects headers missing the scheme prefix', () => {
      expect(() => parseRequestAuth('Bearer abc'))
        .to.throw(HttpTransportError).with.property('type', 'REQUEST_AUTH_SCHEME');
    });

    it('rejects headers missing required fields', () => {
      expect(() => parseRequestAuth(`${REQUEST_AUTH_SCHEME} v=1,did=,ts=100`))
        .to.throw(HttpTransportError).with.property('type', 'REQUEST_AUTH_MALFORMED');
    });

    it('honors caller-provided nonce and timestamp', () => {
      const header = buildRequestAuth(did, keys, path, { nonce: 'ab'.repeat(16), timestamp: 1_700_000_000 });
      const parsed = parseRequestAuth(header);
      expect(parsed.nonce).to.equal('ab'.repeat(16));
      expect(parsed.ts).to.equal(1_700_000_000);
    });
  });

  describe('verifyRequestAuth', () => {
    it('accepts a valid header round-trip', () => {
      const header = buildRequestAuth(did, keys, path);
      const parsed = verifyRequestAuth(header, path, keys.publicKey);
      expect(parsed.did).to.equal(did);
    });

    it('rejects a header signed by a different key', () => {
      const header = buildRequestAuth(did, keys, path);
      expect(() => verifyRequestAuth(header, path, otherKeys.publicKey))
        .to.throw(HttpTransportError).with.property('type', 'REQUEST_AUTH_SIG_INVALID');
    });

    it('rejects a header for a different path', () => {
      const header = buildRequestAuth(did, keys, path);
      expect(() => verifyRequestAuth(header, '/v1/other/path', keys.publicKey))
        .to.throw(HttpTransportError).with.property('type', 'REQUEST_AUTH_SIG_INVALID');
    });

    it('rejects an unknown version', () => {
      // Construct a header with v=999 manually (can't come from buildRequestAuth).
      const header = `${REQUEST_AUTH_SCHEME} v=999,did=${did},ts=${Math.floor(Date.now() / 1000)},nonce=${'00'.repeat(16)},sig=${'ab'.repeat(64)}`;
      expect(() => verifyRequestAuth(header, path, keys.publicKey))
        .to.throw(HttpTransportError).with.property('type', 'REQUEST_AUTH_VERSION_MISMATCH');
    });

    it('rejects a timestamp outside default skew', () => {
      const header = buildRequestAuth(did, keys, path, { timestamp: Math.floor(Date.now() / 1000) - 10 * 60 });
      expect(() => verifyRequestAuth(header, path, keys.publicKey))
        .to.throw(HttpTransportError).with.property('type', 'REQUEST_AUTH_TIMESTAMP_SKEW');
    });

    it('honors custom clockSkewSec', () => {
      const header = buildRequestAuth(did, keys, path, { timestamp: Math.floor(Date.now() / 1000) - 10 * 60 });
      const parsed = verifyRequestAuth(header, path, keys.publicKey, { clockSkewSec: 15 * 60 });
      expect(parsed.did).to.equal(did);
    });

    it('rejects a signature of the wrong length', () => {
      // sig has 32 bytes instead of 64
      const header = `${REQUEST_AUTH_SCHEME} v=${HTTP_ENVELOPE_VERSION},did=${did},ts=${Math.floor(Date.now() / 1000)},nonce=${'00'.repeat(16)},sig=${'ab'.repeat(32)}`;
      expect(() => verifyRequestAuth(header, path, keys.publicKey))
        .to.throw(HttpTransportError).with.property('type', 'REQUEST_AUTH_SIG_LENGTH');
    });

    it('rejects a signature that is not valid hex', () => {
      const header = `${REQUEST_AUTH_SCHEME} v=${HTTP_ENVELOPE_VERSION},did=${did},ts=${Math.floor(Date.now() / 1000)},nonce=${'00'.repeat(16)},sig=zzzzzz`;
      expect(() => verifyRequestAuth(header, path, keys.publicKey))
        .to.throw(HttpTransportError);
    });
  });
});

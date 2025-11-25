import { expect } from 'chai';
import {
  createApi,
  DidBtcr2Api,
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
